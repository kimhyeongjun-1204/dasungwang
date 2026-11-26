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
// MOCK_TODAY=1: 가짜 데이터의 마지막 주(11/18)를 오늘 날짜로 옮김 → 아무 날에나 '경기날' 화면(경기 진행·자리 비움·내 차례)을 시험
if (demo && process.env.MOCK_TODAY) {
  const today = new Date(now() + 9 * 3600e3).toISOString().slice(0, 10), from = '2026-11-18';
  demo.state.weeks.forEach(w => { if (w.date === from) w.date = today; });
  demo.state.weeks.sort((a, b) => (a.date < b.date ? -1 : 1));
  demo.predictions.forEach(p => { if (p.week_date === from) p.week_date = today; });
}
const src = demo ? demo.state : process.env.MOCK_STATE ? JSON.parse(fs.readFileSync(process.env.MOCK_STATE, 'utf8'))
  : fs.existsSync(path.join(__dirname, '..', 'live_state.json')) ? require('../live_state.json') : require('../seed.js');
const state = JSON.parse(JSON.stringify(src));
delete state.rev; delete state.savedAt; if (state.settings) delete state.settings.pin;
const db = { state, rev: src.rev || 1, saved_at: src.savedAt || new Date().toISOString(), pin: '1234', sessions: new Set(), opPin: process.env.MOCK_OP_PIN || null, ops: new Set() };  // ops: 진행 도우미 토큰

// ---- 회원 로그인 ----
const members = { pins: new Map(), sessions: new Map() };
(process.env.MOCK_MEMBER_PINS || '').split(',').filter(Boolean).forEach(x => { const [pid, pin] = x.split(':'); members.pins.set(pid, { pin, fails: 0, until: 0 }); });
const activeP = pid => (db.state.players || []).some(p => p.id === pid && p.active !== false);
const memberSession = pid => { const t = crypto.randomUUID(); members.sessions.set(t, pid); return t; };

// ---- 운동 참가 신청 (schema.sql signup_* 흉내). 날짜 '오늘'은 서버 시계(MOCK_NOW) 기준 KST ----
const SG = { defaults: [24, 18, 24, 18, 24], days: {}, rows: [], notices: [], id: 0 };
const isoDow = d => { const x = new Date(d + 'T00:00:00Z').getUTCDay(); return x === 0 ? 7 : x; };
const addD = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const sgCap = d => isoDow(d) <= 5 ? ((SG.days[d] && SG.days[d].cap) || SG.defaults[isoDow(d) - 1]) : null;
const sgOpen = d => { const t = kstDay(now()); return isoDow(d) <= 5 && d >= t && d <= addD(t, 13) && !(SG.days[d] && SG.days[d].closed); };
const sgRows = d => { const cap = sgCap(d) || 0; return SG.rows.filter(r => r.day === d).map((r, i) => Object.assign({}, r, { pos: i + 1, status: i < cap ? 'in' : 'wait', no: i < cap ? i + 1 : i + 1 - cap })); };
const sgInIds = d => sgRows(d).filter(r => r.status === 'in').map(r => r.id);
const sgPromote = (d, before) => {
  const out = [];
  for (const r of sgRows(d)) if (r.status === 'in' && !before.includes(r.id)) { SG.notices.push({ day: d, player_id: r.player_id || r.host_id, kind: r.player_id ? 'in' : 'guest_in' }); out.push(r.player_id || 'g:' + r.guest_name); }
  if (out.length) console.log('[자리 났어요]', d, out.join(', '));
  return out;
};
const sgStatus = (d, id) => { const r = sgRows(d).find(x => x.id === id); return { status: r.status, no: r.no }; };
// MOCK_SIGNUPS=1: 다음 주 월 15명·화 6명·수 24명+대기 3명·목 6명·금 3명 (밴드 11/30 주 숫자와 비슷하게)
const sgSeed = () => {
  if (!process.env.MOCK_SIGNUPS) return;
  const t = kstDay(now()), dw = isoDow(t), mon = addD(t, 8 - dw), act = (db.state.players || []).filter(p => p.active !== false);
  [15, 6, 27, 6, 3].forEach((n, k) => { for (let i = 0; i < n; i++) { const p = act[(i * 7 + k * 3) % act.length]; const d = addD(mon, k); if (!SG.rows.some(r => r.day === d && r.player_id === p.id)) SG.rows.push({ id: ++SG.id, day: d, player_id: p.id, host_id: p.id }); } });
  SG.days[addD(mon, 2)] = { cap: null, memo: '다승왕전 날 · 랜덤빵 제공', closed: false };
};
const memberOf = t => { const pid = members.sessions.get(t); return pid && activeP(pid) ? pid : null; };

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
// ---- 웹 푸시 (schema.sql push_* 흉내). 띄울 때마다 새 VAPID 키 → 미리보기에서도 이 PC Chrome에 진짜 알림이 옴 (키는 메모리에만)
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const vapid = (() => {
  const k = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { publicKey: b64u(k.publicKey.export({ format: 'der', type: 'spki' }).subarray(-65)), privateKey: k.privateKey.export({ format: 'jwk' }).d };
})();
const pushDb = { subs: new Map(), log: new Set() };  // endpoint → {player_id, p256dh, auth}
const isOp = t => db.sessions.has(t) || db.ops.has(t);
const N = { id: 0, list: [] };
if (process.env.MOCK_NOTICES) {
  const t0 = new Date(now() - 2 * 864e5).toISOString(), t1 = new Date(now() - 3600e3).toISOString();
  N.list.push({ id: ++N.id, kind: '규칙', body: '셔틀콕 제출 안내\n남 3개 · 여 2개 · 수지구장 레슨자 1개', pinned: false, pin_until: null, created_at: t0, updated_at: t0 });
  N.list.push({ id: ++N.id, kind: '행사', body: '🏸 청백전 & 치킨데이\n11.27(금) 성남오리초\n끝나고 자담치킨!', pinned: true, pin_until: '2026-11-27', created_at: t1, updated_at: t1 });
}
const RPC = {
  push_subscribe: (a, res) => {
    if (!(db.state.players || []).some(p => p.id === a.p_player && p.active !== false)) return fail(res, 'bad_player');
    if (!/^https:\/\//.test(a.p_endpoint || '')) return fail(res, 'bad_endpoint');
    pushDb.subs.set(a.p_endpoint, { player_id: a.p_player, p256dh: a.p_p256dh, auth: a.p_auth });
    console.log('[알림] 구독', a.p_player, '· 기기', pushDb.subs.size); send(res, 200, 'null');
  },
  push_unsubscribe: (a, res) => { pushDb.subs.delete(a.p_endpoint); send(res, 200, 'null'); },
  push_targets: (a, res) => {
    if (!isOp(a.token)) return fail(res, 'unauthorized');
    const w = db.state.weeks.find(x => x.date === a.p_week), m = w && w.matches.find(x => x.id === a.p_match);
    if (!m) return fail(res, 'no_match');
    if (m.win || m.court == null || !m.startedAt) return fail(res, 'not_on_court');
    const key = a.p_week + '/' + a.p_match + '@' + m.startedAt;
    if (pushDb.log.has(key)) return send(res, 200, '[]');
    pushDb.log.add(key);
    const nm = id => ((db.state.players || []).find(p => p.id === id) || {}).name || '?';
    const ps = m.a.concat(m.b), ta = m.a.map(nm).join('·'), tb = m.b.map(nm).join('·');
    const picked = new Set(P.predictions.filter(p => p.week_date === a.p_week && (p.picks || []).some(x => x.match === a.p_match)).map(p => p.player_id));
    const out = [];
    for (const [endpoint, s] of pushDb.subs) {
      const kind = ps.includes(s.player_id) ? 'player' : picked.has(s.player_id) ? 'predictor' : null;
      if (kind) out.push({ endpoint, p256dh: s.p256dh, auth: s.auth, kind, court: m.court, team_a: ta, team_b: tb });
    }
    console.log('[알림]', a.p_match, '코트', m.court, '→', out.map(o => nm(pushDb.subs.get(o.endpoint).player_id) + '(' + o.kind + ')').join(', ') || '받을 사람 없음');
    send(res, 200, JSON.stringify(out));
  },
  push_gone: (a, res) => { if (!isOp(a.token)) return fail(res, 'unauthorized'); (a.p_endpoints || []).forEach(e => pushDb.subs.delete(e)); send(res, 200, '0'); },
  // ---- 회원 로그인 (schema.sql member_* 흉내, 해시 대신 평문 — 가짜 서버 전용). MOCK_MEMBER_PINS=p001:0000,p002:1234 로 미리 넣을 수 있음 ----
  member_has_pin: (a, res) => send(res, 200, String(members.pins.has(a.pid))),
  member_set_pin: (a, res) => {
    if (!activeP(a.pid)) return fail(res, 'bad_player');
    if (!/^\d{4}$/.test(a.pin || '')) return fail(res, 'bad_pin');
    if (members.pins.has(a.pid)) return fail(res, 'pin_exists');
    members.pins.set(a.pid, { pin: a.pin, fails: 0, until: 0 }); send(res, 200, JSON.stringify(memberSession(a.pid)));
  },
  member_login: (a, res) => {
    if (!activeP(a.pid)) return fail(res, 'bad_player');
    const r = members.pins.get(a.pid); if (!r) return fail(res, 'no_pin');
    if (r.until > now()) return send(res, 200, JSON.stringify({ error: 'locked', until: new Date(r.until).toISOString() }));
    if (a.pin !== r.pin) {
      if (++r.fails >= 5) { r.fails = 0; r.until = now() + 600e3; return send(res, 200, JSON.stringify({ error: 'locked', until: new Date(r.until).toISOString() })); }
      return send(res, 200, JSON.stringify({ error: 'wrong', left: 5 - r.fails }));
    }
    r.fails = 0; r.until = 0; send(res, 200, JSON.stringify({ token: memberSession(a.pid) }));
  },
  member_check: (a, res) => { const pid = members.sessions.get(a.token); send(res, 200, JSON.stringify(pid && activeP(pid) ? pid : null)); },
  member_change_pin: (a, res) => {
    const pid = members.sessions.get(a.token); if (!pid) return fail(res, 'unauthorized');
    const r = members.pins.get(pid); if (!r || r.pin !== a.old_pin) return fail(res, 'wrong_pin');
    if (!/^\d{4}$/.test(a.new_pin || '')) return fail(res, 'bad_pin');
    r.pin = a.new_pin; send(res, 200, 'null');
  },
  member_logout: (a, res) => { members.sessions.delete(a.token); send(res, 200, 'null'); },
  admin_member_pins: (a, res) => { if (!db.sessions.has(a.token)) return fail(res, 'unauthorized'); send(res, 200, JSON.stringify([...members.pins.keys()].sort())); },
  admin_reset_member_pin: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    for (const [t, pid] of members.sessions) if (pid === a.pid) members.sessions.delete(t);
    send(res, 200, String(members.pins.delete(a.pid)));
  },
  signups_list: (a, res) => {
    const out = [];
    for (let d = a.d_from; d <= a.d_to; d = addD(d, 1)) if (isoDow(d) <= 5) out.push({ day: d, cap: sgCap(d), memo: (SG.days[d] || {}).memo || null, closed: !!(SG.days[d] || {}).closed, open: sgOpen(d),
      entries: sgRows(d).map(r => ({ id: r.id, player_id: r.player_id || null, guest: r.guest_name || null, host_id: r.host_id, by_admin: !!r.by_admin, pos: r.pos, status: r.status, no: r.no })) });
    send(res, 200, JSON.stringify(out));
  },
  workout_defaults: (a, res) => send(res, 200, JSON.stringify(SG.defaults)),
  signup_apply: (a, res) => {
    const pid = memberOf(a.token); if (!pid) return fail(res, 'unauthorized');
    if (!sgOpen(a.d)) return fail(res, 'closed_day');
    if (SG.rows.some(r => r.day === a.d && r.player_id === pid)) return fail(res, 'already');
    const id = ++SG.id; SG.rows.push({ id, day: a.d, player_id: pid, host_id: pid }); send(res, 200, JSON.stringify(sgStatus(a.d, id)));
  },
  signup_guest: (a, res) => {
    const pid = memberOf(a.token); if (!pid) return fail(res, 'unauthorized');
    if (!sgOpen(a.d)) return fail(res, 'closed_day');
    const nm = String(a.p_name || '').trim(); if (!nm || nm.length > 20) return fail(res, 'bad_name');
    if (SG.rows.filter(r => r.day === a.d && r.host_id === pid && r.guest_name).length >= 3) return fail(res, 'too_many_guests');
    const id = ++SG.id; SG.rows.push({ id, day: a.d, guest_name: nm, host_id: pid }); send(res, 200, JSON.stringify(sgStatus(a.d, id)));
  },
  signup_cancel: (a, res) => {
    const pid = memberOf(a.token); if (!pid) return fail(res, 'unauthorized');
    if (a.d < kstDay(now())) return fail(res, 'closed_day');
    const before = sgInIds(a.d), i = SG.rows.findIndex(r => r.day === a.d && r.player_id === pid); if (i < 0) return fail(res, 'not_signed');
    SG.rows.splice(i, 1); send(res, 200, JSON.stringify(sgPromote(a.d, before)));
  },
  signup_guest_cancel: (a, res) => {
    const pid = memberOf(a.token); if (!pid) return fail(res, 'unauthorized');
    const i = SG.rows.findIndex(r => r.id === a.sid && r.guest_name); if (i < 0) return fail(res, 'not_signed');
    if (SG.rows[i].host_id !== pid) return fail(res, 'not_yours');
    const d = SG.rows[i].day, before = sgInIds(d); SG.rows.splice(i, 1); send(res, 200, JSON.stringify(sgPromote(d, before)));
  },
  admin_set_day: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (isoDow(a.d) > 5) return fail(res, 'bad_day');
    if (a.p_cap != null && !(a.p_cap >= 1 && a.p_cap <= 99)) return fail(res, 'bad_cap');
    const before = sgInIds(a.d); SG.days[a.d] = { cap: a.p_cap, memo: String(a.p_memo || '').trim() || null, closed: !!a.p_closed };
    send(res, 200, JSON.stringify(sgPromote(a.d, before)));
  },
  admin_set_default_cap: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (!(a.p_dow >= 1 && a.p_dow <= 5)) return fail(res, 'bad_day'); if (!(a.p_cap >= 1 && a.p_cap <= 99)) return fail(res, 'bad_cap');
    SG.defaults[a.p_dow - 1] = a.p_cap; send(res, 200, 'null');
  },
  admin_signup_add: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (!activeP(a.pid)) return fail(res, 'bad_player');
    if (SG.rows.some(r => r.day === a.d && r.player_id === a.pid)) return fail(res, 'already');
    const id = ++SG.id; SG.rows.push({ id, day: a.d, player_id: a.pid, host_id: a.pid, by_admin: true }); send(res, 200, JSON.stringify(sgStatus(a.d, id)));
  },
  admin_signup_remove: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    const before = sgInIds(a.d), i = SG.rows.findIndex(r => r.id === a.sid && r.day === a.d); if (i < 0) return fail(res, 'not_signed');
    SG.rows.splice(i, 1); send(res, 200, JSON.stringify(sgPromote(a.d, before)));
  },
  signup_notices_take: (a, res) => {
    const out = [];
    for (const n of SG.notices.splice(0)) for (const [endpoint, s2] of pushDb.subs) if (s2.player_id === n.player_id) out.push({ endpoint, p256dh: s2.p256dh, auth: s2.auth, kind: n.kind, day: n.day });
    send(res, 200, JSON.stringify(out));
  },
  admin_login: (a, res) => { if (a.pin !== db.pin) return send(res, 200, 'null'); const t = crypto.randomUUID(); db.sessions.add(t); send(res, 200, JSON.stringify(t)); },
  admin_check: (a, res) => send(res, 200, String(db.sessions.has(a.token))),
  admin_logout: (a, res) => { db.sessions.delete(a.token); db.ops.delete(a.token); send(res, 200, 'null'); },
  // ---- 진행 PIN (schema.sql operator_login / live_check / set_operator_pin / live_action 흉내, 만료 시각은 생략) ----
  operator_login: (a, res) => { if (!db.opPin) return fail(res, 'no_op_pin'); if (a.pin !== db.opPin) return send(res, 200, 'null'); const t = crypto.randomUUID(); db.ops.add(t); send(res, 200, JSON.stringify(t)); },
  live_check: (a, res) => send(res, 200, JSON.stringify(db.sessions.has(a.token) ? 'admin' : db.ops.has(a.token) ? 'operator' : null)),
  // ---- 공지 (schema.sql notices_list / notice_save / notice_delete 흉내). MOCK_NOTICES=1이면 예시 공지 2개로 시작 ----
  notices_list: (a, res) => send(res, 200, JSON.stringify(N.list.filter(n => !n.deleted).sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : y.id - x.id)).slice(0, 100).map(({ deleted, author, ...n }) => n))),
  notice_save: (a, res) => {
    if (!isOp(a.token)) return fail(res, 'unauthorized');
    if (!['운동', '행사', '규칙', '결과·소식'].includes(a.p_kind)) return fail(res, 'bad_kind');
    const b = String(a.p_body || '').trim(); if (!b || b.length > 4000) return fail(res, 'bad_body');
    const t = new Date(now()).toISOString();
    if (a.p_id == null) { const n = { id: ++N.id, kind: a.p_kind, body: b, pinned: !!a.p_pinned, pin_until: a.p_pinned ? a.p_pin_until || null : null, created_at: t, updated_at: t }; N.list.push(n); return send(res, 200, String(n.id)); }
    const n = N.list.find(x => x.id === +a.p_id && !x.deleted); if (!n) return fail(res, 'not_found');
    Object.assign(n, { kind: a.p_kind, body: b, pinned: !!a.p_pinned, pin_until: a.p_pinned ? a.p_pin_until || null : null, updated_at: t }); send(res, 200, String(n.id));
  },
  notice_push_targets: (a, res) => {
    if (!isOp(a.token)) return fail(res, 'unauthorized');
    const n = N.list.find(x => x.id === +a.p_id && !x.deleted); N.pushed = N.pushed || new Set();
    if (!n || N.pushed.has(n.id)) return send(res, 200, '[]'); N.pushed.add(n.id);
    const title = (n.body.split('\n').find(l => l.trim()) || '').trim().slice(0, 60);
    console.log('[새 공지 알림]', title, '→ 구독', pushDb.subs.size, '대');
    send(res, 200, JSON.stringify([...pushDb.subs].map(([endpoint, s2]) => ({ endpoint, p256dh: s2.p256dh, auth: s2.auth, title }))));
  },
  notice_delete: (a, res) => { if (!isOp(a.token)) return fail(res, 'unauthorized'); const n = N.list.find(x => x.id === +a.p_id && !x.deleted); if (!n) return fail(res, 'not_found'); n.deleted = true; send(res, 200, 'true'); },
  set_operator_pin: (a, res) => {
    if (!db.sessions.has(a.token)) return fail(res, 'unauthorized');
    if (a.new_pin != null && !/^\d{4}$/.test(a.new_pin)) return fail(res, 'bad_new_pin');
    if (a.new_pin === db.pin) return fail(res, 'same_as_admin');
    db.opPin = a.new_pin; db.ops = new Set(); send(res, 200, 'null');
  },
  live_action: (a, res) => {
    if (!db.sessions.has(a.token) && !db.ops.has(a.token)) return fail(res, 'unauthorized');
    if (!['start', 'finish', 'cancel', 'extra_open', 'extra_close'].includes(a.p_action)) return fail(res, 'bad_action');
    const w = db.state.weeks.find(x => x.date === a.p_week); if (!w) return fail(res, 'no_week');
    const LG = require('../logic.js'), iso = new Date(now()).toISOString();
    if (a.p_action === 'extra_open' || a.p_action === 'extra_close') {
      if (!LG.setExtraCourt(w, a.p_action === 'extra_open')) return fail(res, 'court_busy');
      db.rev++; db.saved_at = new Date().toISOString(); return send(res, 200, String(db.rev));
    }
    const m = w.matches.find(x => x.id === a.p_match); if (!m) return fail(res, 'no_match');
    if (a.p_action === 'start') {
      if (m.win) return fail(res, 'already_done');
      const slots = LG.courtSlots(db.state.settings, w);
      if (m.court != null) return fail(res, 'court_busy');
      if (!slots.includes(a.p_court)) return fail(res, 'bad_court');
      if (w.matches.some(x => !x.win && x.court === a.p_court)) return fail(res, 'court_busy');
      if (!LG.startMatch(w, m.id, a.p_court, iso, slots)) return fail(res, 'player_busy');
    } else if (a.p_action === 'finish') {
      if (m.win) return fail(res, 'already_done');
      if (m.court == null) return fail(res, 'not_on_court');
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
    if (st === 'away' && mn != null && !(mn >= 10 && mn <= 90)) return fail(res, 'bad_minutes');
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
  // 실제 Edge Function 코드(supabase/functions/notify/index.ts)를 그대로 씀. Node가 .ts를 못 읽으면(22 미만) 대상만 콘솔에
  if (u.pathname === '/functions/v1/notify' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', async () => {
      const env = { SUPABASE_URL: 'http://localhost:' + PORT, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:mock@example.com' };
      const r = new Request('http://localhost/functions/v1/notify', { method: 'POST', headers: { apikey: 'mock', 'content-type': 'application/json' }, body });
      try {
        const fn = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'notify', 'index.ts')).href);
        const out = await (await fn.handle(r, { fetch, env, now: Date.now() })).json();
        console.log('[알림] 보냄', JSON.stringify(out)); send(res, 200, out);
      } catch (e) {
        console.log('[알림] notify 코드를 못 불러옴(Node 22 이상 + --experimental-strip-types 필요):', e.message); send(res, 200, { ok: false, code: 'mock_no_ts' });
      }
    });
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
  // 같은 와이파이의 휴대폰으로 PC 주소(http://192.168.x.x:PORT)로 열어도 되게, 접속한 주소를 그대로 씀
  if (u.pathname === '/config.js') return send(res, 200, "window.DDW_CONFIG = { url: 'http://" + (req.headers.host || 'localhost:' + PORT) + "', anonKey: 'mock', realtime: false, vapidKey: '" + vapid.publicKey + "' };", TYPES['.js']);
  const f = path.join(dist, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^[\\/]+/, ''));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
}).listen(PORT, () => sgSeed() || console.log('mock supabase + dist on http://localhost:' + PORT + ' (PIN 1234)' +
  (clockOffset ? ' · 서버 시계 ' + new Date(now()).toISOString() : '') + (demo ? ' · 돼블스플랜 데모 예측 ' + P.predictions.length + '건' : '')));
