// 로컬 화면 확인용 가짜 Supabase (개발 전용): node tools/mock_supabase.js → http://localhost:8787
// dist/를 그대로 서빙하고 /rest/v1 의 app_state 읽기와 RPC(save_state 등)를 메모리에서 흉내 냄. 테스트 PIN 1234.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8787;
const dist = path.join(__dirname, '..', 'dist');
const src = fs.existsSync(path.join(__dirname, '..', 'live_state.json')) ? require('../live_state.json') : require('../seed.js');
const state = JSON.parse(JSON.stringify(src));
delete state.rev; delete state.savedAt; if (state.settings) delete state.settings.pin;
const db = { state, rev: src.rev || 1, saved_at: src.savedAt || new Date().toISOString(), pin: '1234', sessions: new Set() };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function send(res, status, body, type) { res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
function fail(res, msg) { send(res, 400, { code: 'P0001', message: msg, details: null, hint: null }); }

const RPC = {
  admin_login: (a, res) => { if (a.pin !== db.pin) return send(res, 200, 'null'); const t = crypto.randomUUID(); db.sessions.add(t); send(res, 200, JSON.stringify(t)); },
  admin_check: (a, res) => send(res, 200, String(db.sessions.has(a.token))),
  admin_logout: (a, res) => { db.sessions.delete(a.token); send(res, 200, 'null'); },
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
    db.pin = a.new_pin; db.sessions = new Set([a.token]); send(res, 200, 'null');
  },
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/rest/v1/app_state' && req.method === 'GET') return send(res, 200, { state: db.state, rev: db.rev, saved_at: db.saved_at });
  if (u.pathname.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => { const f = RPC[u.pathname.slice(13)]; f ? f(JSON.parse(body || '{}'), res) : send(res, 404, { message: 'no function' }); });
  }
  if (u.pathname === '/config.js') return send(res, 200, "window.DDW_CONFIG = { url: 'http://localhost:" + PORT + "', anonKey: 'mock' };", TYPES['.js']);
  const f = path.join(dist, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^[\\/]+/, ''));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
}).listen(PORT, () => console.log('mock supabase + dist on http://localhost:' + PORT + ' (PIN 1234)'));
