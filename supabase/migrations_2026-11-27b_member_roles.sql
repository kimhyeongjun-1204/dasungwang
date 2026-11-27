-- 운영 DB에 넣을 SQL: 회원 역할(관리 PIN 입력 없앰, 돼장·진행 도우미를 회원 로그인으로). schema.sql에서 그대로 뽑음 (2026-11-27)
-- 여러 번 돌려도 같음(create if not exists / create or replace / on conflict do nothing / add column if not exists). 기존 표·데이터는 안 건드림

-- ---------- 회원 역할: 돼장·진행 도우미를 회원 로그인으로 (2026-11-27) ----------
-- 관리 PIN 입력을 없앰(김형준 "다승왕 관리 핀 입력 지우고"). 돼장(admin) 회원이 로그인하면 관리 열쇠(admin_session, 30일)를 받고,
-- 진행 도우미(operator)는 돼장이 회원 중에서 지정. 열쇠에 회원 id를 붙여 두고 해제·비밀번호 초기화 때 바로 끊음.
-- 예전 admin_login·operator_login(PIN) 함수는 앱에서 안 부르지만 비상용으로 남김
create table if not exists public.club_role (
  player_id text primary key,
  role text not null check (role in ('admin', 'operator')),
  updated_at timestamptz not null default now()
);
alter table public.club_role enable row level security;
revoke all on public.club_role from anon, authenticated;
insert into public.club_role (player_id, role) values ('p005', 'admin'), ('p006', 'admin') on conflict (player_id) do nothing;   -- 김성곤·김형준
alter table public.admin_session add column if not exists player_id text;

-- 로그인한 회원 → 역할이 있으면 {token, role}, 없으면 null. 아직 하루 넘게 남은 같은 열쇠가 있으면 그걸 다시 줌(앱을 열 때마다 쌓이지 않게)
create or replace function public.member_role_session(token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare pid text := public.member_check(token); r text; t uuid;
begin
  if pid is null then raise exception 'unauthorized'; end if;
  select c.role into r from public.club_role c where c.player_id = pid;
  if r is null then return null; end if;
  select a.token into t from public.admin_session a where a.player_id = pid and a.role = r and a.expires_at > now() + interval '1 day' order by a.expires_at desc limit 1;
  if t is null then
    delete from public.admin_session a where a.expires_at < now();
    insert into public.admin_session (expires_at, role, player_id) values (now() + interval '30 days', r, pid) returning admin_session.token into t;
  end if;
  return jsonb_build_object('token', t, 'role', r);
end $$;

-- 돼장만: 진행 도우미 목록 / 지정·해제 (해제하면 그 회원 열쇠 바로 끊음). 돼장 역할은 여기서 못 바꿈
create or replace function public.admin_operators(token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  return coalesce((select jsonb_agg(c.player_id order by c.player_id) from public.club_role c where c.role = 'operator'), '[]'::jsonb);
end $$;

create or replace function public.admin_set_operator(token uuid, pid text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  if exists (select 1 from public.club_role c where c.player_id = pid and c.role = 'admin') then
    if p_on then raise exception 'is_admin'; end if;
  elsif p_on then
    if not public.prediction_player_ok(pid) then raise exception 'bad_player'; end if;
    insert into public.club_role (player_id, role) values (pid, 'operator') on conflict (player_id) do nothing;
  else
    delete from public.club_role c where c.player_id = pid and c.role = 'operator';
    delete from public.admin_session a where a.player_id = pid and a.role = 'operator';
  end if;
  return public.admin_operators(token);
end $$;

-- 비밀번호 초기화하면 그 회원 로그인으로 받은 관리 열쇠도 끊음 (schema.sql 회원 로그인 부분과 같음)
create or replace function public.admin_reset_member_pin(token uuid, pid text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_check(token) then raise exception 'unauthorized'; end if;
  delete from public.admin_session a where a.player_id = pid;   -- 그 회원 로그인으로 받은 관리 열쇠도 끊음 (회원 역할, 2026-11-27)
  delete from public.member_session s where s.player_id = pid;
  delete from public.member_pin m where m.player_id = pid;
  return found;
end $$;
