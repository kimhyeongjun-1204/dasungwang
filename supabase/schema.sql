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
  select exists (select 1 from public.admin_session s where s.token = admin_check.token and s.expires_at > now());
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

revoke all on function public.admin_login(text), public.admin_check(uuid), public.admin_logout(uuid),
  public.save_state(uuid, jsonb, int), public.change_pin(uuid, text, text), public.set_admin_pin(text)
  from public, anon, authenticated;
grant execute on function public.admin_login(text), public.admin_check(uuid), public.admin_logout(uuid),
  public.save_state(uuid, jsonb, int), public.change_pin(uuid, text, text)
  to anon, authenticated;
