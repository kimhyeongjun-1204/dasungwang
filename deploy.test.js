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
  const l = E({ message: 'locked', details: '420', code: 'P0001' });
  assert.strictEqual(l.code, 'locked');
  assert.strictEqual(l.wait, 420);
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
test('api.login: 맞으면 토큰, 틀리면 null, 잠금이면 locked', async () => {
  const r = need();
  assert.strictEqual(await r.api(fakeClient({ admin_login: a => ({ data: a.pin === '1234' ? 'tok' : null, error: null }) })).login('1234'), 'tok');
  assert.strictEqual(await r.api(fakeClient({ admin_login: () => ({ data: null, error: null }) })).login('0000'), null);
  await assert.rejects(r.api(fakeClient({ admin_login: () => ({ data: null, error: { message: 'locked', details: '600' } }) })).login('1'), e => e.code === 'locked' && e.wait === 600);
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

console.log('app.js');
const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
test('app.js: 아티팩트 자기 재게시·브라우저 PIN 해시·내장 state를 쓰지 않음', () => {
  assert.ok(!/artifact\.publish|buildDoc/.test(appSrc), 'publish/buildDoc 남아 있음');
  assert.ok(!/pinHash/.test(appSrc), 'pinHash 남아 있음');
  assert.ok(!/getElementById\('state'\)/.test(appSrc), '<script id="state"> 읽기 남아 있음');
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
