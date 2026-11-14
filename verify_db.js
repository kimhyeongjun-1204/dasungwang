// Supabase DB 실제 검증: node verify_db.js   (PIN은 실행 중에 물어봄)
// config.js의 URL·anon key로 anon 권한만 써서 확인.
// 저장 시험은 지금 데이터를 그대로 다시 저장하므로 rev만 1 올라감.
const fs = require('fs');
const crypto = require('crypto');

// node verify_db.js --predict : 돼블스플랜 예측 검증만 (app_state는 읽기만, 저장 시험 건너뜀)
//   테스트 전용 날짜(2000-01-05 마감 지남, 2099-12-30 마감 전)에만 쓰고, 끝나면 그 날짜의 행을 모두 지움
// VERIFY_URL=http://localhost:8788 : 로컬 가짜 서버(tools/mock_supabase.js)로 미리 시험 (localhost만 허용)
const PREDICT_ONLY = process.argv.includes('--predict');
const win = {};
new Function('window', fs.readFileSync(__dirname + '/config.js', 'utf8'))(win);
let { url, anonKey } = win.DDW_CONFIG || {};
if (process.env.VERIFY_URL) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(process.env.VERIFY_URL)) { console.error('VERIFY_URL은 로컬 가짜 서버(http://localhost:포트)만 쓸 수 있어요.'); process.exit(1); }
  url = process.env.VERIFY_URL; anonKey = 'mock';
}
if (!url || /YOUR-/.test(url + anonKey)) { console.error('config.js에 Supabase URL과 anon key를 먼저 넣어 주세요.'); process.exit(1); }
// 새 publishable 키(sb_publishable_…)는 apikey 헤더에만, 예전 anon 키(eyJ…, JWT)는 Authorization에도 넣음
const H = { apikey: anonKey, 'Content-Type': 'application/json' };
if (/^eyJ/.test(anonKey)) H.Authorization = 'Bearer ' + anonKey;

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

  if (PREDICT_ONLY) {
    await predictChecks(pin);
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
    return;
  }
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
  for (const t of ['admin_secret', 'admin_session']) {
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
    return 'null 반환';
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

  console.log('\n잠금 없음 (운영 판단)');
  await check('틀린 PIN을 5번 넣은 뒤에도 맞는 PIN으로 로그인됨', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await rpc('admin_login', { pin: wrong });
      expect(r.status === 200 && r.json === null, (i + 1) + '번째 틀린 PIN 응답: ' + short(r));
    }
    const r = await rpc('admin_login', { pin });
    expect(r.status === 200 && typeof r.json === 'string', '로그인 안 됨: ' + short(r));
    await rpc('admin_logout', { token: r.json });
  });

  await predictChecks(pin);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });

// ---------- 돼블스플랜(승부 예측) ----------
// app_state는 읽기만. 쓰기는 테스트 전용 날짜(2000·2099년)에만 하고 마지막에 admin_test_purge로 전부 지움
async function predictChecks(pin) {
  const PAST = '2000-01-05', FUTURE = '2099-12-30', IDS = ['vt1', 'vt2', 'vt3', 'vt4', 'vt5'];
  const msg = r => r.json && r.json.message;
  const pk = s => s.split(' ').map(t => ({ match: 'vt' + t[0], side: t[1] }));   // '1a 2b 3a 4b'
  const rows = (t, d, q) => req('GET', '/rest/v1/' + t + '?week_date=eq.' + d + (q || ''));
  const countOf = async (d, k, mode) => {
    const r = await rows('prediction_counts', d);
    const c = (r.json || []).find(x => x.match_id === 'vt' + k[0] && x.side === k[1] && x.mode === mode);
    return c ? c.n : 0;
  };
  console.log('\n돼블스플랜 예측 (테스트 날짜 ' + PAST + ' · ' + FUTURE + ', app_state 읽기만)');
  let token = null, pid = null, pid2 = null;
  await check('관리자 로그인 + 명단에서 선수 2명 읽기 (읽기만)', async () => {
    const t = await rpc('admin_login', { pin });
    expect(t.status === 200 && typeof t.json === 'string', short(t));
    token = t.json;
    const r = await readState();
    const ps = ((r.json && r.json.state.players) || []).filter(p => p.active !== false);
    expect(ps.length >= 2, '활동 중 선수가 2명 미만');
    pid = ps[0].id; pid2 = ps[1].id;
    return 'rev ' + r.json.rev;
  });
  if (!token) return;
  const revBefore = (await readState()).json.rev;
  try {
    await check('이전 시험 찌꺼기 정리 + 테스트 주 만들기 (2000·2099년만)', async () => {
      const p = await rpc('admin_test_purge', { token });
      expect(p.status === 200, short(p));
      for (const d of [PAST, FUTURE]) {
        const r = await rpc('admin_test_week', { token, week_date: d, match_ids: IDS });
        expect(r.status < 300, d + ' ' + short(r));
      }
    });
    await check('테스트 주 함수: 실제 날짜는 test_date_only, 무효 토큰은 unauthorized', async () => {
      const a = await rpc('admin_test_week', { token, week_date: '2026-11-18', match_ids: IDS });
      const b = await rpc('admin_test_week', { token: crypto.randomUUID(), week_date: FUTURE, match_ids: IDS });
      expect(msg(a) === 'test_date_only' && msg(b) === 'unauthorized', short(a) + ' / ' + short(b));
    });
    for (const t of ['predictions', 'prediction_counts', 'prediction_events', 'prediction_close']) {
      await check('anon이 ' + t + '에 직접 INSERT하면 거부', async () => {
        const body = t === 'predictions' ? { week_date: FUTURE, player_id: pid, mode: 'high', picks: pk('1a 2a 3a 4a') }
          : t === 'prediction_counts' ? { week_date: FUTURE, match_id: 'vt1', side: 'a', mode: 'high', n: 99 }
            : t === 'prediction_events' ? { week_date: FUTURE, match_id: 'vt1', side: 'a', mode: 'high', delta: 1 }
              : { week_date: FUTURE, match_id: 'vt1', side: 'a', n: 99, total: 99 };
        const r = await req('POST', '/rest/v1/' + t, body);
        expect(denied(r), '거부되지 않음: ' + short(r));
        return short(r);
      });
    }
    const bad = [
      ['3개', { picks: pk('1a 2a 3a') }, 'bad_count'], ['5개', { picks: pk('1a 2a 3a 4a 5a') }, 'bad_count'],
      ['중복 경기', { picks: pk('1a 1b 3a 4a') }, 'dup_match'], ['없는 경기', { picks: pk('1a 2a 3a 9a') }, 'bad_match'],
      ['잘못된 side', { picks: pk('1a 2a 3a 4c') }, 'bad_side'], ['명단에 없는 선수', { player_id: 'no-such-player' }, 'bad_player'],
      ['없는 방식', { mode: 'yolo' }, 'bad_mode'],
    ];
    for (const [name, over, code] of bad) {
      await check('제출 거부: ' + name + ' → ' + code, async () => {
        const r = await rpc('submit_prediction', Object.assign({ week_date: FUTURE, player_id: pid, mode: 'high', picks: pk('1a 2a 3a 4a') }, over));
        expect(r.status >= 400 && msg(r) === code, short(r));
      });
    }
    await check('마감 후 제출 거부 → closed', async () => {
      const r = await rpc('submit_prediction', { week_date: PAST, player_id: pid, mode: 'high', picks: pk('1a 2a 3a 4a') });
      expect(r.status >= 400 && msg(r) === 'closed', short(r));
    });
    await check('정상 제출 → counts +1 (방식별), 이벤트 +4', async () => {
      const r = await rpc('submit_prediction', { week_date: FUTURE, player_id: pid, mode: 'high', picks: pk('1a 2b 3a 4b') });
      expect(r.status === 200, short(r));
      expect(await countOf(FUTURE, '1a', 'high') === 1 && await countOf(FUTURE, '2b', 'high') === 1, 'counts가 1이 아님');
      const ev = await rows('prediction_events', FUTURE);
      expect((ev.json || []).filter(e => e.delta === 1).length === 4, '이벤트 ' + JSON.stringify(ev.json));
    });
    await check('마감 전 anon이 predictions를 읽으면 0행', async () => {
      const r = await rows('predictions', FUTURE);
      expect(r.status === 200 && Array.isArray(r.json) && r.json.length === 0, short(r));
    });
    await check('수정하면 이전 선택은 감소, 새 선택은 증가 (이벤트 -1/+1)', async () => {
      const r = await rpc('submit_prediction', { week_date: FUTURE, player_id: pid, mode: 'high', picks: pk('1a 2b 3a 5a') });
      expect(r.status === 200, short(r));
      expect(await countOf(FUTURE, '4b', 'high') === 0 && await countOf(FUTURE, '5a', 'high') === 1 && await countOf(FUTURE, '1a', 'high') === 1, 'counts가 맞지 않음');
      const ev = (await rows('prediction_events', FUTURE)).json || [];
      expect(ev.some(e => e.match_id === 'vt4' && e.delta === -1) && ev.some(e => e.match_id === 'vt5' && e.delta === 1), '이벤트가 맞지 않음');
    });
    await check('방식을 바꾸면 하이리스크 counts는 빠지고 안전형으로 들어감', async () => {
      const r = await rpc('submit_prediction', { week_date: FUTURE, player_id: pid, mode: 'safe', picks: pk('1a 2b 3a 5a') });
      expect(r.status === 200, short(r));
      expect(await countOf(FUTURE, '1a', 'high') === 0 && await countOf(FUTURE, '1a', 'safe') === 1, 'counts가 맞지 않음');
    });
    await check('관리자 목록: 마감 전에도 전체 보임, 무효 토큰은 unauthorized', async () => {
      const a = await rpc('admin_list_predictions', { token, week_date: FUTURE });
      const b = await rpc('admin_list_predictions', { token: crypto.randomUUID(), week_date: FUTURE });
      expect(a.status === 200 && a.json.length === 1 && a.json[0].player_id === pid, short(a));
      expect(msg(b) === 'unauthorized', short(b));
    });
    await check('관리자 토큰으로는 마감 후에도 수정 가능, 무효 토큰은 거부', async () => {
      const b = await rpc('admin_upsert_prediction', { token: crypto.randomUUID(), week_date: PAST, player_id: pid, mode: 'high', picks: pk('1a 2a 3a 4a') });
      expect(msg(b) === 'unauthorized', short(b));
      for (const [p, s] of [[pid, '1a 2a 3a 4a'], [pid2, '1b 2a 3a 4a']]) {
        const r = await rpc('admin_upsert_prediction', { token, week_date: PAST, player_id: p, mode: 'high', picks: pk(s) });
        expect(r.status === 200, short(r));
      }
    });
    await check('마감 후에는 anon도 predictions를 읽을 수 있음', async () => {
      const r = await rows('predictions', PAST);
      expect(r.status === 200 && r.json.length === 2, short(r));
    });
    let snap = null;
    await check('close_snapshot: 마감 전 0, 마감 후 한 번만 채움 (두 번째는 0)', async () => {
      const a = await rpc('close_snapshot', { week_date: FUTURE });
      const b = await rpc('close_snapshot', { week_date: PAST });
      const c = await rpc('close_snapshot', { week_date: PAST });
      expect(a.json === 0 && b.json > 0 && c.json === 0, [a.json, b.json, c.json].join(' / '));
      snap = (await rows('prediction_close', PAST)).json;
      const v1 = snap.find(x => x.match_id === 'vt1' && x.side === 'a');
      expect(v1 && v1.n === 1 && v1.total === 2, JSON.stringify(snap));
      return '넣은 행 ' + b.json;
    });
    await check('스냅숏 뒤 관리자 수정은 마감 비율(prediction_close)을 바꾸지 않음', async () => {
      const r = await rpc('admin_upsert_prediction', { token, week_date: PAST, player_id: pid2, mode: 'high', picks: pk('1a 2a 3a 4a') });
      expect(r.status === 200, short(r));
      const after = (await rows('prediction_close', PAST)).json;
      const key = x => x.match_id + x.side + ':' + x.n + '/' + x.total;
      expect(JSON.stringify(after.map(key).sort()) === JSON.stringify(snap.map(key).sort()), '스냅숏이 바뀜');
    });
    await check('관리자 삭제 → counts 원래대로', async () => {
      const r = await rpc('admin_delete_prediction', { token, week_date: FUTURE, player_id: pid });
      expect(r.status === 200 && r.json === true, short(r));
      expect(await countOf(FUTURE, '1a', 'safe') === 0, 'counts가 0이 아님');
    });
  } finally {
    await check('정리: 테스트 날짜의 행을 모두 지우고 남은 것 없음', async () => {
      const p = await rpc('admin_test_purge', { token });
      expect(p.status === 200, short(p));
      for (const d of [PAST, FUTURE]) for (const t of ['predictions', 'prediction_counts', 'prediction_events', 'prediction_close']) {
        const r = await rows(t, d);
        expect(r.status === 200 && r.json.length === 0, d + ' ' + t + ' 남음: ' + short(r));
      }
      return '지운 행 ' + JSON.stringify(p.json);
    });
    await check('app_state는 그대로 (rev 변화 없음)', async () => {
      const r = await readState();
      expect(r.json.rev === revBefore, 'rev ' + revBefore + ' → ' + r.json.rev);
      return 'rev ' + r.json.rev;
    });
    await rpc('admin_logout', { token });
  }
}
