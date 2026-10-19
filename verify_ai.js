// 돼장 요청 기능 실제 시험: node verify_ai.js "요청 문장" [날짜]
// PIN으로 로그인 → 실제 데이터로 Edge Function 'rematch' 호출 → 계획·점검 결과·토큰 비용 출력. DB에는 아무것도 저장하지 않음
const fs = require('fs');
const L = require('./logic.js');
const win = {};
new Function('window', fs.readFileSync(__dirname + '/config.js', 'utf8'))(win);
const { url, anonKey } = win.DDW_CONFIG || {};
const H = { apikey: anonKey, 'Content-Type': 'application/json' };
if (/^eyJ/.test(anonKey)) H.Authorization = 'Bearer ' + anonKey;
const PRICE = { input: 4, output: 20 }; // Claude Opus 5.5, 100만 토큰당 달러
const TIER = { hell: '지옥도', heaven: '천국도', mid: '중립', new: '첫 참가', unknown: '결과 대기' };

const request = process.argv[2];
if (!request) { console.error('사용법: node verify_ai.js "요청 문장" [YYYY-MM-DD]'); process.exit(1); }

async function post(path, body, extra) {
  const r = await fetch(url + path, { method: 'POST', headers: Object.assign({}, H, extra), body: JSON.stringify(body) });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; } catch (e) { return { status: r.status, json: null, text }; }
}
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
  const st = await fetch(url + '/rest/v1/app_state?select=state,rev&id=eq.1', { headers: Object.assign({}, H, { Accept: 'application/vnd.pgrst.object+json' }) }).then(r => r.json());
  const state = st.state;
  const withMatches = state.weeks.filter(w => w.matches && w.matches.length).map(w => w.date).sort();
  const date = process.argv[3] || withMatches[withMatches.length - 1];
  const w = state.weeks.find(x => x.date === date);
  if (!w) { console.error('그 날짜 주가 없어요: ' + date); process.exit(1); }
  const pm = {}; state.players.forEach(p => { pm[p.id] = p; });
  const gname = id => (state.settings.groups.find(g => g.id === id) || {}).name || id;
  const idx = {};
  const payload = {
    request, date,
    groups: state.settings.groups.map(g => ({ id: g.id, name: g.name })),
    players: Object.keys(w.attendees || {}).filter(id => pm[id]).map(id => ({ id, name: pm[id].name, group: pm[id].group, pool: w.attendees[id], tier: TIER[L.tierOf(state, id, date).tier] })),
    matches: w.matches.map(m => { idx[m.pool] = (idx[m.pool] || 0) + 1; return { id: m.id, pool: m.pool, label: gname(m.pool) + ' ' + idx[m.pool] + '경기', a: m.a, b: m.b, off: m.off || [], decided: !!m.win }; }),
    rules: (w.rules || []).map(r => ({ id: r.id, type: r.type, players: r.players, text: L.ruleText(state, r) })),
  };

  const pin = await askPin();
  const login = await post('/rest/v1/rpc/admin_login', { pin });
  if (typeof login.json !== 'string') { console.error('로그인 실패: ' + login.status + ' ' + JSON.stringify(login.json)); process.exit(1); }
  const token = login.json;
  console.log('주: ' + date + ', 참석 ' + payload.players.length + '명, 경기 ' + payload.matches.length + '개');
  console.log('요청: ' + request + '\n');

  const t0 = Date.now();
  const r = await post('/functions/v1/rematch', Object.assign({ token }, payload));
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  await post('/rest/v1/rpc/admin_logout', { token });
  if (!r.json || !r.json.ok) { console.log('실패 (' + sec + '초): HTTP ' + r.status + ' ' + (r.json ? JSON.stringify(r.json) : r.text)); process.exit(1); }

  const { plan, explanation, usage } = r.json;
  console.log('Claude 설명: ' + explanation);
  console.log('계획: ' + JSON.stringify(plan));
  const out = L.applyPlan(state, date, plan, { seed: 1 });
  const issues = L.validateWeek(state, out.week);
  console.log('다시 짠 조: ' + (out.regenerated.join(', ') || '없음'));
  console.log('반영 못 한 것: ' + (out.errors.join(' / ') || '없음'));
  console.log('점검: ' + (issues.map(x => x.msg).join(' / ') || '통과'));
  const cost = usage.input_tokens / 1e6 * PRICE.input + usage.output_tokens / 1e6 * PRICE.output;
  console.log('시간 ' + sec + '초, 모델 ' + usage.model + ', 입력 ' + usage.input_tokens + ' / 출력 ' + usage.output_tokens + ' 토큰, 약 $' + cost.toFixed(4));
})().catch(e => { console.error(e); process.exit(1); });
