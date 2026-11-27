-- 회원 역할: 돼장·진행 도우미를 PIN 대신 회원 로그인으로 (2026-11-27 김형준 "다승왕 관리 핀 입력 지우고"). → psql -qAt -d <db> < supabase/tests/roles.sql
-- 줄마다 'ok 라벨' 또는 'FAIL 라벨: 받은 값 ≠ 기대값'. 전부 begin … rollback 안에서 돌아서 끝나면 아무것도 남지 않음(실제 DB에서는 돌리지 말 것)
begin;
insert into public.app_state (id, state, rev) values (1, '{}'::jsonb, 1) on conflict (id) do nothing;
update public.app_state set rev = 1, state = '{"settings":{},"weeks":[],"players":[
 {"id":"a","name":"가가","group":"A"},{"id":"b","name":"나나","group":"B"},{"id":"c","name":"다다","group":"C"},{"id":"z","name":"쉬는","group":"C","active":false}]}'::jsonb where id = 1;
insert into public.member_session (token, player_id, expires_at) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 'a', now() + interval '1 day'), ('bbbbbbbb-0000-0000-0000-000000000000', 'b', now() + interval '1 day'),
 ('cccccccc-0000-0000-0000-000000000000', 'c', now() + interval '1 day');
insert into public.club_role (player_id, role) values ('a', 'admin') on conflict (player_id) do update set role = 'admin';
create or replace function pg_temp.got(q text) returns text language plpgsql as $$
declare r text;
begin
  execute q into r; return coalesce(r, 'null');
exception when others then return 'ERR ' || sqlerrm;
end $$;
create or replace function pg_temp.eq(p_label text, q text, want text) returns text language plpgsql as $$
declare g text := pg_temp.got(q);
begin
  return case when g = want then 'ok ' || p_label else 'FAIL ' || p_label || ': ' || g || ' ≠ ' || want end;
end $$;
create temp table tok (k text primary key, t uuid) on commit drop;

-- 처음 넣어 둔 돼장: 김성곤(p005)·김형준(p006)
select pg_temp.eq('돼장 두 명', $q$select string_agg(player_id || ':' || role, ',' order by player_id) from public.club_role where player_id in ('p005', 'p006')$q$, 'p005:admin,p006:admin');
select pg_temp.eq('역할 표는 아무도 직접 못 읽음', $q$select has_table_privilege('anon', 'public.club_role', 'select')::text || has_table_privilege('authenticated', 'public.club_role', 'select')::text$q$, 'falsefalse');

-- 회원 로그인 → 역할이 있으면 관리 열쇠(admin_session), 없으면 null
select pg_temp.eq('로그인 안 한 토큰', $q$select public.member_role_session('99999999-0000-0000-0000-000000000000')::text$q$, 'ERR unauthorized');
select pg_temp.eq('역할 없는 회원 b', $q$select public.member_role_session('bbbbbbbb-0000-0000-0000-000000000000')::text$q$, 'null');
insert into tok select 'a', (public.member_role_session('aaaaaaaa-0000-0000-0000-000000000000')->>'token')::uuid;
select pg_temp.eq('돼장 a → 역할 admin', $q$select public.member_role_session('aaaaaaaa-0000-0000-0000-000000000000')->>'role'$q$, 'admin');
select pg_temp.eq('돼장 열쇠로 관리 가능', $q$select public.admin_check((select t from tok where k = 'a'))::text$q$, 'true');
select pg_temp.eq('다시 열어도 같은 열쇠(세션이 쌓이지 않음)', $q$select ((public.member_role_session('aaaaaaaa-0000-0000-0000-000000000000')->>'token')::uuid = (select t from tok where k = 'a'))::text$q$, 'true');
select pg_temp.eq('열쇠에 회원 id가 붙음', $q$select player_id from public.admin_session where token = (select t from tok where k = 'a')$q$, 'a');

-- 진행 도우미: 돼장이 회원 중에서 지정 / 해제
select pg_temp.eq('도우미 지정 b', $q$select public.admin_set_operator((select t from tok where k = 'a'), 'b', true)::text$q$, '["b"]');
select pg_temp.eq('두 번 지정해도 같음', $q$select public.admin_set_operator((select t from tok where k = 'a'), 'b', true)::text$q$, '["b"]');
select pg_temp.eq('도우미 목록', $q$select public.admin_operators((select t from tok where k = 'a'))::text$q$, '["b"]');
insert into tok select 'b', (public.member_role_session('bbbbbbbb-0000-0000-0000-000000000000')->>'token')::uuid;
select pg_temp.eq('b 로그인 → 역할 operator', $q$select role from public.admin_session where token = (select t from tok where k = 'b')$q$, 'operator');
select pg_temp.eq('도우미는 돼장 일 못 함', $q$select public.admin_check((select t from tok where k = 'b'))::text$q$, 'false');
select pg_temp.eq('도우미는 진행 확인은 됨', $q$select public.live_check((select t from tok where k = 'b'))$q$, 'operator');
select pg_temp.eq('도우미가 도우미 지정', $q$select public.admin_set_operator((select t from tok where k = 'b'), 'c', true)::text$q$, 'ERR unauthorized');
select pg_temp.eq('도우미 목록도 돼장만', $q$select public.admin_operators((select t from tok where k = 'b'))::text$q$, 'ERR unauthorized');
select pg_temp.eq('돼장을 도우미로', $q$select public.admin_set_operator((select t from tok where k = 'a'), 'a', true)::text$q$, 'ERR is_admin');
select pg_temp.eq('쉬는 회원', $q$select public.admin_set_operator((select t from tok where k = 'a'), 'z', true)::text$q$, 'ERR bad_player');
select pg_temp.eq('없는 회원', $q$select public.admin_set_operator((select t from tok where k = 'a'), 'nope', true)::text$q$, 'ERR bad_player');
select pg_temp.eq('돼장은 해제로 못 뺌', $q$select public.admin_set_operator((select t from tok where k = 'a'), 'a', false)::text || (select role from public.club_role where player_id = 'a')$q$, '["b"]admin');
select pg_temp.eq('도우미 해제 b', $q$select public.admin_set_operator((select t from tok where k = 'a'), 'b', false)::text$q$, '[]');
select pg_temp.eq('해제하면 b 열쇠도 바로 끊김', $q$select coalesce(public.live_check((select t from tok where k = 'b')), 'none')$q$, 'none');
select pg_temp.eq('해제 뒤 b 로그인 → 역할 없음', $q$select public.member_role_session('bbbbbbbb-0000-0000-0000-000000000000')::text$q$, 'null');

-- 비밀번호 초기화하면 그 회원의 관리 열쇠도 끊김
select public.admin_set_operator((select t from tok where k = 'a'), 'c', true);
insert into tok select 'c', (public.member_role_session('cccccccc-0000-0000-0000-000000000000')->>'token')::uuid;
select pg_temp.eq('c 도우미 열쇠', $q$select public.live_check((select t from tok where k = 'c'))$q$, 'operator');
select pg_temp.eq('c 비밀번호 초기화', $q$select public.admin_reset_member_pin((select t from tok where k = 'a'), 'c')::text$q$, 'false');
select pg_temp.eq('초기화하면 c 열쇠 끊김', $q$select coalesce(public.live_check((select t from tok where k = 'c')), 'none')$q$, 'none');
select pg_temp.eq('초기화해도 도우미 지정은 그대로', $q$select public.admin_operators((select t from tok where k = 'a'))::text$q$, '["c"]');
rollback;
