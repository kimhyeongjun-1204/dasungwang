-- 회원 로그인(조 → 이름 → 비밀번호 4자리) 규칙 확인 (로컬 Postgres 16). 준비는 live_action.sql과 같음 → psql -qAt -d <db> < supabase/tests/members.sql
-- 줄마다 'ok 라벨' 또는 'FAIL 라벨: 받은 값 ≠ 기대값'. 전부 begin … rollback 안에서 돌아서 끝나면 아무것도 남지 않음(실제 DB에서는 돌리지 말 것)
begin;
insert into public.app_state (id, state, rev) values (1, '{}'::jsonb, 1) on conflict (id) do nothing;
update public.app_state set rev = 1, state = '{"settings":{},"weeks":[],"players":[
 {"id":"a","name":"가가","group":"A"},{"id":"b","name":"나나","group":"B"},{"id":"c","name":"다다","group":"C"},{"id":"z","name":"쉬는","group":"C","active":false}]}'::jsonb where id = 1;
insert into public.admin_session (token, expires_at, role) values
 ('11111111-1111-1111-1111-111111111111', now() + interval '1 day', 'admin'),
 ('22222222-2222-2222-2222-222222222222', now() + interval '1 day', 'operator');
create or replace function pg_temp.got(q text) returns text language plpgsql as $$
declare r text;
begin
  execute q into r; return coalesce(r, 'null');
exception when others then return 'ERR ' || sqlerrm;
end $$;
create or replace function pg_temp.eq(p_label text, q text, want text) returns text language plpgsql as $$
declare g text := pg_temp.got(q);
begin
  return case when g = want or (want = '<uuid>' and g ~ '^[0-9a-f-]{36}$') then 'ok ' || p_label else 'FAIL ' || p_label || ': ' || g || ' ≠ ' || want end;
end $$;
create temp table tok (k text primary key, t uuid) on commit drop;

-- 처음: 비밀번호 없음
select pg_temp.eq('처음엔 비밀번호 없음', $q$select public.member_has_pin('a')::text$q$, 'false');
select pg_temp.eq('비밀번호 없이 로그인', $q$select public.member_login('a', '1234')::text$q$, 'ERR no_pin');
-- 만들기: 숫자 4자리만, 명단에 있는 활동 회원만
select pg_temp.eq('3자리 거절', $q$select public.member_set_pin('a', '123')::text$q$, 'ERR bad_pin');
select pg_temp.eq('글자 거절', $q$select public.member_set_pin('a', '12a4')::text$q$, 'ERR bad_pin');
select pg_temp.eq('5자리 거절', $q$select public.member_set_pin('a', '12345')::text$q$, 'ERR bad_pin');
select pg_temp.eq('없는 회원', $q$select public.member_set_pin('nope', '1234')::text$q$, 'ERR bad_player');
select pg_temp.eq('쉬는 회원', $q$select public.member_set_pin('z', '1234')::text$q$, 'ERR bad_player');
insert into tok select 'a1', public.member_set_pin('a', '0000');
select pg_temp.eq('만들면 토큰', $q$select t::text from tok where k = 'a1'$q$, '<uuid>');
select pg_temp.eq('이제 비밀번호 있음', $q$select public.member_has_pin('a')::text$q$, 'true');
select pg_temp.eq('토큰 → 본인', $q$select public.member_check(t) from tok where k = 'a1'$q$, 'a');
-- 다른 사람이 같은 이름으로 다시 만들 수 없음 (박희수 0000 예시)
select pg_temp.eq('이미 있으면 새로 못 만듦', $q$select public.member_set_pin('a', '9999')::text$q$, 'ERR pin_exists');
select pg_temp.eq('해시로 저장(평문 아님)', $q$select (pin_hash <> '0000' and pin_hash like '$2%')::text from public.member_pin where player_id = 'a'$q$, 'true');
-- 로그인
select pg_temp.eq('맞는 비밀번호', $q$select (public.member_login('a', '0000')->>'token') ~ '^[0-9a-f-]{36}$' from (select 1) x$q$, 'true');
select pg_temp.eq('틀림 1', $q$select public.member_login('a', '1111')::text$q$, '{"left": 4, "error": "wrong"}');
select pg_temp.eq('틀림 2', $q$select public.member_login('a', '1111')::text$q$, '{"left": 3, "error": "wrong"}');
select pg_temp.eq('맞으면 횟수 처음부터', $q$select (public.member_login('a', '0000') ? 'token')::text$q$, 'true');
select pg_temp.eq('다시 틀림 1', $q$select public.member_login('a', '1111')::text$q$, '{"left": 4, "error": "wrong"}');
select pg_temp.eq('틀림 2', $q$select public.member_login('a', '2222')::text$q$, '{"left": 3, "error": "wrong"}');
select pg_temp.eq('틀림 3', $q$select public.member_login('a', '3333')::text$q$, '{"left": 2, "error": "wrong"}');
select pg_temp.eq('틀림 4', $q$select public.member_login('a', '4444')::text$q$, '{"left": 1, "error": "wrong"}');
select pg_temp.eq('5번째 틀리면 잠김', $q$select public.member_login('a', '5555')->>'error'$q$, 'locked');
select pg_temp.eq('잠긴 동안은 맞아도 안 됨', $q$select public.member_login('a', '0000')->>'error'$q$, 'locked');
select pg_temp.eq('잠금 10분', $q$select (locked_until between now() + interval '9 minutes' and now() + interval '11 minutes')::text from public.member_pin where player_id = 'a'$q$, 'true');
update public.member_pin set locked_until = now() - interval '1 second' where player_id = 'a';
select pg_temp.eq('잠금 풀리면 로그인', $q$select (public.member_login('a', '0000') ? 'token')::text$q$, 'true');
select pg_temp.eq('쉬는 회원 로그인 거절', $q$select public.member_login('z', '0000')::text$q$, 'ERR bad_player');
-- 비밀번호 바꾸기
select pg_temp.eq('지금 비밀번호 틀림', $q$select public.member_change_pin(t, '9999', '1234')::text from tok where k = 'a1'$q$, 'ERR wrong_pin');
select pg_temp.eq('새 비밀번호 형식', $q$select public.member_change_pin(t, '0000', 'abcd')::text from tok where k = 'a1'$q$, 'ERR bad_pin');
select pg_temp.eq('바꾸기', $q$select public.member_change_pin(t, '0000', '1234')::text from tok where k = 'a1'$q$, '');
select pg_temp.eq('새 비밀번호로 로그인', $q$select (public.member_login('a', '1234') ? 'token')::text$q$, 'true');
select pg_temp.eq('모르는 토큰으로 바꾸기', $q$select public.member_change_pin('44444444-4444-4444-4444-444444444444', '1234', '0000')::text$q$, 'ERR unauthorized');
-- 돼장: 비밀번호 있는 회원 목록 / 초기화 (도우미는 안 됨)
insert into tok select 'b1', public.member_set_pin('b', '5678');
select pg_temp.eq('돼장: 비밀번호 있는 회원', $q$select public.admin_member_pins('11111111-1111-1111-1111-111111111111')::text$q$, '["a", "b"]');
select pg_temp.eq('도우미는 목록 못 봄', $q$select public.admin_member_pins('22222222-2222-2222-2222-222222222222')::text$q$, 'ERR unauthorized');
select pg_temp.eq('도우미는 초기화 못 함', $q$select public.admin_reset_member_pin('22222222-2222-2222-2222-222222222222', 'b')::text$q$, 'ERR unauthorized');
select pg_temp.eq('돼장 초기화', $q$select public.admin_reset_member_pin('11111111-1111-1111-1111-111111111111', 'b')::text$q$, 'true');
select pg_temp.eq('초기화하면 그 기기 로그인도 끊김', $q$select public.member_check(t) from tok where k = 'b1'$q$, 'null');
select pg_temp.eq('초기화 뒤 새로 만들 수 있음', $q$select (public.member_set_pin('b', '0000') is not null)::text$q$, 'true');
select pg_temp.eq('없는 비밀번호 초기화', $q$select public.admin_reset_member_pin('11111111-1111-1111-1111-111111111111', 'c')::text$q$, 'false');
-- 쉬는 회원이 되면 토큰도 안 통함
update public.app_state set state = jsonb_set(state, '{players,0,active}', 'false') where id = 1;
select pg_temp.eq('쉬는 회원 토큰', $q$select public.member_check(t) from tok where k = 'a1'$q$, 'null');
update public.app_state set state = jsonb_set(state, '{players,0,active}', 'true') where id = 1;
-- 로그아웃
select pg_temp.eq('로그아웃', $q$select public.member_logout(t)::text from tok where k = 'a1'$q$, 'null');
select pg_temp.eq('로그아웃한 토큰', $q$select public.member_check(t) from tok where k = 'a1'$q$, 'null');
-- anon은 표를 직접 못 읽음
set local role anon;
select pg_temp.eq('anon이 비밀번호 표 읽기', $q$select count(*)::text from public.member_pin$q$, 'ERR permission denied for table member_pin');
select pg_temp.eq('anon이 세션 표 읽기', $q$select count(*)::text from public.member_session$q$, 'ERR permission denied for table member_session');
select pg_temp.eq('anon이 함수 부르기', $q$select public.member_has_pin('a')::text$q$, 'true');
reset role;
rollback;
