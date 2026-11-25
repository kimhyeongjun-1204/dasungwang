// 외부 배포(Supabase + GitHub Pages) 테스트 (node deploy.test.js) — 구현 전에 작성
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { passed++; console.log('  ok  ' + name); },
    e => { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }));
}

let R = null;
try { R = require('./remote.js'); } catch (e) { }
function need() { if (!R) throw new Error('remote.js 없음'); return R; }

function memStore() {
  const m = {};
  return { m, get: k => (k in m ? m[k] : null), set: (k, v) => { m[k] = String(v); }, del: k => { delete m[k]; } };
}
// supabase-js 클라이언트 흉내: rpc(name, args) → { data, error }
function fakeClient(handlers, row) {
  const calls = [];
  return {
    calls,
    rpc(name, args) { calls.push([name, args]); return Promise.resolve(handlers[name](args)); },
    from(t) {
      const q = { select() { return q; }, eq() { return q; }, single() { calls.push(['select', t]); return Promise.resolve(row()); } };
      return q;
    },
  };
}
const SAMPLE = { v: 1, rev: 7, savedAt: '2026-10-17T16:34:24.102Z', settings: { club: 'x', pin: { salt: 's', hash: 'h' }, groups: [] }, players: [], weeks: [] };

console.log('remote.js');
test('publicState: settings.pin·rev·savedAt을 빼고 원본은 그대로', () => {
  const p = need().publicState(SAMPLE);
  assert.strictEqual(p.settings.pin, undefined);
  assert.strictEqual(p.rev, undefined);
  assert.strictEqual(p.savedAt, undefined);
  assert.strictEqual(p.settings.club, 'x');
  assert.ok(SAMPLE.settings.pin, '원본 변경 금지');
});
test('fromRow: DB 행을 앱 state로 (rev, savedAt 채우고 pin 제거)', () => {
  const s = need().fromRow({ state: { settings: { club: 'x', pin: { hash: 'h' } }, players: [], weeks: [] }, rev: 8, saved_at: '2026-10-19T00:00:00Z' });
  assert.strictEqual(s.rev, 8);
  assert.strictEqual(s.savedAt, '2026-10-19T00:00:00Z');
  assert.strictEqual(s.settings.pin, undefined);
});
test('errorCode: 서버 에러를 구분', () => {
  const E = need().errorCode;
  assert.strictEqual(E({ message: 'stale_rev', code: 'P0001' }).code, 'stale_rev');
  assert.strictEqual(E({ message: 'unauthorized', code: 'P0001' }).code, 'unauthorized');
  assert.strictEqual(E({ message: 'no_pin', code: 'P0001' }).code, 'no_pin');
  assert.strictEqual(E({ message: 'TypeError: Failed to fetch', code: '' }).code, 'network');
  assert.strictEqual(E({ message: 'something else' }).code, 'error');
  assert.strictEqual(E(null).code, 'error');
});
test('토큰: 30일 보관, 만료되면 없음, 지우기', () => {
  const r = need(), ls = memStore(), now = Date.UTC(2026, 9, 19);
  r.saveToken(ls, 'tok-1', now);
  assert.strictEqual(r.loadToken(ls, now + 29 * 864e5), 'tok-1');
  assert.strictEqual(r.loadToken(ls, now + 31 * 864e5), null);
  r.saveToken(ls, 'tok-2', now);
  r.clearToken(ls);
  assert.strictEqual(r.loadToken(ls, now), null);
});
test('토큰: 저장소가 깨져 있어도 예외 없이 null', () => {
  const r = need(), ls = memStore();
  ls.set(r.TOKEN_KEY, '{not json');
  assert.strictEqual(r.loadToken(ls, Date.now()), null);
  const broken = { get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); }, del() { throw new Error('blocked'); } };
  assert.strictEqual(r.loadToken(broken, Date.now()), null);
  r.saveToken(broken, 't', Date.now());
  r.clearToken(broken);
});
test('api.load: app_state 1행을 읽어 앱 state로', async () => {
  const c = fakeClient({}, () => ({ data: { state: { settings: {}, players: [], weeks: [] }, rev: 7, saved_at: 't' }, error: null }));
  const s = await need().api(c).load();
  assert.strictEqual(s.rev, 7);
  assert.deepStrictEqual(c.calls[0], ['select', 'app_state']);
});
test('api.save: pin 뺀 state와 expected_rev를 보내고 새 rev를 돌려받음', async () => {
  const c = fakeClient({ save_state: () => ({ data: 8, error: null }) });
  const rev = await need().api(c).save('tok', SAMPLE, 7);
  assert.strictEqual(rev, 8);
  const [name, args] = c.calls[0];
  assert.strictEqual(name, 'save_state');
  assert.strictEqual(args.token, 'tok');
  assert.strictEqual(args.expected_rev, 7);
  assert.strictEqual(args.new_state.settings.pin, undefined);
  assert.strictEqual(args.new_state.rev, undefined);
});
test('api.save: stale_rev는 code로 구분돼 reject', async () => {
  const c = fakeClient({ save_state: () => ({ data: null, error: { message: 'stale_rev', code: 'P0001' } }) });
  await assert.rejects(need().api(c).save('tok', SAMPLE, 6), e => e.code === 'stale_rev');
});
test('api.login: 맞으면 토큰, 틀리면 null, PIN 미설정이면 no_pin', async () => {
  const r = need();
  assert.strictEqual(await r.api(fakeClient({ admin_login: a => ({ data: a.pin === '1234' ? 'tok' : null, error: null }) })).login('1234'), 'tok');
  assert.strictEqual(await r.api(fakeClient({ admin_login: () => ({ data: null, error: null }) })).login('0000'), null);
  await assert.rejects(r.api(fakeClient({ admin_login: () => ({ data: null, error: { message: 'no_pin' } }) })).login('1'), e => e.code === 'no_pin');
});
test('api.check / changePin / logout: RPC 이름과 인자', async () => {
  const c = fakeClient({ admin_check: () => ({ data: true, error: null }), change_pin: () => ({ data: null, error: null }), admin_logout: () => ({ data: null, error: null }) });
  const a = need().api(c);
  assert.strictEqual(await a.check('tok'), true);
  await a.changePin('tok', '1111', '2222');
  await a.logout('tok');
  assert.deepStrictEqual(c.calls.map(x => x[0]), ['admin_check', 'change_pin', 'admin_logout']);
  assert.deepStrictEqual(c.calls[1][1], { token: 'tok', old_pin: '1111', new_pin: '2222' });
});

// 돼블스플랜: 표 읽기 흉내 (select·eq·order·limit 기록)
function tableClient(rows, handlers) {
  const calls = [];
  return {
    calls,
    rpc(name, args) { calls.push(['rpc', name, args]); return Promise.resolve(handlers[name](args)); },
    from(t) {
      const c = ['from', t];
      calls.push(c);
      const q = {
        select(s) { c.push('select:' + s); return q; }, eq(k, v) { c.push(k + '=' + v); return q; },
        order(k, o) { c.push('order:' + k + (o && o.ascending === false ? ' desc' : '')); return q; }, limit(n) { c.push('limit:' + n); return q; },
        then(res, rej) { return Promise.resolve({ data: rows[t] || [], error: null }).then(res, rej); },
      };
      return q;
    },
  };
}
test('api 예측: counts·events·close·predictions를 그 주 기준으로 읽음', async () => {
  const c = tableClient({ prediction_counts: [{ match_id: 'm1', side: 'a', mode: 'high', n: 2 }] }, {});
  const a = need().api(c);
  assert.deepStrictEqual(await a.predCounts('2026-11-18'), [{ match_id: 'm1', side: 'a', mode: 'high', n: 2 }]);
  await a.predEvents('2026-11-18');
  await a.predClose('2026-11-18');
  await a.predictions();
  assert.deepStrictEqual(c.calls[0].slice(0, 2), ['from', 'prediction_counts']);
  assert.ok(c.calls[0].includes('week_date=2026-11-18'));
  assert.ok(c.calls[1].includes('order:id desc') && c.calls[1].some(x => /^limit:\d+$/.test(x)), '이벤트는 최신순 일부만');
  assert.deepStrictEqual(c.calls.map(x => x[1]), ['prediction_counts', 'prediction_events', 'prediction_close', 'predictions']);
});
test('api.submitPrediction: RPC 이름·인자, 마감 후는 closed 코드', async () => {
  const picks = [{ match: 'm1', side: 'a' }];
  const c = tableClient({}, { submit_prediction: () => ({ data: 't', error: null }) });
  await need().api(c).submitPrediction('2026-11-18', 'p001', 'high', picks);
  assert.deepStrictEqual(c.calls[0], ['rpc', 'submit_prediction', { week_date: '2026-11-18', player_id: 'p001', mode: 'high', picks }]);
  const bad = tableClient({}, { submit_prediction: () => ({ data: null, error: { message: 'closed', code: 'P0001' } }) });
  await assert.rejects(need().api(bad).submitPrediction('2026-11-18', 'p001', 'high', picks), e => e.code === 'closed');
  for (const m of ['bad_player', 'dup_match', 'bad_match', 'bad_count', 'bad_side', 'no_week', 'bad_quota']) assert.strictEqual(need().errorCode({ message: m }).code, m);
});
test('api 예측 관리: 토큰과 함께 목록·수정·삭제, 마감 스냅숏', async () => {
  const ok = () => ({ data: [], error: null });
  const c = tableClient({}, { admin_list_predictions: ok, admin_upsert_prediction: ok, admin_delete_prediction: ok, close_snapshot: ok });
  const a = need().api(c);
  await a.adminListPredictions('tok', '2026-11-18');
  await a.adminUpsertPrediction('tok', '2026-11-18', 'p001', 'safe', []);
  await a.adminDeletePrediction('tok', '2026-11-18', 'p001');
  await a.closeSnapshot('2026-11-18');
  assert.deepStrictEqual(c.calls.map(x => x[1]), ['admin_list_predictions', 'admin_upsert_prediction', 'admin_delete_prediction', 'close_snapshot']);
  assert.deepStrictEqual(c.calls[1][2], { token: 'tok', week_date: '2026-11-18', player_id: 'p001', mode: 'safe', picks: [] });
  assert.deepStrictEqual(c.calls[2][2], { token: 'tok', week_date: '2026-11-18', player_id: 'p001' });
});
test('api.watchPredictions: Realtime이 없거나 꺼져 있으면 구독 안 하고 live=false', () => {
  const r = need();
  const w = r.api(tableClient({}, {})).watchPredictions('2026-11-18', () => { });
  assert.strictEqual(w.live(), false);
  w.stop();
  const subs = [];
  const rt = { channel(n) { const ch = { on(ev, f, cb) { subs.push(f); return ch; }, subscribe(cb) { cb('SUBSCRIBED'); return ch; } }; return ch; }, removeChannel() { } };
  const off = r.api(rt, { realtime: false }).watchPredictions('2026-11-18', () => { });
  assert.strictEqual(off.live(), false);
  assert.strictEqual(subs.length, 0);
  const on = r.api(rt).watchPredictions('2026-11-18', () => { });
  assert.strictEqual(on.live(), true);
  assert.deepStrictEqual(subs.map(f => f.table).sort(), ['prediction_counts', 'prediction_events']);
  assert.ok(subs.every(f => f.filter === 'week_date=eq.2026-11-18'));
});

// 돼장 요청 → Edge Function 'rematch'
function fnClient(reply) {
  const calls = [];
  return { calls, functions: { invoke(name, opts) { calls.push([name, opts]); return Promise.resolve(reply); } } };
}
test('api.rematch: 토큰과 요청을 rematch 함수로 보내고 plan·설명을 돌려받음', async () => {
  const c = fnClient({ data: { ok: true, plan: { edits: [] }, explanation: '바꿨어요', usage: { input_tokens: 10, output_tokens: 5 } }, error: null });
  const r = await need().api(c).rematch('tok', { request: '철수랑 영희 떼어줘', date: '2026-10-21' });
  assert.strictEqual(c.calls[0][0], 'rematch');
  assert.strictEqual(c.calls[0][1].body.token, 'tok');
  assert.strictEqual(c.calls[0][1].body.request, '철수랑 영희 떼어줘');
  assert.deepStrictEqual(r.plan, { edits: [] });
  assert.strictEqual(r.explanation, '바꿨어요');
});
test('api.rematch: 함수가 ok:false면 code로 reject (unauthorized, ai_limit …)', async () => {
  const r = need();
  await assert.rejects(r.api(fnClient({ data: { ok: false, code: 'ai_limit' }, error: null })).rematch('t', {}), e => e.code === 'ai_limit');
  await assert.rejects(r.api(fnClient({ data: null, error: { message: 'Failed to send a request to the Edge Function' } })).rematch('t', {}), e => e.code === 'network');
});

test('schema.sql pred_check: 조별 고정(bad_quota)이 logic.js PREDICT.quota와 같음', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8');
  const m = sql.match(/q jsonb := '(\{[^']*\})'/);
  assert.ok(m, 'pred_check에 조별 고정 값이 없음');
  assert.deepStrictEqual(JSON.parse(m[1]), require('./logic.js').PREDICT.quota);
  assert.ok(/raise exception 'bad_quota'/.test(sql), 'bad_quota 오류 없음');
  assert.ok(/function public\.prediction_match_pools\(d date\)/.test(sql), '경기→조 함수 없음');
});
test('schema.sql 경기 진행: availability 테이블(읽기만 공개)·본인/돼장 RPC·Realtime (2026-11-20)', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8');
  assert.ok(/create table if not exists public\.availability \(/.test(sql), 'availability 테이블 없음');
  assert.ok(/check \(status in \('late', 'away', 'out'\)\)/.test(sql), '상태 값 제한 없음');
  assert.ok(/alter table public\.availability enable row level security/.test(sql), 'RLS 안 켬');
  assert.ok(/revoke all on public\.availability from anon, authenticated/.test(sql) && /grant select on public\.availability to anon, authenticated/.test(sql), '읽기만 공개가 아님');
  const self = sql.match(/function public\.set_availability\([\s\S]*?end \$\$;/);
  assert.ok(self, '본인용 set_availability 없음');
  for (const code of ['not_today', 'not_attending', 'admin_locked', 'bad_status', 'bad_minutes']) assert.ok(self[0].includes("'" + code + "'"), 'set_availability에 ' + code + ' 검사 없음');
  assert.ok(/p_status not in \('late', 'away', 'here'\)/.test(self[0]), '회원이 오늘 못 함(out)을 직접 넣을 수 있음');
  const adm = sql.match(/function public\.admin_set_availability\([\s\S]*?end \$\$;/);
  assert.ok(adm && /live_check\(/.test(adm[0]), '돼장용 admin_set_availability가 토큰을 확인하지 않음');  // 진행 PIN 뒤로 돼장·도우미 둘 다
  assert.ok(/public\.set_availability\(date, text, text, int\)/.test(sql) && /public\.admin_set_availability\(uuid, date, text, text, int\)/.test(sql), 'RPC 실행 권한(grant execute) 없음');
  for (const t of ['availability', 'app_state']) assert.ok(new RegExp("tablename = '" + t + "'[\\s\\S]*?add table public\\." + t).test(sql), t + ' Realtime 등록 없음');
});
test('api 경기 진행: 자리 비움 읽기·본인/돼장 저장, 상태(app_state)·자리 비움 Realtime 구독', async () => {
  const ok = () => ({ data: 't', error: null });
  const c = tableClient({ availability: [{ player_id: 'p1', status: 'away' }] }, { set_availability: ok, admin_set_availability: ok });
  const a = need().api(c);
  assert.deepStrictEqual(await a.availability('2026-11-25'), [{ player_id: 'p1', status: 'away' }]);
  assert.ok(c.calls[0].includes('week_date=2026-11-25'));
  await a.setAvailability('2026-11-25', 'p1', 'away', 30);
  await a.adminSetAvailability('tok', '2026-11-25', 'p2', 'out', null);
  assert.deepStrictEqual(c.calls[1], ['rpc', 'set_availability', { p_week: '2026-11-25', p_player: 'p1', p_status: 'away', p_minutes: 30 }]);
  assert.deepStrictEqual(c.calls[2], ['rpc', 'admin_set_availability', { token: 'tok', p_week: '2026-11-25', p_player: 'p2', p_status: 'out', p_minutes: null }]);
  for (const m of ['not_today', 'not_attending', 'admin_locked', 'bad_status', 'bad_minutes']) assert.strictEqual(need().errorCode({ message: m }).code, m);
  const subs = [];
  const rt = { channel(n) { const ch = { on(ev, f, cb) { subs.push(f); return ch; }, subscribe(cb) { cb('SUBSCRIBED'); return ch; } }; return ch; }, removeChannel() { } };
  const w = need().api(rt).watchLive('2026-11-25', () => { });
  assert.strictEqual(w.live(), true);
  assert.deepStrictEqual(subs.map(f => f.table + ':' + (f.filter || '')).sort(), ['app_state:', 'availability:week_date=eq.2026-11-25']);
  const off = need().api(rt, { realtime: false }).watchLive('2026-11-25', () => { });
  assert.strictEqual(off.live(), false);
});
test('schema.sql 진행 PIN: 역할(role) 세션, admin_check는 돼장만, 진행 동작은 서버에서 경기 하나만 바꿈 (2026-11-20)', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8');
  const iRole = sql.indexOf("alter table public.admin_session add column if not exists role text not null default 'admin'");
  assert.ok(iRole > 0, 'admin_session.role 없음');
  assert.ok(iRole < sql.indexOf('create or replace function public.admin_check'), 'role 열을 admin_check보다 먼저 만들어야 함(sql 함수는 만들 때 열을 확인)');
  assert.ok(/function public\.admin_check\(token uuid\)[\s\S]*?s\.role = 'admin'/.test(sql), 'admin_check가 진행 도우미 토큰도 돼장으로 인정함');
  assert.ok(/alter table public\.admin_secret add column if not exists op_pin_hash text/.test(sql), '진행 PIN 저장 칸 없음');
  const login = sql.match(/function public\.operator_login\([\s\S]*?end \$\$;/);
  assert.ok(login && /'operator'/.test(login[0]) && /interval '365 days'/.test(login[0]), '진행 로그인이 operator 역할·계속 유지(365일, PIN 바꾸거나 끄면 끊김)가 아님 (사용자 결정 2026-11-20)');
  const setp = sql.match(/function public\.set_operator_pin\([\s\S]*?end \$\$;/);
  assert.ok(setp && /admin_check\(/.test(setp[0]) && /'same_as_admin'/.test(setp[0]), '진행 PIN 설정이 돼장 확인·관리 PIN과 같은지 확인을 안 함');
  assert.ok(/function public\.change_pin[\s\S]*?'same_as_operator'[\s\S]*?end \$\$;/.test(sql), '관리 PIN을 진행 PIN과 같게 바꾸는 걸 안 막음');
  const act = sql.match(/function public\.live_action\([\s\S]*?end \$\$;/);
  assert.ok(act, 'live_action 없음');
  for (const c of ['unauthorized', 'no_week', 'no_match', 'bad_court', 'court_busy', 'player_busy', 'already_done', 'not_on_court', 'bad_side', 'bad_action']) assert.ok(act[0].includes("'" + c + "'"), 'live_action에 ' + c + ' 없음');
  assert.ok(/for update/.test(act[0]) && /rev = cur \+ 1/.test(act[0]), 'live_action이 잠금·rev 올리기를 안 함');
  assert.ok(/function public\.admin_set_availability[\s\S]*?public\.live_check\(/.test(sql), '자리 비움 관리가 진행 도우미를 안 받음');
  for (const f of ['operator_login(text)', 'live_check(uuid)', 'set_operator_pin(uuid, text)', 'live_action(uuid, date, text, text, int, text)'])
    assert.ok(sql.includes('public.' + f), f + ' 실행 권한 없음');
});
test('api 진행 PIN: 로그인·역할 확인·진행 동작·PIN 설정, 토큰에 역할 저장', async () => {
  const ok = v => () => ({ data: v, error: null });
  const c = tableClient({}, { operator_login: ok('otok'), live_check: ok('operator'), live_action: ok(9), set_operator_pin: ok(null) });
  const a = need().api(c);
  assert.strictEqual(await a.operatorLogin('5678'), 'otok');
  assert.strictEqual(await a.liveCheck('otok'), 'operator');
  assert.strictEqual(await a.liveAction('otok', '2026-11-25', 'm1', 'start', 2, null), 9);
  await a.setOperatorPin('tok', '5678');
  assert.deepStrictEqual(c.calls.map(x => x[1]), ['operator_login', 'live_check', 'live_action', 'set_operator_pin']);
  assert.deepStrictEqual(c.calls[2][2], { token: 'otok', p_week: '2026-11-25', p_match: 'm1', p_action: 'start', p_court: 2, p_side: null });
  for (const m of ['court_busy', 'player_busy', 'already_done', 'not_on_court', 'no_match', 'same_as_admin', 'same_as_operator', 'no_op_pin']) assert.strictEqual(need().errorCode({ message: m }).code, m);
  const r = need(), ls = memStore(), now = Date.parse('2026-11-25T19:00:00+09:00');
  r.saveToken(ls, 'otok', now, 'operator', now + r.OP_DAYS * 864e5);
  assert.strictEqual(r.OP_DAYS, 365, '도우미 로그인은 계속 유지(365일)');
  assert.deepStrictEqual(r.loadSession(ls, now + 300 * 864e5), { token: 'otok', role: 'operator' });
  assert.strictEqual(r.loadSession(ls, now + 366 * 864e5), null);
  r.saveToken(ls, 'atok', now);
  assert.deepStrictEqual(r.loadSession(ls, now), { token: 'atok', role: 'admin' }, '예전처럼 저장하면 돼장');
});
test('schema.sql 웹 푸시: 구독은 아무도 못 읽고, 보낼 대상은 돼장·도우미 토큰으로만·코트에 있는 경기만·한 번만 (2026-11-23)', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8');
  assert.ok(/create table if not exists public\.push_subs \(/.test(sql) && /alter table public\.push_subs enable row level security/.test(sql), 'push_subs 테이블·RLS 없음');
  assert.ok(/revoke all on public\.push_subs from anon, authenticated/.test(sql) && !/grant select on public\.push_subs/.test(sql), '구독(기기 주소)이 공개 읽기 가능');
  assert.ok(/create table if not exists public\.push_log \(/.test(sql), '중복 전송 막는 기록 없음');
  const sub = sql.match(/function public\.push_subscribe\([\s\S]*?end \$\$;/);
  assert.ok(sub && /'bad_player'/.test(sub[0]) && /'bad_endpoint'/.test(sub[0]) && /\^https:\/\//.test(sub[0]), 'push_subscribe가 이름·주소를 확인하지 않음');
  const tg = sql.match(/function public\.push_targets\([\s\S]*?end \$\$;/);
  assert.ok(tg, 'push_targets 없음');
  assert.ok(/live_check\(/.test(tg[0]) && /'unauthorized'/.test(tg[0]) && /'not_on_court'/.test(tg[0]), 'push_targets가 토큰·코트 확인을 안 함');
  assert.ok(/insert into public\.push_log[\s\S]*on conflict do nothing/.test(tg[0]), '같은 시작에 두 번 보내는 걸 안 막음');
  assert.ok(/'player'/.test(tg[0]) && /'predictor'/.test(tg[0]) && /public\.predictions/.test(tg[0]), '경기 4명·예측한 사람 둘 다 대상이어야 함');
  assert.ok(/function public\.push_gone\([\s\S]*?live_check\(/.test(sql), '죽은 구독 지우기에 토큰 확인 없음');
  for (const f of ['push_subscribe(text, text, text, text)', 'push_unsubscribe(text)', 'push_targets(uuid, date, text)', 'push_gone(uuid, text[])'])
    assert.ok(new RegExp('grant execute on function[^;]*public\\.' + f.replace(/[()[\]]/g, '\\$&')).test(sql), f + ' 실행 권한 없음');
});
test('웹 푸시 화면·API: 알림 받기(내 이름으로 구독), 서비스 워커 push·클릭, 코트에 넣으면 notify 호출', async () => {
  assert.ok(/data-act="push-on"/.test(appSrc) && /data-act="push-off"/.test(appSrc), '알림 켜기·끄기 버튼 없음');
  assert.ok(/pushManager\.subscribe\(/.test(appSrc) && /applicationServerKey/.test(appSrc) && /userVisibleOnly: true/.test(appSrc), '구독 코드 없음');
  assert.ok(/action === 'start'[\s\S]{0,200}remote\.notifyCourt\(/.test(appSrc), '코트에 넣은 뒤 알림 보내기 없음');
  const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  assert.ok(/addEventListener\('push'/.test(sw) && /showNotification\(/.test(sw) && /addEventListener\('notificationclick'/.test(sw), '서비스 워커에 push·notificationclick 없음');
  const c = tableClient({}, { push_subscribe: () => ({ data: null, error: null }), push_unsubscribe: () => ({ data: null, error: null }) });
  const a = need().api(c);
  await a.pushSubscribe('p1', { endpoint: 'https://e', keys: { p256dh: 'k', auth: 'a' } });
  await a.pushUnsubscribe('https://e');
  assert.deepStrictEqual(c.calls[0], ['rpc', 'push_subscribe', { p_player: 'p1', p_endpoint: 'https://e', p_p256dh: 'k', p_auth: 'a' }]);
  assert.deepStrictEqual(c.calls[1], ['rpc', 'push_unsubscribe', { p_endpoint: 'https://e' }]);
  const wf = fs.readFileSync(path.join(__dirname, '.github', 'workflows', fs.readdirSync(path.join(__dirname, '.github', 'workflows'))[0]), 'utf8');
  assert.ok(/node --experimental-strip-types push\.test\.mjs/.test(wf), 'CI에서 push.test.mjs를 안 돌림');
});
test('알림 받기 카드: 돼장·도우미로 로그인한 기기에서도 보여야 함 (그 사람도 선수, 2026-11-23)', () => {
  const g = appSrc.match(/function pushCard\(short\) \{\n\s*if \(([^)]*)\) return '';/);
  assert.ok(g, 'pushCard 첫 줄 모양을 못 찾음');
  assert.ok(!/ui\.admin|ui\.op/.test(g[1]), '돼장·도우미 로그인이면 알림 카드를 숨김: ' + g[1]);
});
test('알림 켠 뒤 팝업 설정 안내: 시험 알림을 바로 보내고, 길게 눌러 팝업으로 표시 켜는 방법·다시 보내기 버튼 (2026-11-23)', () => {
  const on = appSrc.match(/function pushOn\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(on && /pushTest\(\)/.test(on[0]), '알림을 켜면 시험 알림을 바로 보내야 함');
  const t = appSrc.match(/function pushTest\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(t && /showNotification\(/.test(t[0]) && /tag: 'ddw-test'/.test(t[0]), 'pushTest가 서비스 워커로 시험 알림을 띄워야 함(안드로이드는 new Notification 불가)');
  assert.ok(/data-act="push-test"/.test(appSrc) && /case 'push-test'/.test(appSrc), '시험 알림 다시 보내기 버튼 없음');
  assert.ok(/data-act="push-help"/.test(appSrc) && /case 'push-help'/.test(appSrc), '안내 다시 보기 없음');
  assert.ok(/길게/.test(appSrc) && /팝업으로 표시/.test(appSrc) && /알림 스타일/.test(appSrc), '안드로이드(길게 눌러 팝업으로 표시)·아이폰(알림 스타일) 안내 문구 없음');
});
test('이번 주 · 내 경기 보기 맨 위에 알림 카드 (안 켠 사람만, 경기날 아니어도) (2026-11-23)', () => {
  const i = appSrc.indexOf("var mine = ui.me && !ui.admin");
  const j = appSrc.indexOf('courtsStrip(w, board, P, pickOf)', i);
  assert.ok(i > 0 && j > i, '이번 주 화면 구조를 못 찾음');
  const top = appSrc.slice(i, j);
  assert.ok(/if \(mine && \(pushNeeded\(\)[^\n]*\) out \+= pushCard\(true\);/.test(top), '내 경기 보기에서 지금 코트보다 위에 알림 카드가 없음');
  assert.ok(/function pushNeeded\(\) \{ return push\.st === 'default' \|\| push\.st === 'ios' \|\| push\.st === 'denied'; \}/.test(appSrc), '켜짐·지원 안 함·키 없음일 때는 안 보여야 함');
  assert.ok(!/today && push\.st === 'default' \? pushCard\(true\)/.test(appSrc), '맨 아래 카드가 남아 있으면 두 번 보임');
});
test('내 경기 화면에서 알림 받기를 눌러도 팝업 안내가 그 자리에 남고, "다 했어요"로 닫음 (2026-11-23)', () => {
  assert.ok(/if \(mine && \(pushNeeded\(\) \|\| \(push\.st === 'on' && push\.help\)\)\) out \+= pushCard\(true\);/.test(appSrc), '켜자마자 카드가 사라져 안내를 못 봄');
  assert.ok(/data-act="push-done"/.test(appSrc) && /case 'push-done': push\.help = false;/.test(appSrc), '안내 닫기(다 했어요) 없음');
});
test('경기 진행: 경기를 누르면 빈 코트 고르는 창, 이김·코트에서 빼기는 확인 창을 거침 (2026-11-23)', () => {
  const v = appSrc.match(/function viewLive\(w, P\) \{[\s\S]*?\n  \}\n/);
  assert.ok(v, 'viewLive 없음');
  // 바로 가능 목록에는 "코트 N에 넣기" 버튼을 반복하지 않고, 경기 자체를 누르면 고르는 창
  assert.ok(!/data-act="lv-start"/.test(v[0]), '바로 가능 목록이나 코트 카드에서 바로 코트에 넣음(고르는 창 없이)');
  assert.ok(/data-act="lv-ask-start"/.test(v[0]), '경기를 눌러 코트 고르기 창을 여는 버튼 없음');
  assert.ok(!/data-act="lv-win"/.test(v[0]) && /data-act="lv-ask-win"/.test(v[0]), '이김이 확인 없이 바로 저장됨');
  assert.ok(!/data-act="lv-cancel"/.test(v[0]) && /data-act="lv-ask-cancel"/.test(v[0]), '코트에서 빼기가 확인 없이 바로 실행됨');
  const sh = appSrc.match(/function lvSheet\(w, b, P\) \{[\s\S]*?\n  \}\n/);
  assert.ok(sh, '확인 창(lvSheet) 없음');
  assert.ok(/b\.freeCourts\.map\(/.test(sh[0]) && /data-act="lv-start"/.test(sh[0]), '코트 고르기 창에 빈 코트마다 버튼이 있어야 함');
  assert.ok(/data-act="lv-win"/.test(sh[0]) && /data-act="lv-cancel"/.test(sh[0]) && /data-act="lv-close"/.test(sh[0]), '확인 창에 실행·취소 버튼이 있어야 함');
  assert.ok(/case 'lv-ask-start'/.test(appSrc) && /case 'lv-ask-win'/.test(appSrc) && /case 'lv-ask-cancel'/.test(appSrc) && /case 'lv-close'/.test(appSrc), '창 열고 닫는 동작 없음');
});
test('경기 진행 확인 창: 화면 가운데, 확인 버튼이 왼쪽·취소가 오른쪽 (사용자 요청 2026-11-24)', () => {
  const sh = appSrc.match(/function lvSheet\(w, b, P\) \{[\s\S]*?\n  \}\n/)[0];
  assert.ok(!/data-act="lv-close">취소<\/button><button class="btn (primary|danger)"/.test(sh), '취소가 확인보다 왼쪽에 있음');
  assert.ok(/data-act="lv-win"[^>]*>네, 저장<\/button><button class="btn" data-act="lv-close">취소/.test(sh), '이김 확인: [네, 저장][취소] 순서가 아님');
  assert.ok(/data-act="lv-cancel"[^>]*>네, 빼기<\/button><button class="btn" data-act="lv-close">취소/.test(sh), '빼기 확인: [네, 빼기][취소] 순서가 아님');
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  assert.ok(/\.pc-sheet\.lv-sheet \{[^}]*top: 50%[^}]*bottom: auto/.test(css), '확인 창이 화면 가운데가 아님');
});
test('갤럭시 팝업 안내: 숨은 카테고리 켜기 → 일반 글자 → 팝업으로 표시 (실제 갤럭시에서 확인한 순서, 2026-11-23)', () => {
  const g = appSrc.match(/function pushGuide\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(g, 'pushGuide 없음');
  for (const w of ['앱별 알림 카테고리 관리', '알림 카테고리', '일반', '팝업으로 표시'])
    assert.ok(g[0].includes(w), '안드로이드 안내에 "' + w + '" 없음');
  assert.ok(/스위치 말고/.test(g[0]), '"일반" 스위치를 누르는 실수를 막는 문구 없음');
});
test('CI: 뚱뚱배 순수 함수 테스트(tourney.test.js)도 통과해야 배포 (2026-11-24)', () => {
  const wf = fs.readFileSync(path.join(__dirname, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.ok(/run: node tourney\.test\.js/.test(wf), 'CI에서 tourney.test.js를 안 돌림');
});
test('클럽 홈 틀: 하단 탭 홈·다승왕·기록, 다승왕전 안쪽 탭은 예전처럼 이번 주·순위·예측·내 기록·관리 (2026-11-24, 2026-11-25 사용자 요청으로 내 기록·관리 되돌림)', () => {
  const nav = appSrc.match(/function bottomNav\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(nav, '하단 탭(bottomNav) 없음');
  assert.ok(/\[\['home', '홈', [^\]]*\], \['week', '다승왕', [^\]]*\], \['records', '기록', [^\]]*\]\]/.test(nav[0]), '하단 탭은 홈·다승왕·기록 세 개');
  assert.ok(!/\['me', '내 기록'/.test(nav[0]) && !/\['admin', '관리'/.test(nav[0]), '내 기록·관리는 하단 탭이 아니라 다승왕 안쪽 탭');
  const hd = appSrc.match(/function header\(\) \{[\s\S]*?\n  \}\n/)[0];
  assert.ok(/\[\['week', '이번 주'\], \['rank', '순위'\], \['plan', '예측'\], \['me', '내 기록'\], \['admin', '관리'\]\]/.test(hd), '다승왕전 안쪽 탭은 이번 주·순위·예측·내 기록·관리');
  assert.ok(/t\[0\] === 'admin' && !ui\.admin && !ui\.op \? ' <span class="lock">PIN<\/span>'/.test(hd), '관리 탭 PIN 표시');
  assert.ok(/var DSW_TABS = \['week', 'rank', 'plan', 'me', 'admin'\];/.test(appSrc), '내 기록·관리도 다승왕 화면(헤더) 안');
  assert.ok(/data-act="tab" data-v="home"[^>]*>‹ 홈/.test(hd), '다승왕전 화면에서 홈으로 돌아가는 버튼 없음');
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  assert.ok(/\.tabs \{[^}]*grid-template-columns: repeat\(5, 1fr\)/.test(css), '안쪽 탭 5칸');
  const home = appSrc.match(/function viewHome\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(home && /L\.homeSummary\(/.test(home[0]) && /data-act="tab" data-v="week"/.test(home[0]), '홈에 다승왕전 카드(→ 이번 주) 없음');
  assert.ok(/function viewRecords\(\) \{/.test(appSrc), '기록 탭 화면 없음');
  assert.ok(/ui\.tab === 'home' \? viewHome\(\)/.test(appSrc) && /ui\.tab === 'records' \? viewRecords\(\)/.test(appSrc), 'render가 홈·기록을 그리지 않음');
  assert.ok(/tab: LS\.get\(KEY\.tab\) \|\| 'home'/.test(appSrc), '처음 여는 사람은 홈부터');
});
test('render: 데이터를 받기 전에는 그리지 않음 (알림 초기화가 먼저 render를 불러 TypeError 나던 것, #15부터)', () => {
  const r = appSrc.match(/function render\(\) \{\n([^\n]*\n){0,3}/)[0];
  assert.ok(/if \(!work\) return;/.test(r), 'render 맨 앞에 work 확인 없음');
});
test('Edge Function rematch: 조건 종류가 logic.js와 같고, 모델·폴백·키 처리가 맞음', () => {
  const src = fs.readFileSync(path.join(__dirname, 'supabase', 'functions', 'rematch', 'index.ts'), 'utf8');
  const types = JSON.parse(src.match(/const RULE_TYPES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepStrictEqual(types.slice().sort(), Object.keys(require('./logic.js').RULE_ARITY).sort());
  assert.ok(/model: "claude-opus-5-5"/.test(src), '모델');
  assert.ok(/fallbacks: "default"/.test(src) && /server-side-fallback-2026-07-01/.test(src), '거절 폴백');
  assert.ok(!/sk-ant-/.test(src), 'API 키가 코드에 들어 있음');
  assert.ok(/rpc\("ai_take"/.test(src), '관리자 토큰·횟수 확인');
});

console.log('app.js');
const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
test('app.js: 아티팩트 자기 재게시·브라우저 PIN 해시·내장 state를 쓰지 않음', () => {
  assert.ok(!/artifact\.publish|buildDoc/.test(appSrc), 'publish/buildDoc 남아 있음');
  assert.ok(!/pinHash/.test(appSrc), 'pinHash 남아 있음');
  assert.ok(!/getElementById\('state'\)/.test(appSrc), '<script id="state"> 읽기 남아 있음');
});
test('app.js 화면 문구에 주식 용어를 쓰지 않음 (사용자 요청 2026-11-16, 주석은 제외)', () => {
  const code = appSrc.split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const words = ['체결', '매수', '매도', '장 마감', '상한가', '폭락', '수익', '종가', '시세', '작전주', '포트폴리오', '투자'];
  const found = words.filter(w => code.includes(w));
  assert.deepStrictEqual(found, [], '남은 주식 용어: ' + found.join(', '));
});
test('순위표 열: 순위·이름·총합·승·보너스·패 (사용자 요청 2026-11-19, 순위 기준인 총합을 맨 앞에)', () => {
  const m = appSrc.match(/<div class="rrow rhead"[^>]*>((?:<span>[^<]*<\/span>)+)<\/div>/);
  assert.ok(m, '순위표 머리줄 없음');
  const cols = [...m[1].matchAll(/<span>([^<]*)<\/span>/g)].map(x => x[1]);
  assert.deepStrictEqual(cols, ['순위', '이름', '총합', '승', '보너스', '패']);
});
test('다승왕권·동률 추첨: 글자 배지 없이 왕관 아이콘만 (사용자 요청 2026-11-20)', () => {
  assert.ok(!/chip (king|lot)">(다승왕권|동률 추첨)</.test(appSrc), '다승왕권·동률 추첨 글자 배지가 남아 있음');
  assert.ok(/function crown\(/.test(appSrc), 'crown() 아이콘 함수 없음');
  assert.ok(/<svg class="crown"[^>]*role="img"[^>]*aria-label=/.test(appSrc), '왕관 svg에 role=img·aria-label 없음(화면 읽기용 이름)');
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  assert.ok(/\.chip\.king \{/.test(css) && /\.chip\.lot \{/.test(css), '다른 곳(마감·바뀜·승 표시)에서 쓰는 배지 스타일이 지워짐');
  assert.ok(/\.crown \{/.test(css), '.crown 스타일 없음');
});
test('화면 문구: "결과 미입력" 대신 "결과 대기", 순위 계산에 now 전달 (사용자 요청 2026-11-20)', () => {
  assert.ok(!/결과 미입력/.test(appSrc), '"결과 미입력" 문구가 남아 있음');
  const calls = appSrc.match(/L\.standings\([^;]*\)/g) || [];
  assert.ok(calls.length >= 2 && calls.every(c => /now:/.test(c)), 'standings 호출에 now가 빠짐: ' + calls.join(' / '));
});
test('이번 주 탭: 내 경기 | 전체 전환, 기본은 내 경기 (사용자 요청 2026-11-20)', () => {
  assert.ok(/data-act="wview"/.test(appSrc), '전환 버튼(data-act=wview) 없음');
  assert.ok(/wview: 'ddw-wview'/.test(appSrc), '마지막 선택 기억용 키 없음');
  assert.ok(/LS\.get\(KEY\.wview\) \|\| 'mine'/.test(appSrc), '기본값이 내 경기가 아님');
  assert.ok(/L\.livePrediction\(/.test(appSrc), '내 예측 실시간 상태를 logic.livePrediction으로 계산하지 않음');
  assert.ok(/내 픽/.test(appSrc), '전체 보기에서 내가 고른 경기 표시 없음');
});
test('내 예측 카드: 글자 대신 조 색 테두리로 구분 (사용자 요청 2026-11-20)', () => {
  assert.ok(/function pickCells\(w, s, P, small, grp\)/.test(appSrc), 'pickCells에 grp(조 색 테두리) 옵션 없음');
  assert.ok(!/class="pk-body"/.test(appSrc), '조·경기 글자 라벨이 남아 있음');
  // 내 예측 카드 3곳(이번 주 탭, 돼블스플랜 마감 전·후)만, 전원 공개 목록은 그대로
  assert.strictEqual((appSrc.match(/P, (true|false), true\)/g) || []).length, 3, '조 색 테두리 pickCells 호출이 3곳이 아님');
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  assert.ok(/\.pick4\.grp \.pk \{[^}]*border:[^}]*var\(--gc[,)]/.test(css), '조 색(--gc) 테두리 스타일 없음');
});
test('내 예측 카드: 점 대신 조 캐릭터 얼굴 아이콘 (사용자 요청 2026-11-20)', () => {
  const img = fs.readFileSync(path.join(__dirname, 'images.css'), 'utf8');
  ['cv', 'lb', 'bf', 'lm', 'pk', 'ck'].forEach(k => assert.ok(new RegExp('--face-' + k + ': url\\(data:image/webp;base64,').test(img), '--face-' + k + ' 없음'));
  assert.ok(/GROUP_FACE = \{ A: '\w\w', B: '\w\w', C: '\w\w' \}/.test(appSrc), '조 → 얼굴 아이콘 표(GROUP_FACE) 없음');
  assert.ok(/<i class="face face-' \+ [^>]*role="img" aria-label=/.test(appSrc), '얼굴 아이콘에 role=img·aria-label(조 이름) 없음');
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  assert.ok(/\.face \{[^}]*width: 24px; height: 24px/.test(css), '.face 24px 스타일 없음');
});
test('경기 진행 화면: 돼장 경기 진행|결과 표, 코트 넣기·결과·빼기는 바로 저장, 자리 비움은 RPC (2026-11-20)', () => {
  assert.ok(/data-act="awv" data-v="live"/.test(appSrc) && /data-act="awv" data-v="table"/.test(appSrc), '경기 진행 | 결과 표 전환 없음');
  for (const a of ['lv-start', 'lv-win', 'lv-cancel', 'lv-set', 'my-avail']) assert.ok(new RegExp("case '" + a + "'").test(appSrc), a + ' 동작 없음');
  assert.ok(/function liveEdit\(fn, action[\s\S]{0,900}remote\.liveAction\(/.test(appSrc), '코트 동작이 바로 저장되지 않음');
  assert.ok(/L\.startMatch\(/.test(appSrc) && /L\.finishMatch\(/.test(appSrc) && /L\.cancelMatch\(/.test(appSrc), '코트 동작이 logic 함수를 안 씀');
  assert.ok(/remote\.watchLive\(/.test(appSrc), '돼장 저장·자리 비움 Realtime 구독 없음');
  assert.ok(/function reloadState\(\)[\s\S]{0,200}if \(dirty\(\) \|\| ui\.busy\) return/.test(appSrc), '저장 안 한 변경이 있을 때 덮어쓰지 않는 확인 없음');
});
test('진행 도우미: 같은 PIN 칸에서 진행 PIN도 받고, 코트 동작은 live_action으로 (전체 저장 아님)', () => {
  assert.ok(/remote\.login\(p1\)[\s\S]{0,600}remote\.operatorLogin\(p1\)/.test(appSrc), 'PIN 칸에서 진행 PIN을 안 받음');
  assert.ok(/function liveEdit\(fn, action[\s\S]{0,900}remote\.liveAction\(/.test(appSrc), '코트 동작이 live_action RPC를 안 씀');
  assert.ok(!/function liveEdit\(fn, action[^]*?\n  \}/.exec(appSrc) || !/\bsave\(\)/.test(/function liveEdit\(fn, action[^]*?\n  \}/.exec(appSrc)[0]), '코트 동작이 아직 전체 저장(save)을 부름');
  assert.ok(/ui\.op/.test(appSrc), '진행 도우미 상태(ui.op) 없음');
  assert.ok(/id="op-pin"/.test(appSrc), '설정에 진행 PIN 칸 없음');
});
test('이름: 내 예측 카드만 이름만, 나머지는 성까지·가운데 / 조는 얼굴 아이콘 / "N경기" 없음 / 모래시계 없음 / 내 예측에 진행 코트 (사용자 요청 2026-11-22)', () => {
  assert.ok(/L\.shortNames\(work\.players\)/.test(appSrc), '짧은 이름 표 없음');
  assert.ok(/function teamText\(m, side, P\) \{[^\n]*P\[p\]\.name/.test(appSrc) && !/function teamText\(m, side, P\) \{[^\n]*sname\(/.test(appSrc), '예측 화면(내 예측 말고)은 성까지 써야 함');
  assert.ok(/function teamNames\(m, side, P\) \{[^\n]*pname\(/.test(appSrc), '경기 진행은 성까지 써야 함');
  assert.ok(/var nm = p \? p\.name : '빈 자리';/.test(appSrc), '경기 카드는 성까지 써야 함');
  const pick = appSrc.slice(appSrc.indexOf('function pickCells('), appSrc.indexOf('function pickCells(') + 1800);
  assert.ok(/grp \? shortTeam\(/.test(pick), '내 예측 카드(grp)는 이름만이어야 함');
  assert.ok(!/pk-court/.test(pick), '내 예측 칸의 코트 배지는 빼기로 함(맨 위 코트에 표시)');
  assert.ok(/face \+ '<span>' \+ esc\([^;]*\) \+ '<\/span>' \+ icon/.test(pick), '✓·✕가 이름 오른쪽에 있어야 함');
  const strip = appSrc.slice(appSrc.indexOf('function courtsStrip('), appSrc.indexOf('function myLiveCard('));
  assert.ok(/pickOf/.test(strip) && /내 픽/.test(strip), '맨 위 코트에 내 예측 경기 표시 없음');
  const wk = appSrc.slice(appSrc.indexOf('if (mine) {\n      var my = [];'), appSrc.indexOf('    out += legend();'));
  assert.ok(/my-matches[\s\S]*myPredCard\(/.test(wk), '내 경기 보기에서 내 경기가 내 예측보다 먼저여야 함');
  assert.ok(!/gdot/.test(pick) && /gface\(/.test(pick), '예측 칸이 아직 점(gdot)을 씀');
  assert.ok(/pending: ''/.test(appSrc) && !/⏳/.test(appSrc), '모래시계가 남아 있음');
  const live = appSrc.slice(appSrc.indexOf('function viewLive('), appSrc.indexOf('function myLiveCard('));
  assert.ok(!/matchLabel\(/.test(live) && /gface\(m\.pool\)/.test(live), '경기 진행 화면 조 표시가 얼굴 아이콘이 아님');
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  assert.ok(/\.gdot\.gA::before \{[^}]*--face-lb/.test(css), '조 점(gdot)이 얼굴 아이콘으로 안 바뀜');
  assert.ok(/\.team \{[^}]*justify-content: center/.test(css), '경기 카드 이름이 가운데가 아님');
});
test('회원 내 차례 문구는 빼고 늦어요·레슨·왔어요 버튼만 (사용자 요청 2026-11-22)', () => {
  const card = appSrc.slice(appSrc.indexOf('function myLiveCard('), appSrc.indexOf('// ---- 서버에서 읽기 ----'));
  assert.ok(!/곧 내 차례|대기 ' \+ st\.rank|에서 경기 중|오늘 남은 내 경기/.test(card), '내 차례 문구가 남아 있음');
  assert.ok(/data-st="late"/.test(card) && /data-st="away">레슨</.test(card) && /data-st="here"/.test(card), '늦어요·레슨·왔어요 버튼이 없음');
  // 레슨은 30분 자동 복귀 없이 '왔어요'를 누를 때까지 (사용자 요청 2026-11-22)
  assert.ok(!/data-min/.test(appSrc) && !/레슨 30분/.test(appSrc), '레슨 30분(자동 복귀)이 남아 있음');
  const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8');
  assert.ok(/if p_status = 'away' and p_minutes is not null and \(p_minutes < 10 or p_minutes > 90\)/.test(sql), '서버가 시간 없는 레슨(away)을 거절함');
});
test('코트: 고정 5·6번(설정) + 번호 없는 추가 코트, 실제 번호로 표시 (사용자 결정 2026-11-23)', () => {
  const calls = appSrc.match(/L\.liveBoard\(w, liveRows\(\), Date\.now\(\)[^;]*/g) || [];
  assert.ok(calls.length >= 2 && calls.every(c => /slots: L\.courtSlots\(work\.settings, w\)/.test(c)), 'liveBoard에 설정 코트(slots)를 안 넘김: ' + calls.join(' / '));
  assert.ok(/L\.courtLabel\(/.test(appSrc) && !/'코트 ' \+ \(k \+ 1\)/.test(appSrc), '코트 이름을 1·2·3 순번으로 씀');
  assert.ok(/'extra_open'/.test(appSrc) && /'extra_close'/.test(appSrc) && /L\.setExtraCourt\(/.test(appSrc), '추가 코트 열기·닫기 없음');
  assert.ok(!/m\.court \?/.test(appSrc), '추가 코트(0)를 m.court 참/거짓으로 판단함');
  assert.ok(/id="court-form"/.test(appSrc) && /work\.settings\.courts = /.test(appSrc), '설정에 고정 코트 번호 칸 없음');
  const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8');
  const act = sql.match(/function public\.live_action\([\s\S]*?end \$\$;/)[0];
  assert.ok(/'extra_open', 'extra_close'/.test(act) && /settings'->'courts'/.test(act) && /p_court = 0 and/.test(act), 'live_action이 설정 코트·추가 코트를 모름');
  // jsonb의 -> 와 || 는 우선순위가 같아서 괄호가 없으면 (x->'a' || x)->'b'가 됨 → 선수 겹침 검사가 늘 비어 있었음(오답 노트 22)
  assert.ok(!/->'a' \|\| [a-z.]+->'b'/.test(sql), "jsonb ->'a' || ->'b'에 괄호 없음");
});
test('내 경기 보기 순서: 지금 코트 → 내 경기 → 늦어요·레슨 → 내 예측 (사용자 요청 2026-11-23)', () => {
  const wk = appSrc.slice(appSrc.indexOf('if (mine) {\n      var my = [];'), appSrc.indexOf('    out += legend();'));
  assert.ok(/my-matches[\s\S]*myLiveCard\([\s\S]*myPredCard\(/.test(wk), '내 경기 보기에서 내 경기 → 늦어요·레슨 → 내 예측 순서가 아님');
});
test('코트에 진행 시간·남은 시간 짐작 (돼장·회원 둘 다), 1분마다 다시 그림 (사용자 요청 2026-11-23)', () => {
  assert.ok(/L\.typicalMinutes\(work\.weeks\)/.test(appSrc), '보통 경기 시간 계산 없음');
  assert.ok((appSrc.match(/etaText\(/g) || []).length >= 3, '돼장 코트·회원 지금 코트에 남은 시간 표시 없음');
  assert.ok(/분 남음/.test(appSrc) && /곧 끝나요/.test(appSrc), '남은 시간 문구 없음');
  assert.ok(/live\.minute/.test(appSrc), '1분마다 다시 그리는 장치 없음');
});
test('경기 진행: 바로 가능·못 함·완료를 조 탭(전체·조별 얼굴 + 개수)으로 나눔 (사용자 요청 2026-11-23)', () => {
  const live = appSrc.slice(appSrc.indexOf('function viewLive('), appSrc.indexOf('function courtsStrip('));
  assert.ok(/data-act="lv-grp"/.test(live), '조 탭 없음');
  assert.ok(/ui\.lvGroup/.test(live) && /var inGrp = /.test(live), '조 탭으로 목록을 거르지 않음');
  assert.ok(/b\.ready\.filter\(inGrp\)/.test(live) && /b\.blocked\.filter\(inGrp\)/.test(live) && /b\.done\.filter\(inGrp\)/.test(live), '바로 가능·못 함·완료 셋 다 걸러야 함');
});
test('app.js: 기존 충돌 UI·저장 실패 배너·임시저장 유지', () => {
  for (const s of ['draftConflict', 'ui.saveError', 'KEY.draft', 'draft-load', 'draft-drop']) assert.ok(appSrc.includes(s), s + ' 없음');
});

console.log('build');
test('build.js: dist/index.html 완전한 문서 + PWA 파일', () => {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'pipe' });
  const dist = p => path.join(__dirname, 'dist', p);
  const html = fs.readFileSync(dist('index.html'), 'utf8');
  assert.ok(/^<!doctype html>/i.test(html), 'doctype');
  assert.ok(/<meta charset="utf-8">/i.test(html), 'charset');
  assert.ok(/name="viewport"/.test(html), 'viewport');
  assert.ok(/name="theme-color"/.test(html), 'theme-color');
  assert.ok(/rel="manifest" href="manifest.webmanifest"/.test(html), 'manifest link');
  assert.ok(/rel="apple-touch-icon"/.test(html), 'apple-touch-icon');
  assert.ok(/apple-mobile-web-app-capable|mobile-web-app-capable/.test(html), 'standalone meta');
  assert.ok(!/id="state"/.test(html), '내장 state가 남아 있음');
  assert.ok(!/"pin":\{/.test(html), 'PIN 해시가 들어 있음');
  assert.ok(/@supabase\/supabase-js@\d+\.\d+\.\d+\//.test(html), 'supabase-js 버전 고정');
  assert.ok(/<script src="config.js">/.test(html), 'config.js 분리');
  assert.ok(/불러오는 중/.test(html), '로딩 표시');
  assert.ok(/serviceWorker/.test(html), 'service worker 등록');
  const man = JSON.parse(fs.readFileSync(dist('manifest.webmanifest'), 'utf8'));
  assert.strictEqual(man.name, '라켓뚱보단 다승왕전');
  assert.strictEqual(man.short_name, '다승왕');
  assert.strictEqual(man.display, 'standalone');
  assert.ok(man.start_url && man.theme_color && man.background_color);
  for (const s of [192, 512]) {
    const ic = man.icons.find(i => i.sizes === s + 'x' + s);
    assert.ok(ic, s + ' 아이콘 항목');
    const png = fs.readFileSync(dist(ic.src));
    assert.strictEqual(png.toString('hex', 1, 4), '504e47', s + ' PNG 아님');
    assert.strictEqual(png.readUInt32BE(16), s, s + ' 폭');
    assert.strictEqual(png.readUInt32BE(20), s, s + ' 높이');
  }
  assert.ok(fs.existsSync(dist('config.js')), 'dist/config.js');
  const sw = fs.readFileSync(dist('sw.js'), 'utf8');
  assert.ok(/supabase/.test(sw), 'sw: supabase 요청 예외 처리');
});
test('갤럭시 알림 사진 안내 guide.html: 파트 1·2, 사진 파일이 dist에 다 있고, 개인정보 없음 (2026-11-25)', () => {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'pipe' });
  const dist = p => path.join(__dirname, 'dist', p);
  assert.ok(fs.existsSync(dist('guide.html')), 'dist/guide.html 없음');
  const g = fs.readFileSync(dist('guide.html'), 'utf8');
  assert.ok(/^<!doctype html>/i.test(g) && /<meta charset="utf-8">/i.test(g) && /name="viewport"/.test(g), '완전한 문서가 아님');
  assert.ok(/id="part1"[\s\S]*?<h2>파트 1[^<]*<\/h2>/.test(g) && /id="part2"[\s\S]*?<h2>파트 2[^<]*<\/h2>/.test(g), '파트 1·파트 2 제목 없음');
  for (const w of ['앱별 알림 카테고리 관리', '고급 설정', '길게', '알림 카테고리', '일반', '팝업으로 표시']) assert.ok(g.includes(w), '단계 문구 없음: ' + w);
  const imgs = [...g.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(imgs.length >= 8, '사진이 8장보다 적음: ' + imgs.length);
  imgs.forEach(s => assert.ok(fs.existsSync(dist(s)), 'dist에 사진 없음: ' + s));
  assert.ok([...g.matchAll(/<img[^>]*>/g)].every(m => /alt="[^"]+"/.test(m[0])), 'alt 없는 사진');
  assert.ok(!/김형준|Kim's|kimhyeo/i.test(g), '개인정보 문자열');
  assert.ok(/href="\.\/"/.test(g), '앱으로 돌아가기 링크 없음');
});
test('앱 알림 안내(안드로이드)에서 사진 안내 guide.html로 가는 링크 (2026-11-25)', () => {
  const gd = appSrc.match(/function pushGuide\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(gd && /href="guide\.html"/.test(gd[0]), 'pushGuide에 guide.html 링크 없음');
});
test('알림 카드 "카톡처럼 화면 위에 뜨게 하려면?" → 안드로이드는 사진 안내 guide.html을 바로 엶, 아이폰만 앱 안 글 안내 (2026-11-25)', () => {
  const c = appSrc.match(/function pushCard\(short\) \{[\s\S]*?\n  \}\n/);
  assert.ok(c, 'pushCard 없음');
  assert.ok(/<a [^>]*href="guide\.html"[^>]*>카톡처럼 화면 위에 뜨게 하려면\?<\/a>/.test(c[0]), '안드로이드 링크가 guide.html로 바로 가지 않음');
  assert.ok(/push\.ios \? '<button[^']*data-act="push-help"/.test(c[0]), '아이폰은 앱 안 안내(push-help)로');
});
test('앱을 열 때: 경기날이면 바로 이번 주(그날), 왼쪽 위 ‹ 홈으로 클럽 홈 (2026-11-25)', () => {
  const st = appSrc.match(/function start\(state\) \{[\s\S]*?\n  \}\n/);
  assert.ok(st, 'start 없음');
  assert.ok(/ui\.tab = L\.startTab\(LS\.get\(KEY\.tab\), todayKST\(\), seasonDates\(\)\)/.test(st[0]), 'start에서 첫 화면을 startTab으로 정하지 않음');
  assert.ok(/if \(ui\.tab === 'week' && seasonDates\(\)\.indexOf\(todayKST\(\)\) >= 0\) ui\.week = todayKST\(\)/.test(st[0]), '경기날 이번 주가 오늘 날짜가 아님');
  assert.ok(/class="back-home" data-act="tab" data-v="home"/.test(appSrc), '다승왕 화면 왼쪽 위 ‹ 홈 없음');
});
test('하단 탭(.bnav)에 가려지는 고정 버튼 없음: 예측 하기(.plan-cta)·저장 막대는 탭 위에 (2026-11-25 회귀)', () => {
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  const rule = sel => (css.match(new RegExp('\\n' + sel.replace('.', '\\.') + ' \\{([^}]*)\\}')) || [])[1] || '';
  const nav = rule('.bnav');
  assert.ok(/bottom: 0/.test(nav) && /height: 60px/.test(rule('.bnav button')), '하단 탭 높이 60px 가정이 바뀜');
  for (const sel of ['.plan-cta', '.savebar']) {
    const r = rule(sel);
    assert.ok(/position: fixed/.test(r), sel + ' 규칙 없음');
    assert.ok(/bottom: calc\(60px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(r), sel + '가 하단 탭 뒤(bottom: 0)에 깔림');
  }
});
test('클럽 홈: 참가 신청은 예시 + 밴드 안내, 진행 중 공지·행사(청백전·뚠뚠배)·일정은 club.js에서 (2026-11-25)', () => {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'pipe' });
  const html = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
  const ic = html.indexOf('<script id="app-club">'), ia = html.indexOf('<script id="app-js">');
  assert.ok(ic > 0 && ic < ia, 'club.js가 app.js보다 먼저 들어가야 함');
  const home = appSrc.match(/function viewHome\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(home, 'viewHome 없음');
  const h = home[0];
  assert.ok(/Club\.currentSignup\(/.test(h) && /Club\.activeNotices\(/.test(h) && /Club\.upcoming\(/.test(h) && /Club\.EVENTS/.test(h), 'club.js 데이터를 안 씀');
  assert.ok(/예시/.test(h) && /밴드 참가신청서/.test(h), '참가 신청이 예시이고 밴드에서 한다는 안내 없음');
  assert.ok(!/data-act="(join|apply|signup)/.test(h), '홈에 앱 신청 버튼이 있으면 안 됨(아직 밴드에서)');
  const bl = appSrc.match(/function bandLink\([^)]*\) \{[^\n]*\}/);
  assert.ok(bl && /target="_blank" rel="noopener"/.test(bl[0]) && /bandLink\(/.test(h), '밴드 링크는 새 창(bandLink)으로');
  assert.ok(/data-act="tab" data-v="week"/.test(h), '다승왕전 카드(→ 이번 주) 그대로');
});
test('service worker: index.html network-first, supabase는 캐시 안 함', () => {
  const sw = fs.readFileSync(path.join(__dirname, 'dist', 'sw.js'), 'utf8');
  const cached = [];
  const ctx = {
    self: { location: { origin: 'https://me.github.io' }, addEventListener: (t, f) => { ctx['on' + t] = f; }, skipWaiting() { }, clients: { claim() { } } },
    caches: { open: () => Promise.resolve({ put: (r) => { cached.push(String(r.url || r)); }, addAll: () => Promise.resolve() }), match: () => Promise.resolve(undefined), keys: () => Promise.resolve([]) },
    fetch: (r) => Promise.resolve({ ok: true, clone() { return this; } }),
  };
  new Function('self', 'caches', 'fetch', sw)(ctx.self, ctx.caches, ctx.fetch);
  let responded = null;
  const ev = url => ({ request: { url, method: 'GET', mode: url.endsWith('/') ? 'navigate' : 'cors' }, respondWith: p => { responded = p; } });
  ctx.onfetch(ev('https://abc.supabase.co/rest/v1/app_state'));
  assert.strictEqual(responded, null, 'supabase 요청을 가로챔');
  ctx.onfetch(ev('https://me.github.io/rest/v1/app_state'));
  assert.strictEqual(responded, null, '같은 출처의 /rest/v1/ 요청을 가로챔');
  ctx.onfetch(ev('https://me.github.io/badminton/'));
  assert.ok(responded, 'index.html을 처리 안 함');
  return responded.then(() => assert.ok(cached.some(u => u.includes('github.io')), 'network 응답을 캐시에 안 넣음'));
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
