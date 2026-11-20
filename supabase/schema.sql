-- 다승왕 앱 DB (Supabase SQL Editor에 통째로 붙여 넣고 Run). 여러 번 실행해도 안전.
-- 읽기: anon은 app_state SELECT만. 쓰기: 아래 SECURITY DEFINER 함수로만.

create extension if not exists pgcrypto with schema extensions;

-- ---------- 테이블 ----------
create table if not exists public.app_state (
  id int primary key default 1 check (id = 1),
  state jsonb not null,
  rev int not null default 1,
  saved_at timestamptz not null default now()
);

create table if not exists public.admin_secret (
  id int primary key default 1 check (id = 1),
  pin_hash text not null
);

create table if not exists public.admin_session (
  token uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null
);
-- 진행 PIN(2026-11-20): 세션에 역할. admin=돼장(전부), operator=진행 도우미(경기 진행 화면만). 아래 admin_check가 role을 쓰므로 먼저 만듦
alter table public.admin_session add column if not exists role text not null default 'admin';
alter table public.admin_secret add column if not exists op_pin_hash text;

-- ---------- 권한 ----------
alter table public.app_state enable row level security;
alter table public.admin_secret enable row level security;
alter table public.admin_session enable row level security;

revoke all on public.app_state, public.admin_secret, public.admin_session from anon, authenticated;
grant select on public.app_state to anon, authenticated;

drop policy if exists app_state_read on public.app_state;
create policy app_state_read on public.app_state for select to anon, authenticated using (true);
-- admin_* 테이블은 정책이 없으므로 RLS가 켜진 상태에서 anon은 아무것도 못 봄 (권한도 회수)

-- ---------- 함수 ----------
-- PIN이 맞으면 30일 토큰, 틀리면 null (로그인 실패 잠금은 운영 판단으로 쓰지 않음)
create or replace function public.admin_login(pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  h text;
  t uuid;
begin
  select pin_hash into h from public.admin_secret where id = 1;
  if h is null then raise exception 'no_pin'; end if;
  if pin is null or crypt(pin, h) <> h then return null; end if;
  delete from public.admin_session where expires_at < now();
  insert into public.admin_session (expires_at) values (now() + interval '30 days') returning token into t;
  return t;
end $$;

create or replace function public.admin_check(token uuid) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from public.admin_session s where s.token = admin_check.token and s.expires_at > now() and s.role = 'admin');
$$;

create or replace function public.admin_logout(token uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.admin_session s where s.token = admin_logout.token;
$$;

create or replace function public.save_state(token uuid, new_state jsonb, expected_rev int) returns int
language plpgsql security definer set search_path = public as $$
declare
  cur int;
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  if new_state is null or jsonb_typeof(new_state) <> 'object' then raise exception 'bad_state'; end if;
  if pg_column_size(new_state) > 1000000 then raise exception 'too_large'; end if;
  select rev into cur from public.app_state where id = 1 for update;
  if cur is null or cur <> expected_rev then raise exception 'stale_rev'; end if;
  update public.app_state
    -- 괄호 필수: '-'가 '#-'보다 우선순위가 높아서 괄호가 없으면 '{settings,pin}' - 'rev'부터 계산하려다 에러
    set state = ((new_state #- '{settings,pin}'::text[]) - 'rev'::text) - 'savedAt'::text, rev = cur + 1, saved_at = now()
    where id = 1;
  return cur + 1;
end $$;

create or replace function public.change_pin(token uuid, old_pin text, new_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  h text;
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  if new_pin !~ '^[0-9]{4}$' then raise exception 'bad_new_pin'; end if;
  select pin_hash into h from public.admin_secret where id = 1 for update;
  if h is null or old_pin is null or crypt(old_pin, h) <> h then raise exception 'bad_pin'; end if;
  -- 진행 PIN과 같으면 PIN 칸에서 구분이 안 됨
  if exists (select 1 from public.admin_secret a where a.id = 1 and a.op_pin_hash is not null and crypt(new_pin, a.op_pin_hash) = a.op_pin_hash) then raise exception 'same_as_operator'; end if;
  update public.admin_secret set pin_hash = crypt(new_pin, gen_salt('bf', 8)) where id = 1;
  -- 다른 기기의 관리자 로그인은 끊고 지금 기기만 유지
  delete from public.admin_session s where s.token <> change_pin.token;
end $$;

-- SQL Editor에서만 쓰는 PIN 설정 (anon 호출 불가). 예: select public.set_admin_pin('1234');
create or replace function public.set_admin_pin(new_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new_pin !~ '^[0-9]{4}$' then raise exception 'PIN은 숫자 4자리'; end if;
  insert into public.admin_secret (id, pin_hash) values (1, crypt(new_pin, gen_salt('bf', 8)))
    on conflict (id) do update set pin_hash = excluded.pin_hash;
  delete from public.admin_session;
  return 'PIN 설정 완료';
end $$;

-- 예전 버전의 로그인 실패 잠금 테이블 정리
drop table if exists public.admin_login_guard;

-- ---------- 돼장 요청(Claude) 하루 사용 횟수 ----------
create table if not exists public.ai_usage (
  day date primary key,
  count int not null default 0
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Edge Function 'rematch'가 Claude를 부르기 전에 호출: 관리자 토큰 확인 + 오늘(한국 시간) 횟수 1 증가, 넘으면 ai_limit
create or replace function public.ai_take(token uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Seoul')::date;
  n int;
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  insert into public.ai_usage (day, count) values (d, 1)
    on conflict (day) do update set count = public.ai_usage.count + 1
    returning count into n;
  if n > 20 then raise exception 'ai_limit'; end if;
  return n;
end $$;
revoke all on function public.ai_take(uuid) from public, anon, authenticated;
grant execute on function public.ai_take(uuid) to anon, authenticated;

revoke all on function public.admin_login(text), public.admin_check(uuid), public.admin_logout(uuid),
  public.save_state(uuid, jsonb, int), public.change_pin(uuid, text, text), public.set_admin_pin(text)
  from public, anon, authenticated;
grant execute on function public.admin_login(text), public.admin_check(uuid), public.admin_logout(uuid),
  public.save_state(uuid, jsonb, int), public.change_pin(uuid, text, text)
  to anon, authenticated;

-- ================= 돼블스플랜(승부 예측) =================
-- 예측은 app_state와 따로 저장(app_state는 읽기만). anon은 직접 쓰기 불가, 아래 RPC로만.
-- 점수는 저장하지 않음(앱이 경기 결과로 계산). 마감: 그 주 수요일 17:30 KST (prediction_deadline)
-- verify_db.js용 가짜 주는 2000년·2099년 날짜에만 만들 수 있고, 끝나면 admin_test_purge로 모두 지움

create table if not exists public.predictions (
  week_date date not null,
  player_id text not null,
  mode text not null check (mode in ('high', 'safe')),
  picks jsonb not null,                       -- [{"match":"m0101","side":"a"}, …] 4개
  updated_at timestamptz not null default now(),
  primary key (week_date, player_id)
);
-- 팀별 선택 인원(이름 없음): 인기 픽 실시간용
create table if not exists public.prediction_counts (
  week_date date not null,
  match_id text not null,
  side text not null check (side in ('a', 'b')),
  mode text not null check (mode in ('high', 'safe')),
  n int not null default 0,
  primary key (week_date, match_id, side, mode)
);
-- 체결 피드(이름 없음): 새로 고른 픽 +1, 빠진 픽 -1 (인기 픽 ▲▼ 계산용)
create table if not exists public.prediction_events (
  id bigserial primary key,
  week_date date not null,
  match_id text not null,
  side text not null,
  mode text not null,
  delta smallint not null default 1,
  at timestamptz not null default now()
);
create index if not exists prediction_events_week on public.prediction_events (week_date, id);
-- 마감 시점 비율(종가). close_snapshot이 마감 후 처음 호출될 때 한 번만 채움
create table if not exists public.prediction_close (
  week_date date not null,
  match_id text not null,
  side text not null,
  n int not null,
  total int not null,
  primary key (week_date, match_id, side)
);
-- verify_db.js 전용 가짜 주(경기 id 목록). 실제 주차와 겹치지 않게 2000년·2099년만
create table if not exists public.prediction_test_weeks (
  week_date date primary key check (extract(year from week_date) in (2000, 2099)),
  match_ids jsonb not null
);

alter table public.predictions enable row level security;
alter table public.prediction_counts enable row level security;
alter table public.prediction_events enable row level security;
alter table public.prediction_close enable row level security;
alter table public.prediction_test_weeks enable row level security;
revoke all on public.predictions, public.prediction_counts, public.prediction_events, public.prediction_close, public.prediction_test_weeks
  from anon, authenticated;
revoke all on sequence public.prediction_events_id_seq from anon, authenticated;
grant select on public.predictions, public.prediction_counts, public.prediction_events, public.prediction_close to anon, authenticated;

create or replace function public.prediction_deadline(d date) returns timestamptz
language sql stable set search_path = public as $$
  select (d + time '17:30') at time zone 'Asia/Seoul'
$$;

-- 누가 골랐는지는 마감 후에만 공개
drop policy if exists predictions_read_closed on public.predictions;
create policy predictions_read_closed on public.predictions for select to anon, authenticated
  using (now() >= public.prediction_deadline(week_date));
drop policy if exists prediction_counts_read on public.prediction_counts;
create policy prediction_counts_read on public.prediction_counts for select to anon, authenticated using (true);
drop policy if exists prediction_events_read on public.prediction_events;
create policy prediction_events_read on public.prediction_events for select to anon, authenticated using (true);
drop policy if exists prediction_close_read on public.prediction_close;
create policy prediction_close_read on public.prediction_close for select to anon, authenticated using (true);

-- 그 주 경기 id 목록 (app_state의 공개된 주, 없으면 가짜 주). 읽기만 함
create or replace function public.prediction_match_ids(d date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_agg(m->>'id')
       from public.app_state s,
            jsonb_array_elements(s.state->'weeks') w,
            jsonb_array_elements(coalesce(w->'matches', '[]'::jsonb)) m
      where s.id = 1 and w->>'date' = to_char(d, 'YYYY-MM-DD') and coalesce(w->>'published', 'true') <> 'false'),
    (select t.match_ids from public.prediction_test_weeks t where t.week_date = d));
$$;

-- 그 주 경기 → 조 {"m0101":"A", …} (app_state의 공개된 주, 없으면 가짜 주). 가짜 주가 id 배열이면 조는 ''(조별 고정 없음)
create or replace function public.prediction_match_pools(d date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_object_agg(m->>'id', coalesce(m->>'pool', ''))
       from public.app_state s,
            jsonb_array_elements(s.state->'weeks') w,
            jsonb_array_elements(coalesce(w->'matches', '[]'::jsonb)) m
      where s.id = 1 and w->>'date' = to_char(d, 'YYYY-MM-DD') and coalesce(w->>'published', 'true') <> 'false'),
    (select case when jsonb_typeof(t.match_ids) = 'object' then t.match_ids
                 else (select jsonb_object_agg(x.v, '') from jsonb_array_elements_text(t.match_ids) as x(v)) end
       from public.prediction_test_weeks t where t.week_date = d));
$$;

-- 앱 선수 명단(활동 중)에 있는지
create or replace function public.prediction_player_ok(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_state s, jsonb_array_elements(s.state->'players') p
                  where s.id = 1 and p->>'id' = pid and coalesce(p->>'active', 'true') <> 'false');
$$;

-- 검사: bad_mode / bad_player / no_week / bad_count / bad_side / dup_match / bad_match / bad_quota
-- 조별 고정(logic.js PREDICT.quota와 같게): 캐비어·랍스터(A) 1 · 소갈비·양갈비(B) 2 · 돼지갈비·닭갈비(C) 1.
-- 그 주에 한 조라도 경기 수가 모자라 채울 수 없으면 고정 없이 아무 4경기
create or replace function public.pred_check(p_week date, p_player text, p_mode text, p_picks jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  ids jsonb;
  e jsonb;
  seen text[] := '{}';
  q jsonb := '{"A": 1, "B": 2, "C": 1}';
  pools jsonb;
  g text;
  need int;
  n int;
  fixed boolean := true;
begin
  if p_mode is null or p_mode not in ('high', 'safe') then raise exception 'bad_mode'; end if;
  if p_player is null or not public.prediction_player_ok(p_player) then raise exception 'bad_player'; end if;
  ids := public.prediction_match_ids(p_week);
  if ids is null then raise exception 'no_week'; end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) <> 4 then raise exception 'bad_count'; end if;
  for e in select x.value from jsonb_array_elements(p_picks) x loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'match') is distinct from 'string' then raise exception 'bad_match'; end if;
    if (e->>'side') is null or (e->>'side') not in ('a', 'b') then raise exception 'bad_side'; end if;
    if (e->>'match') = any(seen) then raise exception 'dup_match'; end if;
    if not ids ? (e->>'match') then raise exception 'bad_match'; end if;
    seen := seen || (e->>'match');
  end loop;
  pools := coalesce(public.prediction_match_pools(p_week), '{}'::jsonb);
  for g, need in select x.key, x.value::int from jsonb_each_text(q) x loop
    select count(*) into n from jsonb_each_text(pools) y where y.value = g;
    if n < need then fixed := false; end if;
  end loop;
  if fixed then
    for g, need in select x.key, x.value::int from jsonb_each_text(q) x loop
      select count(*) into n from jsonb_array_elements(p_picks) z where pools->>(z.value->>'match') = g;
      if n <> need then raise exception 'bad_quota'; end if;
    end loop;
  end if;
end $$;

-- 저장 + counts 증감 (+ p_log면 바뀐 픽만 이벤트). 한 트랜잭션
create or replace function public.pred_apply(p_week date, p_player text, p_mode text, p_picks jsonb, p_log boolean) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  prev public.predictions%rowtype;
  clean jsonb;
  t timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('pred:' || p_week::text || ':' || p_player));
  select jsonb_agg(jsonb_build_object('match', x.e->>'match', 'side', x.e->>'side') order by x.ord) into clean
    from jsonb_array_elements(p_picks) with ordinality as x(e, ord);
  select * into prev from public.predictions p where p.week_date = p_week and p.player_id = p_player for update;
  if prev.player_id is not null then
    update public.prediction_counts c set n = c.n - 1
      from jsonb_array_elements(prev.picks) o
     where c.week_date = p_week and c.match_id = o->>'match' and c.side = o->>'side' and c.mode = prev.mode;
    if p_log then
      insert into public.prediction_events (week_date, match_id, side, mode, delta, at)
        select p_week, o->>'match', o->>'side', prev.mode, -1, t from jsonb_array_elements(prev.picks) o
         where prev.mode <> p_mode or not clean @> jsonb_build_array(o);
    end if;
  end if;
  insert into public.prediction_counts as c (week_date, match_id, side, mode, n)
    select p_week, x->>'match', x->>'side', p_mode, 1 from jsonb_array_elements(clean) x
    on conflict (week_date, match_id, side, mode) do update set n = c.n + 1;
  if p_log then
    insert into public.prediction_events (week_date, match_id, side, mode, delta, at)
      select p_week, x->>'match', x->>'side', p_mode, 1, t from jsonb_array_elements(clean) x
       where prev.player_id is null or prev.mode <> p_mode or not prev.picks @> jsonb_build_array(x);
  end if;
  insert into public.predictions as p (week_date, player_id, mode, picks, updated_at) values (p_week, p_player, p_mode, clean, t)
    on conflict (week_date, player_id) do update set mode = excluded.mode, picks = excluded.picks, updated_at = excluded.updated_at;
  return t;
end $$;

create or replace function public.pred_remove(p_week date, p_player text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  prev public.predictions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('pred:' || p_week::text || ':' || p_player));
  select * into prev from public.predictions p where p.week_date = p_week and p.player_id = p_player for update;
  if prev.player_id is null then return false; end if;
  update public.prediction_counts c set n = c.n - 1
    from jsonb_array_elements(prev.picks) o
   where c.week_date = p_week and c.match_id = o->>'match' and c.side = o->>'side' and c.mode = prev.mode;
  delete from public.predictions p where p.week_date = p_week and p.player_id = p_player;
  return true;
end $$;

-- 회원 제출: 마감 전에만 (closed). 마감 전에는 수정 가능(같은 주·같은 사람은 덮어씀)
create or replace function public.submit_prediction(week_date date, player_id text, mode text, picks jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
begin
  if now() >= public.prediction_deadline(submit_prediction.week_date) then raise exception 'closed'; end if;
  perform public.pred_check(submit_prediction.week_date, submit_prediction.player_id, submit_prediction.mode, submit_prediction.picks);
  return public.pred_apply(submit_prediction.week_date, submit_prediction.player_id, submit_prediction.mode, submit_prediction.picks, true);
end $$;

-- 돼장: 마감과 무관하게 수정·삭제·전체 보기 (체결 피드에는 안 남김)
create or replace function public.admin_upsert_prediction(token uuid, week_date date, player_id text, mode text, picks jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(admin_upsert_prediction.token) then raise exception 'unauthorized'; end if;
  perform public.pred_check(admin_upsert_prediction.week_date, admin_upsert_prediction.player_id, admin_upsert_prediction.mode, admin_upsert_prediction.picks);
  return public.pred_apply(admin_upsert_prediction.week_date, admin_upsert_prediction.player_id, admin_upsert_prediction.mode, admin_upsert_prediction.picks, false);
end $$;

create or replace function public.admin_delete_prediction(token uuid, week_date date, player_id text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(admin_delete_prediction.token) then raise exception 'unauthorized'; end if;
  return public.pred_remove(admin_delete_prediction.week_date, admin_delete_prediction.player_id);
end $$;

create or replace function public.admin_list_predictions(token uuid, week_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_check(admin_list_predictions.token) then raise exception 'unauthorized'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('week_date', p.week_date, 'player_id', p.player_id, 'mode', p.mode,
                                                       'picks', p.picks, 'updated_at', p.updated_at) order by p.updated_at), '[]'::jsonb)
            from public.predictions p where p.week_date = admin_list_predictions.week_date);
end $$;

-- 마감 비율 스냅숏: 마감 후 처음 호출될 때 한 번만 채움(이미 있으면 0). 반환: 넣은 행 수
create or replace function public.close_snapshot(week_date date) returns int
language plpgsql security definer set search_path = public as $$
declare
  k int;
begin
  if now() < public.prediction_deadline(close_snapshot.week_date) then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('close:' || close_snapshot.week_date::text));
  if exists (select 1 from public.prediction_close c where c.week_date = close_snapshot.week_date) then return 0; end if;
  insert into public.prediction_close (week_date, match_id, side, n, total)
    select close_snapshot.week_date, x.m, x.s, count(*), sum(count(*)) over (partition by x.m)
      from (select e->>'match' as m, e->>'side' as s
              from public.predictions p, jsonb_array_elements(p.picks) e
             where p.week_date = close_snapshot.week_date) x
     group by x.m, x.s;
  get diagnostics k = row_count;
  return k;
end $$;

-- verify_db.js 전용: 2000년·2099년 가짜 주 만들기(match_ids: id 배열 또는 {id: 조}) / 그 날짜들의 예측 관련 행 전부 지우기
create or replace function public.admin_test_week(token uuid, week_date date, match_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(admin_test_week.token) then raise exception 'unauthorized'; end if;
  if extract(year from admin_test_week.week_date) not in (2000, 2099) then raise exception 'test_date_only'; end if;
  insert into public.prediction_test_weeks as t (week_date, match_ids) values (admin_test_week.week_date, admin_test_week.match_ids)
    on conflict on constraint prediction_test_weeks_pkey do update set match_ids = excluded.match_ids;
end $$;

create or replace function public.admin_test_purge(token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a int; b int; c int; d int; e int;
begin
  if not public.admin_check(admin_test_purge.token) then raise exception 'unauthorized'; end if;
  delete from public.predictions x where extract(year from x.week_date) in (2000, 2099); get diagnostics a = row_count;
  delete from public.prediction_counts x where extract(year from x.week_date) in (2000, 2099); get diagnostics b = row_count;
  delete from public.prediction_events x where extract(year from x.week_date) in (2000, 2099); get diagnostics c = row_count;
  delete from public.prediction_close x where extract(year from x.week_date) in (2000, 2099); get diagnostics d = row_count;
  delete from public.prediction_test_weeks x where extract(year from x.week_date) in (2000, 2099); get diagnostics e = row_count;
  return jsonb_build_object('predictions', a, 'prediction_counts', b, 'prediction_events', c, 'prediction_close', d, 'prediction_test_weeks', e);
end $$;

revoke all on function public.prediction_deadline(date), public.prediction_match_ids(date), public.prediction_match_pools(date), public.prediction_player_ok(text),
  public.pred_check(date, text, text, jsonb), public.pred_apply(date, text, text, jsonb, boolean), public.pred_remove(date, text),
  public.submit_prediction(date, text, text, jsonb), public.admin_upsert_prediction(uuid, date, text, text, jsonb),
  public.admin_delete_prediction(uuid, date, text), public.admin_list_predictions(uuid, date), public.close_snapshot(date),
  public.admin_test_week(uuid, date, jsonb), public.admin_test_purge(uuid)
  from public, anon, authenticated;
-- prediction_deadline은 RLS 정책(predictions_read_closed)이 anon 권한으로 계산하므로 실행 가능해야 함
grant execute on function public.prediction_deadline(date),
  public.submit_prediction(date, text, text, jsonb), public.admin_upsert_prediction(uuid, date, text, text, jsonb),
  public.admin_delete_prediction(uuid, date, text), public.admin_list_predictions(uuid, date), public.close_snapshot(date),
  public.admin_test_week(uuid, date, jsonb), public.admin_test_purge(uuid)
  to anon, authenticated;

-- Realtime: 인기 픽(counts)과 체결 피드(events) 변경 구독 (이미 등록돼 있으면 건너뜀)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prediction_counts') then
      alter publication supabase_realtime add table public.prediction_counts;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prediction_events') then
      alter publication supabase_realtime add table public.prediction_events;
    end if;
  end if;
end $$;

-- ---------- 경기 진행: 자리 비움 (2026-11-20) ----------
-- 늦음(late)·잠시 빠짐/레슨(away, until 지나면 앱이 자동으로 풀린 것으로 봄)·오늘 못 함(out, 돼장만).
-- 회원은 경기날 당일·그 주 참석자만, 본인 이름으로 late/away/here(해제). 이름 확인이 없어서 남이 눌러도 막을 수는 없음 →
-- 돼장이 넣은 out은 회원이 못 바꾸고, 누가 넣었는지(by_admin)·언제(updated_at)를 남김. 코트·결과는 app_state(save_state)에 저장
create table if not exists public.availability (
  week_date date not null,
  player_id text not null,
  status text not null check (status in ('late', 'away', 'out')),
  until timestamptz,
  by_admin boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (week_date, player_id)
);
alter table public.availability enable row level security;
revoke all on public.availability from anon, authenticated;
grant select on public.availability to anon, authenticated;
drop policy if exists availability_read on public.availability;
create policy availability_read on public.availability for select to anon, authenticated using (true);

create or replace function public.avail_attending(d date, pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_state s, jsonb_array_elements(s.state->'weeks') w
                  where s.id = 1 and w->>'date' = d::text and (w->'attendees') ? pid);
$$;

-- 회원(본인): late(분 0~120, 0이면 시각 없이) / away(분 10~90) / here(해제)
create or replace function public.set_availability(p_week date, p_player text, p_status text, p_minutes int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  cur public.availability%rowtype;
  u timestamptz;
begin
  if p_week <> (now() at time zone 'Asia/Seoul')::date then raise exception 'not_today'; end if;
  if p_status is null or p_status not in ('late', 'away', 'here') then raise exception 'bad_status'; end if;
  if not public.avail_attending(p_week, p_player) then raise exception 'not_attending'; end if;
  select * into cur from public.availability a where a.week_date = p_week and a.player_id = p_player for update;
  if found and cur.by_admin and cur.status = 'out' then raise exception 'admin_locked'; end if;
  if p_status = 'here' then
    delete from public.availability a where a.week_date = p_week and a.player_id = p_player;
    return null;
  end if;
  if p_status = 'away' and (p_minutes is null or p_minutes < 10 or p_minutes > 90) then raise exception 'bad_minutes'; end if;
  if p_status = 'late' and p_minutes is not null and (p_minutes < 0 or p_minutes > 120) then raise exception 'bad_minutes'; end if;
  u := case when coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => p_minutes) end;
  insert into public.availability as a (week_date, player_id, status, until, by_admin, updated_at)
    values (p_week, p_player, p_status, u, false, now())
    on conflict (week_date, player_id) do update set status = excluded.status, until = excluded.until, by_admin = false, updated_at = now();
  return u;
end $$;

-- 돼장: 날짜·상태 제한 없이 (out 포함, here는 해제)
create or replace function public.admin_set_availability(token uuid, p_week date, p_player text, p_status text, p_minutes int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  u timestamptz;
begin
  if public.live_check(admin_set_availability.token) is null then raise exception 'unauthorized'; end if;
  if p_status is null or p_status not in ('late', 'away', 'out', 'here') then raise exception 'bad_status'; end if;
  if p_status = 'here' then
    delete from public.availability a where a.week_date = p_week and a.player_id = p_player;
    return null;
  end if;
  if p_minutes is not null and (p_minutes < 0 or p_minutes > 240) then raise exception 'bad_minutes'; end if;
  u := case when coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => p_minutes) end;
  insert into public.availability as a (week_date, player_id, status, until, by_admin, updated_at)
    values (p_week, p_player, p_status, u, true, now())
    on conflict (week_date, player_id) do update set status = excluded.status, until = excluded.until, by_admin = true, updated_at = now();
  return u;
end $$;

-- ---------- 진행 PIN: 경기 진행만 하는 도우미 (2026-11-20) ----------
-- 돼장이 설정에서 진행 PIN을 정함(관리 PIN과 달라야 함). 도우미 로그인은 계속 유지(365일) — 진행 PIN을 바꾸거나 끄면 모두 끊김
create or replace function public.live_check(token uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.role from public.admin_session s where s.token = live_check.token and s.expires_at > now();
$$;

create or replace function public.operator_login(pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  h text;
  t uuid;
begin
  select op_pin_hash into h from public.admin_secret where id = 1;
  if h is null then raise exception 'no_op_pin'; end if;
  if pin is null or crypt(pin, h) <> h then return null; end if;
  delete from public.admin_session where expires_at < now();
  insert into public.admin_session (expires_at, role) values (now() + interval '365 days', 'operator') returning token into t;
  return t;
end $$;

-- 돼장만. new_pin이 null이면 진행 PIN 끄기. 바꾸거나 끄면 도우미 로그인은 모두 끊김
create or replace function public.set_operator_pin(token uuid, new_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  h text;
begin
  if not public.admin_check(set_operator_pin.token) then raise exception 'unauthorized'; end if;
  if new_pin is not null then
    if new_pin !~ '^[0-9]{4}$' then raise exception 'bad_new_pin'; end if;
    select pin_hash into h from public.admin_secret where id = 1;
    if h is not null and crypt(new_pin, h) = h then raise exception 'same_as_admin'; end if;
  end if;
  update public.admin_secret set op_pin_hash = case when new_pin is null then null else crypt(new_pin, gen_salt('bf', 8)) end where id = 1;
  delete from public.admin_session s where s.role = 'operator';
end $$;

-- 경기 진행 동작: 그 주의 경기 하나만 서버에서 바꿈 (돼장·도우미). logic.js startMatch/finishMatch/cancelMatch와 같은 규칙
-- start(p_court 1~3) / finish(p_side a|b) / cancel. 성공하면 새 rev
create or replace function public.live_action(token uuid, p_week date, p_match text, p_action text, p_court int, p_side text) returns int
language plpgsql security definer set search_path = public as $$
declare
  st jsonb;
  cur int;
  wi int;
  mi int;
  m jsonb;
  ts text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if public.live_check(live_action.token) is null then raise exception 'unauthorized'; end if;
  if p_action is null or p_action not in ('start', 'finish', 'cancel') then raise exception 'bad_action'; end if;
  select state, rev into st, cur from public.app_state where id = 1 for update;
  select (w.ord - 1)::int into wi from jsonb_array_elements(st->'weeks') with ordinality as w(val, ord) where w.val->>'date' = p_week::text limit 1;
  if wi is null then raise exception 'no_week'; end if;
  select (x.ord - 1)::int, x.val into mi, m from jsonb_array_elements(st->'weeks'->wi->'matches') with ordinality as x(val, ord) where x.val->>'id' = p_match limit 1;
  if mi is null then raise exception 'no_match'; end if;
  if p_action = 'start' then
    if coalesce(m->>'win', '') <> '' then raise exception 'already_done'; end if;
    if coalesce(m->>'court', '') <> '' then raise exception 'court_busy'; end if;
    if p_court is null or p_court < 1 or p_court > 3 then raise exception 'bad_court'; end if;
    if exists (select 1 from jsonb_array_elements(st->'weeks'->wi->'matches') x(val)
                where coalesce(x.val->>'win', '') = '' and (x.val->>'court')::int = p_court) then raise exception 'court_busy'; end if;
    if exists (select 1 from jsonb_array_elements(st->'weeks'->wi->'matches') x(val), jsonb_array_elements_text(x.val->'a' || x.val->'b') p(pid)
                where coalesce(x.val->>'win', '') = '' and coalesce(x.val->>'court', '') <> ''
                  and p.pid in (select jsonb_array_elements_text(m->'a' || m->'b'))) then raise exception 'player_busy'; end if;
    m := m || jsonb_build_object('court', p_court, 'startedAt', ts);
  elsif p_action = 'finish' then
    if coalesce(m->>'win', '') <> '' then raise exception 'already_done'; end if;
    if coalesce(m->>'court', '') = '' then raise exception 'not_on_court'; end if;
    if p_side is null or p_side not in ('a', 'b') then raise exception 'bad_side'; end if;
    m := m || jsonb_build_object('win', p_side, 'endedAt', ts, 'court', null);
  else
    if coalesce(m->>'court', '') = '' then raise exception 'not_on_court'; end if;
    m := m || jsonb_build_object('court', null, 'startedAt', null);
  end if;
  update public.app_state set state = jsonb_set(st, array['weeks', wi::text, 'matches', mi::text], m), rev = cur + 1, saved_at = now() where id = 1;
  return cur + 1;
end $$;

revoke all on function public.live_check(uuid), public.operator_login(text), public.set_operator_pin(uuid, text),
  public.live_action(uuid, date, text, text, int, text) from public;
grant execute on function public.live_check(uuid), public.operator_login(text), public.set_operator_pin(uuid, text),
  public.live_action(uuid, date, text, text, int, text) to anon, authenticated;

revoke all on function public.avail_attending(date, text) from public, anon, authenticated;
grant execute on function public.set_availability(date, text, text, int), public.admin_set_availability(uuid, date, text, text, int)
  to anon, authenticated;

-- Realtime: 자리 비움, 그리고 돼장이 저장한 상태(app_state: 코트·결과)를 회원 화면이 새로고침 없이 받게
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'availability') then
      alter publication supabase_realtime add table public.availability;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state') then
      alter publication supabase_realtime add table public.app_state;
    end if;
  end if;
end $$;
