-- 공지(notices) 규칙 확인 (로컬 Postgres 16). 준비는 live_action.sql과 같음 → psql -qAt -d <db> < supabase/tests/notices.sql
-- 줄마다 'ok 라벨' 또는 'FAIL 라벨: 받은 값 ≠ 기대값'. 전부 begin … rollback 안에서 돌아서 끝나면 아무것도 남지 않음(실제 DB에서는 돌리지 말 것)
begin;
insert into public.admin_session (token, expires_at, role) values
 ('11111111-1111-1111-1111-111111111111', now() + interval '1 day', 'admin'),
 ('22222222-2222-2222-2222-222222222222', now() + interval '1 day', 'operator'),
 ('33333333-3333-3333-3333-333333333333', now() - interval '1 day', 'admin');
create or replace function pg_temp.got(q text) returns text language plpgsql as $$
declare r text;
begin
  execute q into r; return coalesce(r, 'null');
exception when others then return 'ERR ' || sqlerrm;
end $$;
create or replace function pg_temp.eq(p_label text, q text, want text) returns text language plpgsql as $$
declare g text := pg_temp.got(q);
begin
  return case when g = want or (want = '<id>' and g ~ '^\d+$') then 'ok ' || p_label else 'FAIL ' || p_label || ': ' || g || ' ≠ ' || want end;
end $$;

-- 쓰기 권한: 돼장(admin)·도우미(operator)만, 만료된 세션·모르는 토큰은 거절
select pg_temp.eq('돼장 새 공지', $q$select public.notice_save('11111111-1111-1111-1111-111111111111', null, '운동', E'11.30~12.4 배드민턴위크\n밴드에서 신청', true, '2026-12-04')::text$q$, '<id>');
select pg_temp.eq('도우미 새 공지', $q$select public.notice_save('22222222-2222-2222-2222-222222222222', null, '결과·소식', '돼블스플랜 적중자 발표', false, null)::text$q$, '<id>');
select pg_temp.eq('만료 세션 거절', $q$select public.notice_save('33333333-3333-3333-3333-333333333333', null, '운동', 'x', false, null)::text$q$, 'ERR unauthorized');
select pg_temp.eq('모르는 토큰 거절', $q$select public.notice_save('44444444-4444-4444-4444-444444444444', null, '운동', 'x', false, null)::text$q$, 'ERR unauthorized');
-- 값 검사
select pg_temp.eq('없는 종류', $q$select public.notice_save('11111111-1111-1111-1111-111111111111', null, '잡담', 'x', false, null)::text$q$, 'ERR bad_kind');
select pg_temp.eq('빈 본문', $q$select public.notice_save('11111111-1111-1111-1111-111111111111', null, '운동', '   ', false, null)::text$q$, 'ERR bad_body');
select pg_temp.eq('너무 긴 본문', $q$select public.notice_save('11111111-1111-1111-1111-111111111111', null, '운동', repeat('가', 4001), false, null)::text$q$, 'ERR bad_body');
-- (저장과 확인을 한 문장에 넣으면 같은 스냅샷이라 새 행이 안 보이고, WHERE 안에서 부르면 행마다 다시 저장됨 → 두 문장으로)
select pg_temp.eq('규칙 공지(고정 안 함, 기한 줌)', $q$select public.notice_save('11111111-1111-1111-1111-111111111111', null, '규칙', '셔틀콕 안내', false, '2026-12-31')::text$q$, '<id>');
select pg_temp.eq('고정 안 하면 기한 버림', $q$select (pin_until is null and not pinned)::text from public.notices where kind = '규칙'$q$, 'true');
-- 목록: 누구나(익명) 읽기, 최근 순, 지운 공지는 안 보임
select pg_temp.eq('목록 수', $q$select count(*)::text from public.notices_list()$q$, '3');
select pg_temp.eq('목록 첫 줄(최근)', $q$select kind from public.notices_list() limit 1$q$, '규칙');
-- 고치기: 본문·고정 바꾸기, 없는 번호는 not_found
select pg_temp.eq('고치기', $q$select public.notice_save('22222222-2222-2222-2222-222222222222', (select id from public.notices where kind = '결과·소식'), '결과·소식', '돼블스플랜 적중자 발표 (수정)', true, '2026-11-30')::text = (select id from public.notices where kind = '결과·소식')::text$q$, 'true');
select pg_temp.eq('고친 본문', $q$select body from public.notices where kind = '결과·소식'$q$, '돼블스플랜 적중자 발표 (수정)');
select pg_temp.eq('없는 번호 고치기', $q$select public.notice_save('11111111-1111-1111-1111-111111111111', 999999, '운동', 'x', false, null)::text$q$, 'ERR not_found');
-- 지우기: 돼장·도우미만, 지운 뒤 목록에서 빠짐, 지운 공지는 다시 못 고침
select pg_temp.eq('익명 지우기 거절', $q$select public.notice_delete('44444444-4444-4444-4444-444444444444', (select id from public.notices where kind = '규칙'))::text$q$, 'ERR unauthorized');
select pg_temp.eq('도우미 지우기', $q$select public.notice_delete('22222222-2222-2222-2222-222222222222', (select id from public.notices where kind = '규칙'))::text$q$, 'true');
select pg_temp.eq('지운 뒤 목록 수', $q$select count(*)::text from public.notices_list()$q$, '2');
select pg_temp.eq('지운 공지 고치기', $q$select public.notice_save('11111111-1111-1111-1111-111111111111', (select id from public.notices where kind = '규칙'), '규칙', 'x', false, null)::text$q$, 'ERR not_found');
-- 표 직접 접근은 막힘 (익명)
set local role anon;
select pg_temp.eq('익명 표 읽기 막힘', $q$select count(*)::text from public.notices$q$, 'ERR permission denied for table notices');
select pg_temp.eq('익명 목록 함수는 됨', $q$select count(*)::text from public.notices_list()$q$, '2');
select pg_temp.eq('익명 토큰 없이 쓰기', $q$select public.notice_save(null, null, '운동', 'x', false, null)::text$q$, 'ERR unauthorized');
reset role;
rollback;
