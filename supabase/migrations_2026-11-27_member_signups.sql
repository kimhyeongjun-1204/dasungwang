-- 운영 DB에 넣을 SQL: 회원 로그인(#31) + 운동 참가 신청(#32). schema.sql에서 그대로 뽑음 (2026-11-27)
-- 여러 번 돌려도 같음(create if not exists / create or replace / on conflict do nothing). 기존 표·데이터는 건드리지 않음

-- ---------- 회원 로그인: 조 → 이름 → 비밀번호 4자리 (2026-11-26) ----------
-- 처음 고른 이름이면 비밀번호를 만들고(두 번 입력은 앱에서), 이미 있으면 그 비밀번호로만 들어옴. 이름 바꾸기는 없음.
-- 5번 틀리면 10분 잠금. 잊으면 돼장이 초기화(그 회원의 모든 기기 로그인도 끊김). 비밀번호는 bcrypt 해시로만 저장
create table if not exists public.member_pin (
  player_id text primary key,
  pin_hash text not null,
  fails int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.member_session (
  token uuid primary key default gen_random_uuid(),
  player_id text not null,
  expires_at timestamptz not null
);
create index if not exists member_session_player on public.member_session (player_id);
alter table public.member_pin enable row level security;
alter table public.member_session enable row level security;
revoke all on public.member_pin, public.member_session from anon, authenticated;

create or replace function public.member_has_pin(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member_pin m where m.player_id = pid);
$$;

create or replace function public.member_new_session(pid text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  delete from public.member_session where expires_at < now();
  insert into public.member_session (player_id, expires_at) values (pid, now() + interval '365 days') returning token into t;
  return t;
end $$;
revoke all on function public.member_new_session(text) from public, anon, authenticated;

create or replace function public.member_set_pin(pid text, pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.prediction_player_ok(pid) then raise exception 'bad_player'; end if;
  if pin is null or pin !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  insert into public.member_pin (player_id, pin_hash) values (pid, crypt(pin, gen_salt('bf', 8))) on conflict (player_id) do nothing;
  if not found then raise exception 'pin_exists'; end if;
  return public.member_new_session(pid);
end $$;

-- 결과: {"token": …} / {"error":"wrong","left":남은 횟수} / {"error":"locked","until":…}. 틀린 횟수를 남겨야 해서 오류 대신 값으로 돌려줌
create or replace function public.member_login(pid text, pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r public.member_pin%rowtype;
begin
  if not public.prediction_player_ok(pid) then raise exception 'bad_player'; end if;
  select * into r from public.member_pin m where m.player_id = pid for update;
  if not found then raise exception 'no_pin'; end if;
  if r.locked_until is not null and r.locked_until > now() then return jsonb_build_object('error', 'locked', 'until', r.locked_until); end if;
  if pin is null or crypt(pin, r.pin_hash) <> r.pin_hash then
    if r.fails + 1 >= 5 then
      update public.member_pin set fails = 0, locked_until = now() + interval '10 minutes' where player_id = pid;
      return jsonb_build_object('error', 'locked', 'until', now() + interval '10 minutes');
    end if;
    update public.member_pin set fails = r.fails + 1 where player_id = pid;
    return jsonb_build_object('error', 'wrong', 'left', 5 - (r.fails + 1));
  end if;
  update public.member_pin set fails = 0, locked_until = null where player_id = pid;
  return jsonb_build_object('token', public.member_new_session(pid));
end $$;

-- 토큰 → 회원 id (만료·초기화·쉬는 회원이면 null)
create or replace function public.member_check(token uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.player_id from public.member_session s
   where s.token = member_check.token and s.expires_at > now() and public.prediction_player_ok(s.player_id);
$$;

create or replace function public.member_change_pin(token uuid, old_pin text, new_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare pid text := public.member_check(token); h text;
begin
  if pid is null then raise exception 'unauthorized'; end if;
  select pin_hash into h from public.member_pin where player_id = pid;
  if h is null or old_pin is null or crypt(old_pin, h) <> h then raise exception 'wrong_pin'; end if;
  if new_pin is null or new_pin !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  update public.member_pin set pin_hash = crypt(new_pin, gen_salt('bf', 8)), fails = 0, locked_until = null, updated_at = now() where player_id = pid;
end $$;

create or replace function public.member_logout(token uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.member_session s where s.token = member_logout.token;
$$;

-- 돼장(admin)만: 비밀번호를 만든 회원 id 목록 / 초기화
create or replace function public.admin_member_pins(token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  return coalesce((select jsonb_agg(player_id order by player_id) from public.member_pin), '[]'::jsonb);
end $$;

create or replace function public.admin_reset_member_pin(token uuid, pid text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  delete from public.member_session s where s.player_id = pid;
  delete from public.member_pin m where m.player_id = pid;
  return found;
end $$;

-- ---------- 운동 참가 신청·대기·정원 (2026-11-26) ----------
-- 월~금 운동. 기본 정원 월·수·금 24 · 화·목 18(돼장이 바꿀 수 있음), 그 주 그날만 다른 정원·메모·쉬는 날(workout_day).
-- 신청 순서(created_at)대로 정원까지 '신청 완료', 그 뒤는 '대기 n번' → 취소·정원 늘리기로 자리가 나면 대기 1번이 자동으로 들어가고 알림 대기열(signup_notice)에.
-- 신청·취소는 로그인한 회원 본인만(member_check). 오늘부터 13일 뒤(이번 주·다음 주)까지만 열림. 게스트는 데려온 회원 이름으로 같은 줄에 섬
create table if not exists public.workout_default (
  dow int primary key check (dow between 1 and 5),
  cap int not null check (cap between 1 and 99)
);
insert into public.workout_default (dow, cap) values (1, 24), (2, 18), (3, 24), (4, 18), (5, 24) on conflict (dow) do nothing;
create table if not exists public.workout_day (
  day date primary key,
  cap int check (cap between 1 and 99),
  memo text check (char_length(memo) <= 200),
  closed boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.signup (
  id bigserial primary key,
  day date not null,
  player_id text,
  guest_name text check (char_length(guest_name) between 1 and 20),
  host_id text not null,
  by_admin boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
-- 게스트(2026-11-27): 이름은 안 적어도 되고 성별(남 M·여 F)은 꼭. 회원 줄은 player_id, 게스트 줄은 성별로 구분
-- (처음 만든 표에는 '회원 또는 게스트 이름' 조건 signup_check가 있었음 → 지우고 새 조건으로. 여러 번 돌려도 같음)
alter table public.signup add column if not exists guest_gender text check (guest_gender in ('M', 'F'));
alter table public.signup drop constraint if exists signup_check;
alter table public.signup drop constraint if exists signup_who;
alter table public.signup add constraint signup_who check ((player_id is not null and guest_gender is null and guest_name is null) or (player_id is null and guest_gender is not null)) not valid;   -- not valid: 이미 들어간 옛 게스트 줄(성별 없음)은 그대로 두고 새 줄부터 확인
create unique index if not exists signup_member on public.signup (day, player_id) where player_id is not null;
create index if not exists signup_day on public.signup (day, created_at, id);
create table if not exists public.signup_notice (
  id bigserial primary key,
  day date not null,
  player_id text not null,
  kind text not null check (kind in ('in', 'guest_in')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.workout_default enable row level security;
alter table public.workout_day enable row level security;
alter table public.signup enable row level security;
alter table public.signup_notice enable row level security;
revoke all on public.workout_default, public.workout_day, public.signup, public.signup_notice from anon, authenticated;

create or replace function public.kst_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date; $$;

-- 그날 정원 (주말이면 null)
create or replace function public.workout_cap(d date) returns int
language sql stable security definer set search_path = public as $$
  select case when extract(isodow from d) between 1 and 5 then
    coalesce((select w.cap from public.workout_day w where w.day = d), (select x.cap from public.workout_default x where x.dow = extract(isodow from d)::int)) end;
$$;

create or replace function public.workout_open(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from d) between 1 and 5 and d >= public.kst_today() and d <= public.kst_today() + 13
     and not coalesce((select w.closed from public.workout_day w where w.day = d), false);
$$;

-- 그날 신청 줄: 순서(pos)·상태(in/wait)·대기 번호 (반환 열이 바뀌면 replace가 안 돼서 먼저 지움)
drop function if exists public.signup_rows(date);
create or replace function public.signup_rows(d date)
returns table (id bigint, player_id text, guest_name text, guest_gender text, host_id text, by_admin boolean, created_at timestamptz, pos int, status text, no int)
language sql stable security definer set search_path = public as $$
  with o as (select s.*, row_number() over (order by s.created_at, s.id)::int as pos from public.signup s where s.day = d),
       c as (select coalesce(public.workout_cap(d), 0) as cap)
  select o.id, o.player_id, o.guest_name, o.guest_gender, o.host_id, o.by_admin, o.created_at, o.pos,
         case when o.pos <= c.cap then 'in' else 'wait' end, case when o.pos <= c.cap then o.pos else o.pos - c.cap end
    from o, c order by o.pos;
$$;
revoke all on function public.signup_rows(date) from public, anon, authenticated;

-- 바뀌기 전 '신청 완료' 목록과 비교해 새로 들어간 사람을 알림 대기열에. 돌려주는 값: 들어간 회원 id(게스트는 'g:이름')
create or replace function public.signup_promote(d date, before_in bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; out jsonb := '[]'::jsonb;
begin
  for r in select * from public.signup_rows(d) x where x.status = 'in' and not (x.id = any(before_in)) order by x.pos loop
    if r.player_id is not null or r.host_id <> 'admin' then   -- 돼장이 넣은 게스트는 알림 받을 회원이 없음
      insert into public.signup_notice (day, player_id, kind) values (d, coalesce(r.player_id, r.host_id), case when r.player_id is null then 'guest_in' else 'in' end);
    end if;
    out := out || to_jsonb(coalesce(r.player_id, 'g:' || coalesce(r.guest_name, '게스트')));
  end loop;
  return out;
end $$;
revoke all on function public.signup_promote(date, bigint[]) from public, anon, authenticated;

create or replace function public.signup_in_ids(d date) returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x.id), '{}') from public.signup_rows(d) x where x.status = 'in';
$$;
revoke all on function public.signup_in_ids(date) from public, anon, authenticated;

create or replace function public.signup_status_of(d date, sid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', x.status, 'no', x.no) from public.signup_rows(d) x where x.id = sid;
$$;
revoke all on function public.signup_status_of(date, bigint) from public, anon, authenticated;

-- 명단: 누구나(회원 이름은 app_state에 이미 공개). 날짜마다 {day, cap, memo, closed, open, entries:[{id, player_id|guest, host_id, by_admin, pos, status, no}]}
create or replace function public.signups_list(d_from date, d_to date) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('day', g.d, 'cap', public.workout_cap(g.d), 'memo', w.memo, 'closed', coalesce(w.closed, false), 'open', public.workout_open(g.d),
           'entries', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'player_id', x.player_id, 'guest', x.guest_name, 'gender', x.guest_gender, 'host_id', x.host_id, 'by_admin', x.by_admin,
                                                   'pos', x.pos, 'status', x.status, 'no', x.no, 'at', x.created_at) order by x.pos) from public.signup_rows(g.d) x), '[]'::jsonb))
    from generate_series(d_from, least(d_to, d_from + 31), interval '1 day') as g0(t)
    cross join lateral (select g0.t::date as d) g
    left join public.workout_day w on w.day = g.d
   where extract(isodow from g.d) between 1 and 5
   order by g.d;
$$;

create or replace function public.signup_apply(token uuid, d date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid text := public.member_check(token); sid bigint;
begin
  if pid is null then raise exception 'unauthorized'; end if;
  if not public.workout_open(d) then raise exception 'closed_day'; end if;
  perform pg_advisory_xact_lock(hashtext('signup:' || d));
  if exists (select 1 from public.signup s where s.day = d and s.player_id = pid) then raise exception 'already'; end if;
  insert into public.signup (day, player_id, host_id) values (d, pid, pid) returning id into sid;
  return public.signup_status_of(d, sid);
end $$;

-- 게스트: 돼장만 추가 (2026-11-27 김형준 14:25). 회원용 signup_guest는 이름만 남기고 막음(예전 앱이 불러도 admin_only)
drop function if exists public.signup_guest(uuid, date, text);
create or replace function public.signup_guest(token uuid, d date, p_name text, p_gender text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'admin_only';
end $$;

-- 돼장 게스트: 이름은 선택(빈칸이면 null), 성별 M/F는 꼭. 데려온 사람 칸은 'admin'(회원 아님 → 자리 나도 알림 없음), 날짜 제한은 돼장 넣기와 같음
create or replace function public.admin_signup_guest(token uuid, d date, p_name text, p_gender text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid bigint; nm text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  if extract(isodow from d) not between 1 and 5 then raise exception 'bad_day'; end if;
  if p_gender is null or p_gender not in ('M', 'F') then raise exception 'bad_gender'; end if;
  if nm is not null and char_length(nm) > 20 then raise exception 'bad_name'; end if;
  perform pg_advisory_xact_lock(hashtext('signup:' || d));
  insert into public.signup (day, guest_name, guest_gender, host_id, by_admin) values (d, nm, p_gender, 'admin', true) returning id into sid;
  return public.signup_status_of(d, sid);
end $$;

create or replace function public.signup_cancel(token uuid, d date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid text := public.member_check(token); before bigint[];
begin
  if pid is null then raise exception 'unauthorized'; end if;
  if d < public.kst_today() then raise exception 'closed_day'; end if;
  perform pg_advisory_xact_lock(hashtext('signup:' || d));
  before := public.signup_in_ids(d);
  delete from public.signup s where s.day = d and s.player_id = pid;
  if not found then raise exception 'not_signed'; end if;
  return public.signup_promote(d, before);
end $$;

create or replace function public.signup_guest_cancel(token uuid, sid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid text := public.member_check(token); r public.signup%rowtype; before bigint[];
begin
  if pid is null then raise exception 'unauthorized'; end if;
  select * into r from public.signup s where s.id = sid and s.player_id is null;
  if not found then raise exception 'not_signed'; end if;
  if r.host_id <> pid then raise exception 'not_yours'; end if;
  perform pg_advisory_xact_lock(hashtext('signup:' || r.day));
  before := public.signup_in_ids(r.day);
  delete from public.signup s where s.id = sid;
  return public.signup_promote(r.day, before);
end $$;

-- 돼장(admin)만: 그날 정원·메모·쉬는 날 / 기본 정원 / 명단에 직접 넣기·빼기 (밴드·카톡으로 신청한 사람 정리). 날짜 제한 없음
create or replace function public.admin_set_day(token uuid, d date, p_cap int, p_memo text, p_closed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare before bigint[];
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  if extract(isodow from d) not between 1 and 5 then raise exception 'bad_day'; end if;
  if p_cap is not null and p_cap not between 1 and 99 then raise exception 'bad_cap'; end if;
  perform pg_advisory_xact_lock(hashtext('signup:' || d));
  before := public.signup_in_ids(d);
  insert into public.workout_day as w (day, cap, memo, closed, updated_at) values (d, p_cap, nullif(btrim(p_memo), ''), coalesce(p_closed, false), now())
    on conflict (day) do update set cap = excluded.cap, memo = excluded.memo, closed = excluded.closed, updated_at = now();
  return public.signup_promote(d, before);
end $$;

create or replace function public.admin_set_default_cap(token uuid, p_dow int, p_cap int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  if p_dow is null or p_dow not between 1 and 5 then raise exception 'bad_day'; end if;
  if p_cap is null or p_cap not between 1 and 99 then raise exception 'bad_cap'; end if;
  update public.workout_default set cap = p_cap where dow = p_dow;
end $$;

create or replace function public.admin_signup_add(token uuid, d date, pid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid bigint;
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  if extract(isodow from d) not between 1 and 5 then raise exception 'bad_day'; end if;
  if not public.prediction_player_ok(pid) then raise exception 'bad_player'; end if;
  perform pg_advisory_xact_lock(hashtext('signup:' || d));
  if exists (select 1 from public.signup s where s.day = d and s.player_id = pid) then raise exception 'already'; end if;
  insert into public.signup (day, player_id, host_id, by_admin) values (d, pid, pid, true) returning id into sid;
  return public.signup_status_of(d, sid);
end $$;

create or replace function public.admin_signup_remove(token uuid, d date, sid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare before bigint[];
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtext('signup:' || d));
  before := public.signup_in_ids(d);
  delete from public.signup s where s.id = sid and s.day = d;
  if not found then raise exception 'not_signed'; end if;
  return public.signup_promote(d, before);
end $$;

-- 알림 보내기(Edge Function notify, kind=signup): 아직 안 보낸 '자리 났어요'를 구독한 기기 주소와 함께 꺼내고 보낸 것으로 표시.
-- 받는 사람·내용은 DB가 정하고 한 번만 나감(누가 불러도 같은 알림이 두 번 가지 않음)
create or replace function public.signup_notices_take()
returns table (endpoint text, p256dh text, auth text, kind text, day date)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with n as (update public.signup_notice x set sent_at = now() where x.sent_at is null and x.created_at > now() - interval '1 day' returning x.player_id, x.kind, x.day)
  select p.endpoint, p.p256dh, p.auth, n.kind, n.day from n join public.push_subs p on p.player_id = n.player_id;
end $$;

-- 기본 정원 월~금 [월, 화, 수, 목, 금] (누구나 읽음, 돼장 설정 화면용)
create or replace function public.workout_defaults() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(cap order by dow), '[]'::jsonb) from public.workout_default;
$$;
