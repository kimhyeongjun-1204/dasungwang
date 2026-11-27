-- 운동 참가 신청·대기·정원 규칙 확인 (로컬 Postgres 16). 준비는 live_action.sql과 같음 → psql -qAt -d <db> < supabase/tests/signups.sql
-- 줄마다 'ok 라벨' 또는 'FAIL 라벨: 받은 값 ≠ 기대값'. 전부 begin … rollback 안에서 돌아서 끝나면 아무것도 남지 않음(실제 DB에서는 돌리지 말 것)
-- 날짜는 '오늘(KST)' 기준으로 만들어서 언제 돌려도 같음: 다음 주 월~금 = mon..mon+4
begin;
insert into public.app_state (id, state, rev) values (1, '{}'::jsonb, 1) on conflict (id) do nothing;
update public.app_state set rev = 1, state = '{"settings":{},"weeks":[],"players":[
 {"id":"a","name":"가가","group":"A"},{"id":"b","name":"나나","group":"B"},{"id":"c","name":"다다","group":"C"},{"id":"d","name":"라라","group":"C"},{"id":"z","name":"쉬는","group":"C","active":false}]}'::jsonb where id = 1;
insert into public.admin_session (token, expires_at, role) values
 ('11111111-1111-1111-1111-111111111111', now() + interval '1 day', 'admin'),
 ('22222222-2222-2222-2222-222222222222', now() + interval '1 day', 'operator');
insert into public.member_session (token, player_id, expires_at) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 'a', now() + interval '1 day'), ('bbbbbbbb-0000-0000-0000-000000000000', 'b', now() + interval '1 day'),
 ('cccccccc-0000-0000-0000-000000000000', 'c', now() + interval '1 day'), ('dddddddd-0000-0000-0000-000000000000', 'd', now() + interval '1 day'),
 ('eeeeeeee-0000-0000-0000-000000000000', 'z', now() + interval '1 day');
create temp table dd on commit drop as
  select ((now() at time zone 'Asia/Seoul')::date + (8 - extract(isodow from (now() at time zone 'Asia/Seoul')::date))::int) as mon,
         (now() at time zone 'Asia/Seoul')::date as today;
grant select on dd to anon;
create or replace function pg_temp.got(q text) returns text language plpgsql as $$
declare r text; m date; begin
  select mon into m from dd;
  execute replace(q, ':mon', quote_literal(m) || '::date') into r; return coalesce(r, 'null');
exception when others then return 'ERR ' || sqlerrm;
end $$;
create or replace function pg_temp.eq(p_label text, q text, want text) returns text language plpgsql as $$
declare g text := pg_temp.got(q);
begin
  return case when g = want then 'ok ' || p_label else 'FAIL ' || p_label || ': ' || g || ' ≠ ' || want end;
end $$;

-- 기본 정원: 월수금 24 · 화목 18, 주말은 운동 없음
select pg_temp.eq('기본 정원 월~금', $q$select string_agg(public.workout_cap(:mon + i)::text, ',' order by i) from generate_series(0, 4) i$q$, '24,18,24,18,24');
select pg_temp.eq('토요일 정원 없음', $q$select public.workout_cap(:mon + 5)::text$q$, 'null');
-- 신청: 로그인한 회원만
select pg_temp.eq('모르는 토큰', $q$select public.signup_apply('99999999-0000-0000-0000-000000000000', :mon)::text$q$, 'ERR unauthorized');
select pg_temp.eq('쉬는 회원 토큰', $q$select public.signup_apply('eeeeeeee-0000-0000-0000-000000000000', :mon)::text$q$, 'ERR unauthorized');
select pg_temp.eq('토요일 신청', $q$select public.signup_apply('aaaaaaaa-0000-0000-0000-000000000000', :mon + 5)::text$q$, 'ERR closed_day');
select pg_temp.eq('지난 날 신청', $q$select public.signup_apply('aaaaaaaa-0000-0000-0000-000000000000', (select today from dd) - 1)::text$q$, 'ERR closed_day');
select pg_temp.eq('3주 뒤 신청(아직 안 열림)', $q$select public.signup_apply('aaaaaaaa-0000-0000-0000-000000000000', :mon + 14)::text$q$, 'ERR closed_day');
-- 정원 2로 줄여서 대기 확인 (돼장, 그 날만)
select pg_temp.eq('도우미는 정원 못 바꿈', $q$select public.admin_set_day('22222222-2222-2222-2222-222222222222', :mon, 2, null, false)::text$q$, 'ERR unauthorized');
select pg_temp.eq('정원 0 거절', $q$select public.admin_set_day('11111111-1111-1111-1111-111111111111', :mon, 0, null, false)::text$q$, 'ERR bad_cap');
select pg_temp.eq('돼장: 월요일만 정원 2', $q$select public.admin_set_day('11111111-1111-1111-1111-111111111111', :mon, 2, '랜덤빵 제공', false)::text$q$, '[]');
select pg_temp.eq('월요일 정원 2, 화요일은 그대로', $q$select public.workout_cap(:mon)::text || ',' || public.workout_cap(:mon + 1)::text$q$, '2,18');
select pg_temp.eq('a 신청 → 신청 완료', $q$select public.signup_apply('aaaaaaaa-0000-0000-0000-000000000000', :mon)::text$q$, '{"no": 1, "status": "in"}');
select pg_temp.eq('a 또 신청', $q$select public.signup_apply('aaaaaaaa-0000-0000-0000-000000000000', :mon)::text$q$, 'ERR already');
select pg_temp.eq('b 신청 → 신청 완료', $q$select public.signup_apply('bbbbbbbb-0000-0000-0000-000000000000', :mon)::text$q$, '{"no": 2, "status": "in"}');
select pg_temp.eq('c 신청 → 대기 1번', $q$select public.signup_apply('cccccccc-0000-0000-0000-000000000000', :mon)::text$q$, '{"no": 1, "status": "wait"}');
select pg_temp.eq('d 게스트(남) 데려옴 → 대기 2번', $q$select public.signup_guest('dddddddd-0000-0000-0000-000000000000', :mon, ' 손님 ', 'M')::text$q$, '{"no": 2, "status": "wait"}');
-- 게스트: 이름은 안 적어도 되고, 성별(남 M·여 F)은 꼭 (2026-11-27)
select pg_temp.eq('게스트 성별 없음', $q$select public.signup_guest('dddddddd-0000-0000-0000-000000000000', :mon, '친구', null)::text$q$, 'ERR bad_gender');
select pg_temp.eq('게스트 성별 이상한 값', $q$select public.signup_guest('dddddddd-0000-0000-0000-000000000000', :mon, '친구', 'X')::text$q$, 'ERR bad_gender');
select pg_temp.eq('게스트 이름 21자', $q$select public.signup_guest('dddddddd-0000-0000-0000-000000000000', :mon, repeat('가', 21), 'F')::text$q$, 'ERR bad_name');
select pg_temp.eq('명단(순서·상태)', $q$select string_agg(coalesce(e->>'player_id', 'g:' || (e->>'guest')) || '=' || (e->>'status'), ' ' order by (e->>'pos')::int)
  from public.signups_list(:mon, :mon) s, jsonb_array_elements(s->'entries') e$q$, 'a=in b=in c=wait g:손님=wait');
select pg_temp.eq('명단에 게스트 성별·신청 시각', $q$select string_agg(coalesce(e->>'gender', '-') || ':' || ((e->>'at')::timestamptz <= clock_timestamp())::text, ' ' order by (e->>'pos')::int)
  from public.signups_list(:mon, :mon) s, jsonb_array_elements(s->'entries') e$q$, '-:true -:true -:true M:true');
select pg_temp.eq('이름 없는 게스트(여) → 화요일 신청 완료', $q$select public.signup_guest('dddddddd-0000-0000-0000-000000000000', :mon + 1, '   ', 'F')::text$q$, '{"no": 1, "status": "in"}');
select pg_temp.eq('이름 없는 게스트는 이름 null·성별 F', $q$select coalesce(e->>'guest', 'null') || ':' || (e->>'gender') from public.signups_list(:mon + 1, :mon + 1) s, jsonb_array_elements(s->'entries') e$q$, 'null:F');
select pg_temp.eq('명단에 정원·메모', $q$select (s->>'cap') || '/' || (s->>'memo') from public.signups_list(:mon, :mon) s$q$, '2/랜덤빵 제공');
select pg_temp.eq('주말은 명단에 안 나옴', $q$select count(*)::text from public.signups_list(:mon, :mon + 6)$q$, '5');
-- 취소하면 대기 1번이 자동으로 들어가고 알림 대기열에
select pg_temp.eq('신청 안 한 사람 취소', $q$select public.signup_cancel('dddddddd-0000-0000-0000-000000000000', :mon)::text$q$, 'ERR not_signed');
select pg_temp.eq('a 취소 → c 자동 입장', $q$select public.signup_cancel('aaaaaaaa-0000-0000-0000-000000000000', :mon)::text$q$, '["c"]');
select pg_temp.eq('알림 대기열', $q$select string_agg(player_id || ':' || kind, ',') from public.signup_notice where sent_at is null$q$, 'c:in');
select pg_temp.eq('b 취소 → 게스트 들어감, b 다시 신청하면 맨 뒤 대기 1번', $q$select public.signup_cancel('bbbbbbbb-0000-0000-0000-000000000000', :mon)::text || public.signup_apply('bbbbbbbb-0000-0000-0000-000000000000', :mon)::text$q$, '["g:손님"]{"no": 1, "status": "wait"}');
select pg_temp.eq('게스트가 들어가면 데려온 사람에게 알림', $q$select string_agg(player_id || ':' || kind, ',' order by id) from public.signup_notice where sent_at is null$q$, 'c:in,d:guest_in');
-- 정원을 늘리면 대기자가 들어감
select pg_temp.eq('정원 3으로 → b 들어감', $q$select public.admin_set_day('11111111-1111-1111-1111-111111111111', :mon, 3, '랜덤빵 제공', false)::text$q$, '["b"]');
-- 돼장: 명단에 직접 넣기·빼기 (밴드·카톡으로 신청한 사람 정리)
select pg_temp.eq('돼장이 a 넣기 → 대기 1번', $q$select public.admin_signup_add('11111111-1111-1111-1111-111111111111', :mon, 'a')::text$q$, '{"no": 1, "status": "wait"}');
select pg_temp.eq('돼장 넣기: 쉬는 회원', $q$select public.admin_signup_add('11111111-1111-1111-1111-111111111111', :mon, 'z')::text$q$, 'ERR bad_player');
select pg_temp.eq('돼장이 c 빼기 → a 들어감', $q$select public.admin_signup_remove('11111111-1111-1111-1111-111111111111', :mon, (select id from public.signup where day = :mon and player_id = 'c'))::text$q$, '["a"]');
select pg_temp.eq('도우미는 명단 못 고침', $q$select public.admin_signup_add('22222222-2222-2222-2222-222222222222', :mon, 'c')::text$q$, 'ERR unauthorized');
-- 게스트 취소: 데려온 사람만(또는 돼장)
select pg_temp.eq('남의 게스트 취소', $q$select public.signup_guest_cancel('aaaaaaaa-0000-0000-0000-000000000000', (select id from public.signup where day = :mon and guest_name = '손님'))::text$q$, 'ERR not_yours');
select pg_temp.eq('내 게스트 취소', $q$select public.signup_guest_cancel('dddddddd-0000-0000-0000-000000000000', (select id from public.signup where day = :mon and guest_name = '손님'))::text$q$, '[]');
-- 쉬는 날(닫기): 신청 못 함, 이미 한 사람은 그대로 보임
select pg_temp.eq('돼장: 수요일 닫기', $q$select public.admin_set_day('11111111-1111-1111-1111-111111111111', :mon + 2, null, '체육관 사정', true)::text$q$, '[]');
select pg_temp.eq('닫힌 날 신청', $q$select public.signup_apply('aaaaaaaa-0000-0000-0000-000000000000', :mon + 2)::text$q$, 'ERR closed_day');
select pg_temp.eq('닫힌 날도 정원은 기본값', $q$select (s->>'cap') || ' ' || (s->>'closed') from public.signups_list(:mon + 2, :mon + 2) s$q$, '24 true');
-- 기본 정원 바꾸기 (돼장)
select pg_temp.eq('기본 정원: 목요일 20', $q$select public.admin_set_default_cap('11111111-1111-1111-1111-111111111111', 4, 20)::text$q$, '');
select pg_temp.eq('목요일 기본 20', $q$select public.workout_cap(:mon + 3)::text$q$, '20');
select pg_temp.eq('기본 정원 목록', $q$select public.workout_defaults()::text$q$, '[24, 18, 24, 20, 24]');
select pg_temp.eq('기본 정원: 토요일 거절', $q$select public.admin_set_default_cap('11111111-1111-1111-1111-111111111111', 6, 20)::text$q$, 'ERR bad_day');
-- 알림 꺼내기: 구독한 기기만, 한 번만
insert into public.push_subs (endpoint, player_id, p256dh, auth) values ('https://push.example/c', 'c', 'K', 'A');
select pg_temp.eq('알림 꺼내기(구독한 c만)', $q$select string_agg(replace(endpoint, 'https://push.example/', '') || ':' || kind || ':' || to_char(day, 'Dy'), ',') from public.signup_notices_take()$q$, 'c:in:Mon');
select pg_temp.eq('다시 꺼내면 없음', $q$select count(*)::text from public.signup_notices_take()$q$, '0');
-- anon은 표를 직접 못 읽음 (명단은 signups_list로만)
set local role anon;
select pg_temp.eq('anon 신청 표', $q$select count(*)::text from public.signup$q$, 'ERR permission denied for table signup');
select pg_temp.eq('anon 알림 표', $q$select count(*)::text from public.signup_notice$q$, 'ERR permission denied for table signup_notice');
select pg_temp.eq('anon 명단 함수', $q$select count(*)::text from public.signups_list(:mon, :mon)$q$, '1');
reset role;
rollback;
