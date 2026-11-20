// 로컬 화면 확인용 가짜 Supabase (개발 전용): node tools/mock_supabase.js → http://localhost:8787
// dist/를 그대로 서빙하고 /rest/v1 의 app_state 읽기와 RPC(save_state 등)를 메모리에서 흉내 냄. 테스트 PIN 1234.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8787;
// MOCK_DIST=폴더 로 다른 빌드(예: main 브랜치 dist)를 같은 가짜 데이터로 띄워 비교할 수 있음
const dist = process.env.MOCK_DIST ? path.resolve(process.env.MOCK_DIST) : path.join(__dirname, '..', 'dist');
// 돼블스플랜 마감 판단용 서버 시계. MOCK_NOW=2026-11-18T17:31+09:00 처럼 주면 그 시각부터 흐름 (로컬 시험 전용)
const clockOffset = process.env.MOCK_NOW ? Date.parse(process.env.MOCK_NOW) - Date.now() : 0;
if (Number.isNaN(clockOffset)) throw new Error('MOCK_NOW 형식이 잘못됐어요');
const now = () => Date.now() + clockOffset;
// MOCK_STATE=파일경로 로 다른 데이터를 쓸 수 있음 (예: 실제 DB를 읽어 둔 사본)
// MOCK_DEMO=1 이면 seed.js 명단으로 만든 돼블스플랜 가짜 주차·예측 (tools/daebles_demo.js)
const demo = process.env.MOCK_DEMO ? require('./daebles_demo.js').build(require('../seed.js'), now()) : null;
const src = demo ? demo.state : process.env.MOCK_STATE ? JSON.parse(fs.readFileSync(process.env.MOCK_STATE, 'utf8'))
  : fs.existsSync(path.join(__dirname, '..', 'live_state.json')) ? require('../live_state.json') : require('../seed.js');
const state = JSON.parse(JSON.stringify(src));
delete state.rev; delete state.savedAt; if (state.settings) delete state.settings.pin;
const db = { state, rev: src.rev || 1, saved_at: src.savedAt || new Date().toISOString(), pin: '1234', sessions: new Set(), opPin: process.env.MOCK_OP_PIN || null, ops: new Set() };  // ops: 진행 도우미 토큰

// ---- 돼블스플랜: schema.sql의 테이블·함수를 메모리에서 흉내 ----
const P = { predictions: [], prediction_counts: [], prediction_events: [], prediction_close: [], availability: [], eventId: 0 };
const deadline = d => Date.parse(d + 'T17:30:00+09:00');
const testWeeks = {}; // prediction_test_weeks (verify_db.js 전용, 2000·2099년만)
const isTestDate = d => /^(2000|2099)-/.test(String(d));
// 그 주 경기 → 조 (schema.sql prediction_match_pools). 가짜 주는 id 배열이면 조 '' , {id: 조} 객체면 그대로
const weekPools = d => {
  const w = db.state.weeks.find(x => x.date === d && x.published !== false);
  if (w) return Object.fromEntries(w.matches.map(m => [m.id, m.pool || '']));
  const t = testWeeks[d];
  return !t ? null : Array.isArray(t) ? Object.fromEntries(t.map(id => [id, ''])) : t;
};
const weekIds = d => { const p = weekPools(d); return p ? Object.keys(p) : null; };
const QUOTA = require('../logic.js').PREDICT.quota;
function predCheck(d, pid, mode, picks) {
  if (mode !== 'high' && mode !== 'safe') return 'bad_mode';
  if (!db.state.players.some(p => p.id === pid && p.active !== false)) return 'bad_player';
  const ids = weekIds(d);
  if (!ids) return 'no_week';
  if (!Array.isArray(picks) || picks.length !== 4) return 'bad_count';
  const seen = new Set();
  for (const e of picks) {
    if (!e || typeof e.match !== 'string') return 'bad_match';
    if (e.side !== 'a' && e.side !== 'b') return 'bad_side';
    if (seen.has(e.match)) return 'dup_match';
    if (!ids.includes(e.match)) return 'bad_match';
    seen.add(e.match);
  }
  // 조별 고정 (schema.sql pred_check와 같게): 채울 수 있는 주만
  const pools = weekPools(d), groupsOf = g => Object.values(pools).filter(x => x === g).length;
  if (Object.keys(QUOTA).every(g => groupsOf(g) >= QUOTA[g])) {
    for (const g of Object.keys(QUOTA)) if (picks.filter(e => pools[e.match] === g).length !== QUOTA[g]) return 'bad_quota';
  }
  return null;
}
function bump(d, k, mode, by) {
  let c = P.prediction_counts.find(x => x.week_date === d && x.match_id === k.match && x.side === k.side && x.mode === mode);
  if (!c) P.prediction_counts.push(c = { week_date: d, match_id: k.match, side: k.side, mode, n: 0 });
  c.n += by;
}
function predApply(d, pid, mode, picks, log, at) {
  const t = new Date(at || now()).toISOString();
  const clean = picks.map(e => ({ match: e.match, side: e.side }));
  const prev = P.predictions.find(x => x.week_date === d && x.player_id === pid);
  const has = (list, k) => list.some(x => x.match === k.match && x.side === k.side);
  const ev = (k, m, delta) => P.prediction_events.push({ id: ++P.eventId, week_date: d, match_id: k.match, side: k.side, mode: m, delta, at: t });
  if (prev) {
    prev.picks.forEach(k => bump(d, k, prev.mode, -1));
    if (log) prev.picks.forEach(k => { if (prev.mode !== mode || !has(clean, k)) ev(k, prev.mode, -1); });
  }
  clean.forEach(k => bump(d, k, mode, 1));
  if (log) clean.forEach(k => { if (!prev || prev.mode !== mode || !has(prev.picks, k)) ev(k, mode, 1); });
  if (prev) Object.assign(prev, { mode, picks: clean, updated_at: t });
  else P.predictions.push({ week_date: d, player_id: pid, mode, picks: clean, updated_at: t });
  return t;
}
function predRemove(d, pid) {
  const i = P.predictions.findIndex(x => x.week_date === d && x.player_id === pid);
  if (i < 0) return false;
  P.predictions[i].picks.forEach(k => bump(d, k, P.predictions[i].mode, -1));
  P.predictions.splice(i, 1);
  return true;
}
if (demo) demo.predictions.forEach(p => predApply(p.week_date, p.player_id, p.mode, p.picks, true, Date.parse(p.updated_at)));
// GET /rest/v1/<표>?week_date=eq.X&order=id.desc&limit=N (쓰는 모양만)
function queryTable(name, u) {
  let rows = P[name].slice();
  if (name === 'predictions') rows = rows.filter(r => now() >= deadline(r.week_date)); // RLS: 마감 후에만
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const m = /^(eq|gte|lt)\.(.*)$/.exec(v);
    if (m) rows = rows.filter(r => m[1] === 'eq' ? String(r[k]) === m[2] : m[1] === 'gte' ? String(r[k]) >= m[2] : String(r[k]) < m[2]);
  }
  const o = u.searchParams.get('order');
  if (o) { const [k, dir] = o.split('.'); rows.sort((x, y) => (x[k] < y[k] ? -1 : x[k] > y[k] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
  const lim = +u.searchParams.get('limit');
  return lim ? rows.slice(0, lim) : rows;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function send(res, status, body, type) { res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
function fail(res, msg) { send(res, 400, { code: 'P0001', message: msg, details: null, hint: null }); }

// ---- 경기 진행 자리 비움: schema.sql set_availability / admin_set_availability 흉내 ----
// MOCK_AVAIL='[{"player_id":"p001","status":"away","min":30}]' 로 처음부터 넣어 둘 수 있음 (화면 확인용, 오늘 경기 주)
const kstDay = t => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
function availApply(d, pid, status, minutes, byAdmin) {
  const i = P.availability.findIndex(r => r.week_date === d && r.player_id === pid);
  if (status === 'here') { if (i >= 0) P.availability.splice(i, 1); return null; }
  const until = minutes > 0 ? new Date(now() + minutes * 60000).toISOString() : null;
  const row = { week_date: d, player_id: pid, status, until, by_admin: byAdmin, updated_at: new Date(now()).toISOString() };
  if (i >= 0) P.availability[i] = row; else P.availability.push(row);
  return until;
}
const attending = (d, pid) => { const w = db.state.weeks.find(x => x.date === d); return !!(w && w.attendees && pid in w.attendees); };
if (process.env.MOCK_AVAIL) JSON.parse(process.env.MOCK_AVAIL).forEach(r => availApply(kstDay(now()), r.player_id, r.status, r.min || 0, !!r.admin));
const RPC = {
  admin_login: (a, res) => { if (a.pin !== db.pin) return send(res, 200, 'null'); const t = crypto.randomUUID(); db.sessions.add(t); send(res, 200, JSON.stringify(t)); },
  admin_check: (a, res) => send(res, 200, String(db.sessions.has(a.token))),
  admin_logout: (a, res) => { db.sessions.delete(a.token); db.ops.delete(a.token); send(res, 200, 'null'); },
  // ---- 진행 PIN (schema.sql operator_login / live_check / set_operator_pin / live_action 흉내, 만료 시각은 생략) ----
  operator_login: (a, res) => { if (!db.opPin) return fail(res, 'no_op_pin'); if (a.pin !== db.opPin) return send(res, 200, 'null'); const t = crypto.randomUUID(); db.ops.add(t); send(res, 200, JSON.stringify(t)); },
  live_check: (a, res) => send(res, 200, JSON.stringify(db.sessions.has(a.token) ? 'admin' : db.ops.has(a.token) ? 'operator' : null)),
  set_operator_pin: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (a.new_pin != null && !/^\d{4}$/.test(a.new_pin)) return fail(res, 'bad_new_pin');
    if (a.new_pin === db.pin) return fail(res, 'same_as_admin');
    db.opPin = a.new_pin; db.ops = new Set(); send(res, 200, 'null');
  },
  live_action: (a, res) => {
    if (!db.sessions.has(a.token) && !db.ops.has(a.token)) return fail(res, 'unauthorized');
    if (!['start', 'finish', 'cancel'].includes(a.p_action)) return fail(res, 'bad_action');
    const w = db.state.weeks.find(x => x.date === a.p_week); if (!w) return fail(res, 'no_week');
    const m = w.matches.find(x => x.id === a.p_match); if (!m) return fail(res, 'no_match');
    const LG = require('../logic.js'), iso = new Date(now()).toISOString();
    if (a.p_action === 'start') {
      if (m.win) return fail(res, 'already_done');
      if (m.court) return fail(res, 'court_busy');
      if (!(a.p_court >= 1 && a.p_court <= 3)) return fail(res, 'bad_court');
      if (w.matches.some(x => !x.win && x.court === a.p_court)) return fail(res, 'court_busy');
      if (!LG.startMatch(w, m.id, a.p_court, iso)) return fail(res, 'player_busy');
    } else if (a.p_action === 'finish') {
      if (m.win) return fail(res, 'already_done');
      if (!m.court) return fail(res, 'not_on_court');
      if (a.p_side !== 'a' && a.p_side !== 'b') return fail(res, 'bad_side');
      LG.finishMatch(w, m.id, a.p_side, iso);
    } else if (!LG.cancelMatch(w, m.id)) return fail(res, 'not_on_court');
    db.rev++; db.saved_at = new Date().toISOString(); send(res, 200, String(db.rev));
  },
  set_availability: (a, res) => {
    const d = a.p_week, st = a.p_status, mn = a.p_minutes;
    if (d !== kstDay(now())) return fail(res, 'not_today');
    if (!['late', 'away', 'here'].includes(st)) return fail(res, 'bad_status');
    if (!attending(d, a.p_player)) return fail(res, 'not_attending');
    const cur = P.availability.find(r => r.week_date === d && r.player_id === a.p_player);
    if (cur && cur.by_admin && cur.status === 'out') return fail(res, 'admin_locked');
    if (st === 'away' && !(mn >= 10 && mn <= 90)) return fail(res, 'bad_minutes');
    if (st === 'late' && mn != null && !(mn >= 0 && mn <= 120)) return fail(res, 'bad_minutes');
    send(res, 200, JSON.stringify(availApply(d, a.p_player, st, mn || 0, false)));
  },
  admin_set_availability: (a, res) => {
    if (!db.sessions.has(a.token) && !db.ops.has(a.token)) return fail(res, 'unauthorized');
    if (!['late', 'away', 'out', 'here'].includes(a.p_status)) return fail(res, 'bad_status');
    send(res, 200, JSON.stringify(availApply(a.p_week, a.p_player, a.p_status, a.p_minutes || 0, true)));
  },
  save_state: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (a.expected_rev !== db.rev) return fail(res, 'stale_rev');
    const s = a.new_state; if (s.settings) delete s.settings.pin; delete s.rev; delete s.savedAt;
    db.state = s; db.rev++; db.saved_at = new Date().toISOString();
    console.log('save_state → rev', db.rev);
    send(res, 200, String(db.rev));
  },
  change_pin: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (a.old_pin !== db.pin) return fail(res, 'bad_pin');
    if (a.new_pin === db.opPin) return fail(res, 'same_as_operator');
    db.pin = a.new_pin; db.sessions = new Set([a.token]); send(res, 200, 'null');
  },
  submit_prediction: (a, res) => {
    if (now() >= deadline(a.week_date)) return fail(res, 'closed');
    const bad = predCheck(a.week_date, a.player_id, a.mode, a.picks);
    if (bad) return fail(res, bad);
    send(res, 200, JSON.stringify(predApply(a.week_date, a.player_id, a.mode, a.picks, true)));
  },
  admin_upsert_prediction: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    const bad = predCheck(a.week_date, a.player_id, a.mode, a.picks);
    if (bad) return fail(res, bad);
    send(res, 200, JSON.stringify(predApply(a.week_date, a.player_id, a.mode, a.picks, false)));
  },
  admin_delete_prediction: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    send(res, 200, String(predRemove(a.week_date, a.player_id)));
  },
  admin_list_predictions: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    send(res, 200, P.predictions.filter(x => x.week_date === a.week_date));
  },
  admin_test_week: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (!isTestDate(a.week_date)) return fail(res, 'test_date_only');
    testWeeks[a.week_date] = a.match_ids; send(res, 200, 'null');
  },
  admin_test_purge: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    const out = {};
    for (const t of ['predictions', 'prediction_counts', 'prediction_events', 'prediction_close']) {
      const before = P[t].length; P[t] = P[t].filter(r => !isTestDate(r.week_date)); out[t] = before - P[t].length;
    }
    out.prediction_test_weeks = Object.keys(testWeeks).length; for (const k of Object.keys(testWeeks)) delete testWeeks[k];
    send(res, 200, out);
  },
  close_snapshot: (a, res) => {
    const d = a.week_date;
    if (now() < deadline(d) || P.prediction_close.some(x => x.week_date === d)) return send(res, 200, '0');
    const rows = require('../logic.js').closeFromPredictions(P.predictions.filter(x => x.week_date === d)).map(r => Object.assign({ week_date: d }, r));
    P.prediction_close.push(...rows);
    send(res, 200, String(rows.length));
  },
};

// 가짜 Claude: 요청 글에서 이름과 낱말을 찾아 계획을 만듦 (화면 확인용, 실제 함수는 supabase/functions/rematch)
function mockRematch(b) {
  if (!db.sessions.has(b.token)) return { ok: false, code: 'unauthorized' };
  const text = String(b.request || '');
  if (!text.trim() || text.length > 500) return { ok: false, code: 'bad_request' };
  const names = (b.players || []).filter(p => text.includes(p.name)).sort((x, y) => text.indexOf(x.name) - text.indexOf(y.name));
  const ids = names.map(p => p.id);
  const plan = { rules_add: [], rules_remove: [], pool_moves: [], regenerate: [], edits: [] };
  let explanation;
  if (text.includes('추가출전') && ids.length >= 1) {
    const avoid = /말고|빼/.test(text);
    plan.rules_add.push({ type: avoid ? 'extra_avoid' : 'extra_prefer', players: [ids[0]] });
    explanation = names[0].name + (avoid ? '은(는) 추가출전에서 빼는 조건을 걸었어요.' : '을(를) 추가출전으로 우선 넣는 조건을 걸었어요.');
  } else if (/금지|하지 마|붙이지 마/.test(text) && ids.length >= 2) {
    const type = text.includes('경기') ? 'no_same_game' : 'no_partner';
    plan.rules_add.push({ type, players: ids.slice(0, 2) });
    explanation = names[0].name + '·' + names[1].name + (type === 'no_same_game' ? ' 같은 경기 금지' : ' 같은 팀 금지') + ' 조건을 걸었어요. 어기는 조만 다시 짜요.';
  } else if (text.includes('바꿔') && ids.length >= 2) {
    const m = (b.matches || []).find(x => text.includes(x.label));
    plan.edits.push({ type: 'swap', players: ids.slice(0, 2), matches: m ? [m.id] : [], match: '', side: '', index: 0, player: '', off: false });
    explanation = (m ? m.label + '에서 ' : '') + names[0].name + '·' + names[1].name + ' 자리를 맞바꿨어요.';
  } else explanation = '요청을 이해하지 못했어요. 이름과 바꿀 내용을 같이 적어 주세요. (가짜 서버)';
  return { ok: true, plan, explanation, usage: { input_tokens: 0, output_tokens: 0 } };
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/functions/v1/rematch' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => setTimeout(() => send(res, 200, mockRematch(JSON.parse(body || '{}'))), 800));
  }
  if (u.pathname === '/rest/v1/app_state' && req.method === 'GET') return send(res, 200, { state: db.state, rev: db.rev, saved_at: db.saved_at });
  const table = u.pathname.slice('/rest/v1/'.length);
  if (u.pathname.startsWith('/rest/v1/') && table in P && table !== 'eventId') {
    if (req.method !== 'GET') return send(res, 401, { code: '42501', message: 'permission denied for table ' + table });
    return send(res, 200, queryTable(table, u));
  }
  if (u.pathname.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => { const f = RPC[u.pathname.slice(13)]; f ? f(JSON.parse(body || '{}'), res) : send(res, 404, { message: 'no function' }); });
  }
  if (u.pathname === '/config.js') return send(res, 200, "window.DDW_CONFIG = { url: 'http://localhost:" + PORT + "', anonKey: 'mock', realtime: false };", TYPES['.js']);
  const f = path.join(dist, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^[\\/]+/, ''));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
}).listen(PORT, () => console.log('mock supabase + dist on http://localhost:' + PORT + ' (PIN 1234)' +
  (clockOffset ? ' · 서버 시계 ' + new Date(now()).toISOString() : '') + (demo ? ' · 돼블스플랜 데모 예측 ' + P.predictions.length + '건' : '')));
