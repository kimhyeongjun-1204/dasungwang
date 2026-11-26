// 웹 푸시(Edge Function notify) 테스트. 실행: node --experimental-strip-types push.test.mjs (Node 22)
// 암호화 기대값은 RFC 8291 부록 A 예시 — 참고 구현(http_ece 1.2.0)으로도 같은 값이 나오는 것 확인 (deploy-log 54)
import assert from 'node:assert';
import crypto from 'node:crypto';
import * as N from './supabase/functions/notify/index.ts';

let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message)); } }
const b64 = (s) => Buffer.from(s, 'base64url');

await test('aes128gcm 암호화가 RFC 8291 부록 A 예시와 같음', async () => {
  const body = await N.encryptPayload(
    new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.strictEqual(Buffer.from(body).toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

await test('aes128gcm: 무작위 키로 암호화한 것을 브라우저 쪽 키로 풀면 원문 (Node crypto로 따로 풂)', async () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: '코트 5에서 내 경기 시작', body: '박강호·최신웅 vs 이제영·주성모' });
  const body = Buffer.from(await N.encryptPayload(new TextEncoder().encode(msg), { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }));
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ecdh = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.strictEqual(plain[plain.length - 1], 2, '마지막 레코드 구분자 0x02');
  assert.strictEqual(plain.subarray(0, plain.length - 1).toString(), msg);
  assert.strictEqual(body.readUInt32BE(16), 4096);
});

await test('VAPID: ES256 JWT를 공개키로 검증, aud는 push 서버 주소, 12시간 안 만료', async () => {
  const k = crypto.createECDH('prime256v1'); k.generateKeys();
  const vapid = { publicKey: k.getPublicKey().toString('base64url'), privateKey: k.getPrivateKey().toString('base64url'), subject: 'https://kimhyeongjun-1204.github.io/dasungwang/' };
  const now = Date.parse('2026-11-25T10:00:00Z');
  const h = await N.vapidAuth('https://fcm.googleapis.com/fcm/send/abc', vapid, now);
  const m = h.match(/^vapid t=([^,]+), k=(.+)$/); assert.ok(m, h);
  assert.strictEqual(m[2], vapid.publicKey);
  const [hd, pl, sig] = m[1].split('.');
  assert.deepStrictEqual(JSON.parse(b64(hd)), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(b64(pl));
  assert.deepStrictEqual([claims.aud, claims.sub], ['https://fcm.googleapis.com', vapid.subject]);
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 12 * 3600);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: k.getPublicKey().subarray(1, 33).toString('base64url'), y: k.getPublicKey().subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(hd + '.' + pl), { key: pub, dsaEncoding: 'ieee-p1363' }, b64(sig)), '서명 검증 실패');
});

await test('알림 문구: 내 경기 / 내 예측 경기, 추가 코트', () => {
  assert.deepStrictEqual(N.pushMessage({ kind: 'player', court: 5, team_a: '박강호·최신웅', team_b: '이제영·주성모' }),
    { title: '코트 5에서 내 경기 시작', body: '박강호·최신웅 vs 이제영·주성모' });
  assert.deepStrictEqual(N.pushMessage({ kind: 'predictor', court: 0, team_a: 'A·B', team_b: 'C·D' }),
    { title: '내 예측 경기가 추가 코트에서 시작', body: 'A·B vs C·D' });
});

await test('handle: 대상 조회 → 기기마다 전송, 404·410은 지운다고 알림, 토큰 없으면 거절', async () => {
  const k = crypto.createECDH('prime256v1'); k.generateKeys();
  const env = { SUPABASE_URL: 'https://x.supabase.co', VAPID_PUBLIC_KEY: k.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: k.getPrivateKey().toString('base64url'), VAPID_SUBJECT: 'https://kimhyeongjun-1204.github.io/dasungwang/' };
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = (e) => ({ endpoint: e, p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url'), kind: 'player', court: 6, team_a: 'A·B', team_b: 'C·D' });
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push([url, init && init.headers, init && init.body]);
    if (url.endsWith('/rpc/push_targets')) return new Response(JSON.stringify([sub('https://push.example/ok'), sub('https://push.example/gone')]), { status: 200 });
    if (url.endsWith('/rpc/push_gone')) return new Response('null', { status: 200 });
    if (url === 'https://push.example/ok') return new Response('', { status: 201 });
    if (url === 'https://push.example/gone') return new Response('', { status: 410 });
    return new Response('', { status: 500 });
  };
  const req = new Request('https://x.supabase.co/functions/v1/notify', { method: 'POST', headers: { apikey: 'pub' }, body: JSON.stringify({ token: 't', week: '2026-11-25', match: 'm1' }) });
  const res = await N.handle(req, { fetch: fakeFetch, env, now: Date.now() });
  assert.deepStrictEqual(await res.json(), { ok: true, sent: 1, gone: 1, failed: 0 });
  const t = calls.find(c => c[0].endsWith('/rpc/push_targets'));
  assert.deepStrictEqual(JSON.parse(t[2]), { token: 't', p_week: '2026-11-25', p_match: 'm1' });
  assert.strictEqual(t[1].apikey, 'pub', '요청의 공개 키를 그대로 써서 RPC 호출(서비스 키 안 씀)');
  const okCall = calls.find(c => c[0] === 'https://push.example/ok');
  assert.strictEqual(okCall[1]['Content-Encoding'], 'aes128gcm');
  assert.ok(/^vapid t=/.test(okCall[1].Authorization));
  assert.deepStrictEqual(JSON.parse(calls.find(c => c[0].endsWith('/rpc/push_gone'))[2]), { token: 't', p_endpoints: ['https://push.example/gone'] });
  const bad = await N.handle(new Request('https://x/notify', { method: 'POST', body: '{}' }), { fetch: fakeFetch, env, now: Date.now() });
  assert.deepStrictEqual(await bad.json(), { ok: false, code: 'bad_request' });
  const nokey = await N.handle(req.clone ? new Request('https://x/notify', { method: 'POST', headers: { apikey: 'pub' }, body: JSON.stringify({ token: 't', week: '2026-11-25', match: 'm1' }) }) : req, { fetch: fakeFetch, env: { SUPABASE_URL: 'https://x.supabase.co' }, now: Date.now() });
  assert.deepStrictEqual(await nokey.json(), { ok: false, code: 'no_vapid' });
});

await test('signupMessage: 대기에서 자리 나면 요일·날짜, 게스트는 데려온 사람에게 (2026-11-26)', () => {
  assert.deepStrictEqual(N.signupMessage({ kind: 'in', day: '2026-12-02' }), { title: '수요일 운동 자리 났어요', body: '대기에서 신청 완료로 바뀌었어요 (12/2 수)' });
  assert.deepStrictEqual(N.signupMessage({ kind: 'guest_in', day: '2026-11-30' }), { title: '월요일 운동 게스트 자리 났어요', body: '데려온 게스트가 신청 완료로 바뀌었어요 (11/30 월)' });
});
await test('handle kind=signup: 토큰 없이 signup_notices_take로 꺼내 보내고, 410은 push_unsubscribe', async () => {
  const k = crypto.createECDH('prime256v1'); k.generateKeys();
  const env = { SUPABASE_URL: 'https://x.supabase.co', VAPID_PUBLIC_KEY: k.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: k.getPrivateKey().toString('base64url') };
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = (e) => ({ endpoint: e, p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url'), kind: 'in', day: '2026-12-02' });
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push([url, init && init.body]);
    if (url.endsWith('/rpc/signup_notices_take')) return new Response(JSON.stringify([sub('https://push.example/ok'), sub('https://push.example/gone')]), { status: 200 });
    if (url.endsWith('/rpc/push_unsubscribe')) return new Response('null', { status: 200 });
    if (url === 'https://push.example/ok') return new Response('', { status: 201 });
    if (url === 'https://push.example/gone') return new Response('', { status: 410 });
    return new Response('', { status: 500 });
  };
  const req = new Request('https://x/notify', { method: 'POST', headers: { apikey: 'pub' }, body: JSON.stringify({ kind: 'signup' }) });
  assert.deepStrictEqual(await (await N.handle(req, { fetch: fakeFetch, env, now: Date.now() })).json(), { ok: true, sent: 1, gone: 1, failed: 0 });
  assert.ok(!calls.some(c => c[0].endsWith('/rpc/push_targets')), '경기 알림 대상은 안 부름');
  assert.deepStrictEqual(JSON.parse(calls.find(c => c[0].endsWith('/rpc/push_unsubscribe'))[1]), { p_endpoint: 'https://push.example/gone' });
});

console.log(pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
if (fail) process.exit(1);
