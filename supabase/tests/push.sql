-- 웹 푸시 대상 규칙 확인 (로컬 Postgres 16). 준비는 live_action.sql과 같음 → psql -qAt -d <db> < supabase/tests/push.sql
-- 전부 begin … rollback 안에서 돌아서 끝나면 아무것도 남지 않음(실제 DB에서는 돌리지 말 것)
begin;
insert into public.app_state (id, state, rev) values (1, '{}'::jsonb, 1) on conflict (id) do nothing;
update public.app_state set rev = 1, state = '{"settings":{},"players":[
 {"id":"a","name":"가가"},{"id":"b","name":"나나"},{"id":"c","name":"다다"},{"id":"d","name":"라라"},{"id":"e","name":"마마"},{"id":"f","name":"바바","active":false}],
 "weeks":[{"date":"2026-11-25","attendees":{},"matches":[
 {"id":"k1","pool":"A","a":["a","b"],"b":["c","d"],"win":null},
 {"id":"k2","pool":"A","a":["a","c"],"b":["b","d"],"win":null}]}]}'::jsonb where id = 1;
insert into public.admin_session (token, expires_at, role) values ('11111111-1111-1111-1111-111111111111', now() + interval '1 day', 'operator');
create or replace function pg_temp.t(p_label text, q text) returns text language plpgsql as $$
declare r text;
begin
  execute q into r;
  return p_label || ' → ' || coalesce(nullif(r, ''), 'ok');
exception when others then return p_label || ' → ERR ' || sqlerrm;
end $$;
select pg_temp.t('구독 a', $q$select public.push_subscribe('a', 'https://push.example/a', 'K', 'A')::text$q$);
select pg_temp.t('구독 c', $q$select public.push_subscribe('c', 'https://push.example/c', 'K', 'A')::text$q$);
select pg_temp.t('구독 e(예측만)', $q$select public.push_subscribe('e', 'https://push.example/e', 'K', 'A')::text$q$);
select pg_temp.t('구독 d(예측도 한 선수)', $q$select public.push_subscribe('d', 'https://push.example/d', 'K', 'A')::text$q$);
select pg_temp.t('같은 기기를 b로', $q$select public.push_subscribe('b', 'https://push.example/c', 'K2', 'A2')::text$q$);
select pg_temp.t('같은 기기를 다시 c로', $q$select public.push_subscribe('c', 'https://push.example/c', 'K', 'A')::text$q$);
select pg_temp.t('없는 선수', $q$select public.push_subscribe('zz', 'https://push.example/z', 'K', 'A')::text$q$);
select pg_temp.t('쉬는 선수', $q$select public.push_subscribe('f', 'https://push.example/f', 'K', 'A')::text$q$);
select pg_temp.t('http 주소', $q$select public.push_subscribe('a', 'http://push.example/x', 'K', 'A')::text$q$);
select pg_temp.t('구독 수', $q$select count(*)::text from public.push_subs$q$);
insert into public.predictions (week_date, player_id, mode, picks) values
 ('2026-11-25', 'e', 'safe', '[{"match":"k1","side":"a"}]'),
 ('2026-11-25', 'd', 'safe', '[{"match":"k1","side":"b"}]');
set local role anon;
select pg_temp.t('anon이 구독 읽기', $q$select count(*)::text from public.push_subs$q$);
reset role;
select pg_temp.t('토큰 없이', $q$select count(*)::text from public.push_targets('00000000-0000-0000-0000-000000000000', '2026-11-25', 'k1')$q$);
select pg_temp.t('코트에 없는 k1', $q$select count(*)::text from public.push_targets('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k1')$q$);
select pg_temp.t('없는 경기', $q$select count(*)::text from public.push_targets('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k9')$q$);
select pg_temp.t('k1 코트 5', $q$select public.live_action('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k1', 'start', 5, null)::text$q$);
select pg_temp.t('k1 대상', $q$select string_agg(replace(endpoint, 'https://push.example/', '') || ':' || kind || ':' || court || ':' || team_a || ' vs ' || team_b, ' | ' order by endpoint) from public.push_targets('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k1')$q$);
select pg_temp.t('k1 다시(중복)', $q$select count(*)::text from public.push_targets('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k1')$q$);
select pg_temp.t('k1 빼고 다시 넣기', $q$select public.live_action('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k1', 'cancel', null, null)::text || '/' || public.live_action('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k1', 'start', 6, null)::text$q$);
-- 한 트랜잭션 안이라 now()가 같아서 시작 시각이 같음 → 실제처럼 다른 시각으로 바꿈
update public.app_state set state = jsonb_set(state, '{weeks,0,matches,0,startedAt}', '"2026-11-25T11:00:00.000Z"') where id = 1;
select pg_temp.t('k1 새 시작 대상 수', $q$select count(*)::text from public.push_targets('11111111-1111-1111-1111-111111111111', '2026-11-25', 'k1')$q$);
select pg_temp.t('죽은 기기 지우기', $q$select public.push_gone('11111111-1111-1111-1111-111111111111', array['https://push.example/e'])::text$q$);
select pg_temp.t('죽은 기기(토큰 없이)', $q$select public.push_gone('00000000-0000-0000-0000-000000000000', array['https://push.example/a'])::text$q$);
select pg_temp.t('구독 해제 a', $q$select public.push_unsubscribe('https://push.example/a')::text$q$);
select pg_temp.t('남은 구독', $q$select string_agg(replace(endpoint, 'https://push.example/', '') || '=' || player_id, ' ' order by endpoint) from public.push_subs$q$);
rollback;
