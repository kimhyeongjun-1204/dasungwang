// 경기가 코트에 들어가면 그 경기 4명과, 그 경기를 예측한 사람에게 웹 푸시를 보냄 (사용자 요청 2026-11-23)
// 배포: Supabase 대시보드 › Edge Functions › 이름 notify 로 이 파일 붙여 넣기
// 비밀값: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY(웹 푸시 키, npx web-push generate-vapid-keys), VAPID_SUBJECT(사이트 주소)
// 누가 받는지는 DB 함수 push_targets(token, week, match)가 정함: 돼장·도우미 토큰 확인, 코트에 있는 경기만, 같은 시작에는 한 번만.
// 이 함수는 서비스 키를 쓰지 않고 요청의 공개 키(apikey)로 그 RPC만 부름. 항상 HTTP 200 + {ok, sent, gone, failed} 또는 {ok:false, code}
// 외부 라이브러리 없이 WebCrypto로 RFC 8291(aes128gcm)·RFC 8292(VAPID)를 구현 → Node 22에서도 그대로 테스트(push.test.mjs)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { headers: { ...CORS, "Content-Type": "application/json" } });

const enc = new TextEncoder();
const b64u = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const toB64u = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
// P-256 키: 공개키는 65바이트(0x04||x||y), 개인키는 32바이트(d) base64url (web-push 형식)
const jwk = (pub: string, priv?: string) => {
  const p = b64u(pub);
  const k: Record<string, unknown> = { kty: "EC", crv: "P-256", x: toB64u(p.slice(1, 33)), y: toB64u(p.slice(33, 65)), ext: true };
  if (priv) k.d = priv;
  return k;
};
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
};

// RFC 8291 aes128gcm 한 레코드. fixed는 테스트용(서버 임시 키·salt 고정)
export async function encryptPayload(
  plain: Uint8Array,
  sub: { p256dh: string; auth: string },
  fixed?: { asPrivate: string; asPublic: string; salt: string },
): Promise<Uint8Array> {
  const uaPub = b64u(sub.p256dh), auth = b64u(sub.auth);
  let asPriv: CryptoKey, asPub: Uint8Array;
  if (fixed) {
    asPriv = await crypto.subtle.importKey("jwk", jwk(fixed.asPublic, fixed.asPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    asPub = b64u(fixed.asPublic);
  } else {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    asPriv = kp.privateKey;
    asPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPriv, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = fixed ? b64u(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(plain, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// RFC 8292 VAPID: Authorization 헤더 값
export async function vapidAuth(endpoint: string, vapid: { publicKey: string; privateKey: string; subject: string }, now: number): Promise<string> {
  const head = toB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toB64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })));
  const key = await crypto.subtle.importKey("jwk", jwk(vapid.publicKey, vapid.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims)));
  return "vapid t=" + head + "." + claims + "." + toB64u(sig) + ", k=" + vapid.publicKey;
}

const courtLabel = (n: number) => (n === 0 ? "추가 코트" : "코트 " + n);
export function pushMessage(t: { kind: string; court: number; team_a: string; team_b: string }) {
  const where = courtLabel(t.court);
  return {
    title: t.kind === "player" ? where + "에서 내 경기 시작" : "내 예측 경기가 " + where + "에서 시작",
    body: t.team_a + " vs " + t.team_b,
  };
}

type Deps = { fetch: typeof fetch; env: Record<string, string | undefined>; now: number };
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 아래에서 거절 */ }
  const token = body.token, week = body.week, match = body.match;
  if (typeof token !== "string" || typeof week !== "string" || typeof match !== "string") return reply({ ok: false, code: "bad_request" });
  const env = deps.env;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.SUPABASE_URL) return reply({ ok: false, code: "no_vapid" });
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "https://kimhyeongjun-1204.github.io/dasungwang/" };
  const apikey = req.headers.get("apikey") ?? "";
  const rpc = (name: string, args: unknown) =>
    deps.fetch(env.SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const r = await rpc("push_targets", { token, p_week: week, p_match: match });
  if (!r.ok) {
    let code = "error";
    try { code = (await r.json()).message || code; } catch { /* 그대로 */ }
    return reply({ ok: false, code });
  }
  const targets = await r.json() as { endpoint: string; p256dh: string; auth: string; kind: string; court: number; team_a: string; team_b: string }[];
  let sent = 0, failed = 0;
  const gone: string[] = [];
  for (const t of targets) {
    try {
      const msg = pushMessage(t);
      const payload = enc.encode(JSON.stringify({ title: msg.title, body: msg.body, tag: "court-" + match, url: "./" }));
      const res = await deps.fetch(t.endpoint, {
        method: "POST",
        headers: {
          Authorization: await vapidAuth(t.endpoint, vapid, deps.now),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "600",
          Urgency: "high",
        },
        body: await encryptPayload(payload, t),
      });
      if (res.status === 404 || res.status === 410) gone.push(t.endpoint);
      else if (res.ok) sent++;
      else failed++;
    } catch { failed++; }
  }
  if (gone.length) await rpc("push_gone", { token, p_endpoints: gone });
  return reply({ ok: true, sent, gone: gone.length, failed });
}

// Supabase(Deno)에서만 서버를 띄움. Node 테스트에서는 함수만 가져다 씀
const D = (globalThis as unknown as { Deno?: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } } }).Deno;
if (D) D.serve((req) => {
  const env: Record<string, string | undefined> = {};
  for (const k of ["SUPABASE_URL", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) env[k] = D.env.get(k);
  return handle(req, { fetch, env, now: Date.now() });
});
