-- live_action 규칙 확인 (로컬 Postgres 16). 실행: 빈 DB에 anon·authenticated 역할, extensions 스키마+pgcrypto, publication supabase_realtime을 만들고
-- schema.sql을 넣은 뒤  psql -qAt -d <db> < supabase/tests/live_action.sql  → 줄마다 '→ 숫자(rev)' 또는 '→ ERR 코드'
-- 기대값은 docs/deploy-log.md 49번 표. 실제 DB에서는 돌리지 말 것(app_state를 덮어씀)
insert into public.app_state (id, state, rev) values (1, '{}'::jsonb, 1) on conflict (id) do nothing;
update public.app_state set rev = 1, state = '{"settings":{},"weeks":[{"date":"2026-11-25","attendees":{"a":"A"},"matches":[
 {"id":"k1","pool":"A","a":["a","b"],"b":["c","d"],"win":null},
 {"id":"k2","pool":"A","a":["e","f"],"b":["g","h"],"win":null},
 {"id":"k3","pool":"A","a":["a","e"],"b":["i","j"],"win":null},
 {"id":"k4","pool":"B","a":["x","y"],"b":["z","w"],"win":null}]}]}'::jsonb where id = 1;
insert into public.admin_session (token, expires_at, role) values ('11111111-1111-1111-1111-111111111111', now() + interval '1 day', 'operator'), ('22222222-2222-2222-2222-222222222222', now() + interval '1 day', 'admin');
create or replace function pg_temp.t(p_label text, p_match text, p_action text, p_court int, p_side text) returns text language plpgsql as $$
begin
  return p_label || ' → ' || public.live_action('11111111-1111-1111-1111-111111111111', '2026-11-25', p_match, p_action, p_court, p_side)::text;
exception when others then return p_label || ' → ERR ' || sqlerrm;
end $$;
select pg_temp.t('k1 코트 1(고정 아님)', 'k1', 'start', 1, null);
select pg_temp.t('k1 코트 5', 'k1', 'start', 5, null);
select pg_temp.t('k2 코트 5(찼음)', 'k2', 'start', 5, null);
select pg_temp.t('k3 코트 6(a 경기 중)', 'k3', 'start', 6, null);
select pg_temp.t('k2 추가 코트(안 열림)', 'k2', 'start', 0, null);
select pg_temp.t('추가 코트 열기', null, 'extra_open', null, null);
select pg_temp.t('k2 추가 코트', 'k2', 'start', 0, null);
select pg_temp.t('추가 코트 닫기(경기 중)', null, 'extra_close', null, null);
select pg_temp.t('k2 결과 b', 'k2', 'finish', null, 'b');
select pg_temp.t('추가 코트 닫기', null, 'extra_close', null, null);
select pg_temp.t('k4 코트 6', 'k4', 'start', 6, null);
select pg_temp.t('k1 빼기', 'k1', 'cancel', null, null);
select pg_temp.t('k1 결과(코트 없음)', 'k1', 'finish', null, 'a');
select pg_temp.t('없는 동작', 'k1', 'jump', null, null);
update public.app_state set state = jsonb_set(state, '{settings,courts}', '[3,4]') where id = 1;
select pg_temp.t('설정 3·4번에서 코트 5', 'k1', 'start', 5, null);
select pg_temp.t('설정 3·4번에서 코트 3', 'k1', 'start', 3, null);
select 'admin_check(도우미 토큰) = ' || public.admin_check('11111111-1111-1111-1111-111111111111') || ', admin_check(돼장) = ' || public.admin_check('22222222-2222-2222-2222-222222222222');
select 'rev ' || rev || ' / extraCourt ' || coalesce(state->'weeks'->0->>'extraCourt', 'null') || ' / ' || (select string_agg(m->>'id' || ':' || coalesce(m->>'court', '-') || ':' || coalesce(m->>'win', '-'), ' ') from jsonb_array_elements(state->'weeks'->0->'matches') m) from public.app_state where id = 1;
