// Supabase DB 실제 검증: node verify_db.js   (PIN은 실행 중에 물어봄. 잠금 시험을 빼려면 --skip-lock)
// config.js의 URL·anon key로 anon 권한만 써서 확인. 마지막 잠금 시험 뒤에는 관리자 로그인이 10분 잠김.
// 저장 시험은 지금 데이터를 그대로 다시 저장하므로 rev만 1 올라감.
const fs = require('fs');
const crypto = require('crypto');

const win = {};
new Function('window', fs.readFileSync(__dirname + '/config.js', 'utf8'))(win);
const { url, anonKey } = win.DDW_CONFIG || {};
if (!url || /YOUR-/.test(url + anonKey)) { console.error('config.js에 Supabase URL과 anon key를 먼저 넣어 주세요.'); process.exit(1); }
const skipLock = process.argv.includes('--skip-lock');
const H = { apikey: anonKey, Authorization: 'Bearer ' + anonKey, 'Content-Type': 'application/json' };

async function req(method, path, body, extra) {
  const r = await fetch(url + path, { method, headers: Object.assign({}, H, extra), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { }
  return { status: r.status, json, text };
}
const rpc = (name, args) => req('POST', '/rest/v1/rpc/' + name, args);
const readState = () => req('GET', '/rest/v1/app_state?select=state,rev,saved_at&id=eq.1', undefined, { Accept: 'application/vnd.pgrst.object+json' });
const denied = r => r.status === 401 || r.status === 403;

let passed = 0, failed = 0;
async function check(name, fn) {
  try { const note = await fn(); passed++; console.log('  ok  ' + name + (note ? '  (' + note + ')' : '')); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function short(r) { return r.status + ' ' + (r.json && (r.json.code || '') + ' ' + (r.json.message || '') || r.text).slice(0, 120); }

function askPin() {
  if (process.env.ADMIN_PIN) return Promise.resolve(process.env.ADMIN_PIN);
  return new Promise(res => {
    const stdin = process.stdin;
    process.stdout.write('관리 PIN 4자리 (화면에 안 보임): ');
    if (!stdin.isTTY) { let d = ''; stdin.on('data', c => d += c).on('end', () => res(d.trim())); return; }
    stdin.setRawMode(true); stdin.resume();
    let s = '';
    stdin.on('data', function on(b) {
      for (const ch of b.toString()) {
        if (ch === '\u0003') process.exit(130);
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', on); process.stdout.write('\n'); return res(s); }
        if (ch === '\b' || ch === '\x7f') s = s.slice(0, -1); else s += ch;
      }
    });
  });
}

(async () => {
  const pin = await askPin();
  if (!/^\d{4}$/.test(pin)) { console.error('PIN은 숫자 4자리'); process.exit(1); }
  const wrong = String((+pin + 1) % 10000).padStart(4, '0');
  console.log('대상: ' + url + '\n');

  let cur = null, token = null;
  console.log('읽기·권한');
  await check('anon이 app_state를 읽을 수 있음', async () => {
    const r = await readState();
    expect(r.status === 200 && r.json && r.json.state, short(r));
    cur = r.json;
    return 'rev ' + cur.rev + ', 선수 ' + (cur.state.players || []).length + '명';
  });
  await check('공개 state에 settings.pin이 없음', async () => {
    expect(cur, '읽기 실패');
    expect(!(cur.state.settings && 'pin' in cur.state.settings), 'settings.pin이 있음');
  });
  await check('anon이 app_state를 직접 UPDATE하면 거부', async () => {
    const r = await req('PATCH', '/rest/v1/app_state?id=eq.1', { rev: 99999 }, { Prefer: 'return=representation' });
    expect(denied(r), '거부되지 않음: ' + short(r));
    const after = await readState();
    expect(after.json && after.json.rev === cur.rev, 'rev가 바뀜');
    return short(r);
  });
  await check('anon이 app_state에 직접 INSERT하면 거부', async () => {
    const r = await req('POST', '/rest/v1/app_state', { id: 1, state: {}, rev: 0 });
    expect(denied(r), '거부되지 않음: ' + short(r));
    return short(r);
  });
  await check('anon이 app_state를 DELETE하면 거부', async () => {
    const r = await req('DELETE', '/rest/v1/app_state?id=eq.1');
    expect(denied(r), '거부되지 않음: ' + short(r));
    return short(r);
  });
  for (const t of ['admin_secret', 'admin_session', 'admin_login_guard']) {
    await check('anon이 ' + t + '를 읽으면 거부', async () => {
      const r = await req('GET', '/rest/v1/' + t + '?select=*');
      expect(denied(r), '거부되지 않음: ' + short(r));
      return short(r);
    });
  }
  await check('anon이 set_admin_pin을 호출하면 거부', async () => {
    const r = await rpc('set_admin_pin', { new_pin: '0000' });
    expect(r.status >= 400, '거부되지 않음: ' + short(r));
    return short(r);
  });

  console.log('\n로그인·저장');
  await check('맞는 PIN으로 로그인하면 토큰 발급', async () => {
    const r = await rpc('admin_login', { pin });
    expect(r.status === 200 && typeof r.json === 'string' && /^[0-9a-f-]{36}$/.test(r.json), short(r));
    token = r.json;
  });
  await check('admin_check: 발급 토큰은 유효, 임의 토큰은 무효', async () => {
    const a = await rpc('admin_check', { token }), b = await rpc('admin_check', { token: crypto.randomUUID() });
    expect(a.json === true && b.json === false, short(a) + ' / ' + short(b));
  });
  await check('틀린 PIN 로그인은 실패 (토큰 없음)', async () => {
    const r = await rpc('admin_login', { pin: wrong });
    expect(r.status === 200 && r.json === null, short(r));
    return '실패 1회 기록됨';
  });
  await check('무효 토큰으로 저장하면 unauthorized', async () => {
    const r = await rpc('save_state', { token: crypto.randomUUID(), new_state: cur.state, expected_rev: cur.rev });
    expect(r.status >= 400 && r.json && r.json.message === 'unauthorized', short(r));
    return short(r);
  });
  await check('오래된 rev로 저장하면 stale_rev', async () => {
    const r = await rpc('save_state', { token, new_state: cur.state, expected_rev: cur.rev - 1 });
    expect(r.status >= 400 && r.json && r.json.message === 'stale_rev', short(r));
    const after = await readState();
    expect(after.json.rev === cur.rev, 'rev가 바뀜');
    return short(r);
  });
  await check('유효한 토큰 + 최신 rev로 저장하면 성공하고 rev +1 (보낸 settings.pin은 서버가 버림)', async () => {
    const sent = JSON.parse(JSON.stringify(cur.state));
    sent.settings.pin = { salt: 'x', hash: 'should-not-be-stored' };
    const r = await rpc('save_state', { token, new_state: sent, expected_rev: cur.rev });
    expect(r.status === 200 && r.json === cur.rev + 1, short(r));
    const after = await readState();
    expect(after.json.rev === cur.rev + 1, 'DB rev ' + after.json.rev);
    expect(!('pin' in after.json.state.settings), 'settings.pin이 저장됨');
    expect(JSON.stringify(after.json.state.players) === JSON.stringify(cur.state.players) && JSON.stringify(after.json.state.weeks) === JSON.stringify(cur.state.weeks), '데이터가 달라짐');
    return 'rev ' + cur.rev + ' → ' + after.json.rev;
  });
  await check('change_pin: 지금 PIN이 틀리면 bad_pin', async () => {
    const r = await rpc('change_pin', { token, old_pin: wrong, new_pin: pin });
    expect(r.status >= 400 && r.json && r.json.message === 'bad_pin', short(r));
    return short(r);
  });
  await check('로그아웃하면 토큰 무효', async () => {
    await rpc('admin_logout', { token });
    const r = await rpc('admin_check', { token });
    expect(r.json === false, short(r));
  });

  if (!skipLock) {
    console.log('\n무차별 대입 잠금 (위의 틀린 PIN 1회 + 아래 4회 = 연속 5회)');
    await check('틀린 PIN을 연속 5회 넣으면 잠금, 잠긴 동안은 맞는 PIN도 거부', async () => {
      for (let i = 0; i < 4; i++) {
        const r = await rpc('admin_login', { pin: wrong });
        expect(r.status === 200 && r.json === null, (i + 2) + '번째 실패 응답: ' + short(r));
      }
      const r = await rpc('admin_login', { pin });
      expect(r.status >= 400 && r.json && r.json.message === 'locked', '잠기지 않음: ' + short(r));
      return '잠금 남은 시간 ' + r.json.details + '초';
    });
  } else console.log('\n(잠금 시험 건너뜀)');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
