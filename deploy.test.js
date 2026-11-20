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
  assert.ok(adm && /admin_check\(/.test(adm[0]), '돼장용 admin_set_availability가 토큰을 확인하지 않음');
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
  assert.ok(/function liveEdit\(fn, msg\)[\s\S]{0,400}save\(\)/.test(appSrc), '코트 동작이 바로 저장되지 않음');
  assert.ok(/L\.startMatch\(/.test(appSrc) && /L\.finishMatch\(/.test(appSrc) && /L\.cancelMatch\(/.test(appSrc), '코트 동작이 logic 함수를 안 씀');
  assert.ok(/remote\.watchLive\(/.test(appSrc), '돼장 저장·자리 비움 Realtime 구독 없음');
  assert.ok(/function reloadState\(\)[\s\S]{0,200}if \(dirty\(\) \|\| ui\.busy\) return/.test(appSrc), '저장 안 한 변경이 있을 때 덮어쓰지 않는 확인 없음');
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
