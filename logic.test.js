// 편성·집계 로직 테스트 (node logic.test.js) — 구현 전에 작성
const assert = require('assert');
const L = require('./logic.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

function mkPlayers(n, heatFn) {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, heat: heatFn ? heatFn(i) : 1, skill: 0.5 }));
}
function officialCounts(matches) {
  const c = {};
  matches.forEach(m => m.a.concat(m.b).forEach(pid => {
    c[pid] = c[pid] || { off: 0, apps: 0 };
    c[pid].apps++;
    if (L.isOfficial(m, pid)) c[pid].off++;
  }));
  return c;
}
function partnerRepeats(matches) {
  const seen = {}; let rep = 0;
  matches.forEach(m => [m.a, m.b].forEach(t => {
    const k = t.slice().sort().join('|');
    if (seen[k]) rep++; seen[k] = 1;
  }));
  return rep;
}

console.log('wednesdays');
test('시즌 10/6~12/23 수요일은 12번', () => {
  const w = L.wednesdays('2026-10-06', '2026-12-23');
  assert.strictEqual(w.length, 12);
  assert.strictEqual(w[0], '2026-10-07');
  assert.strictEqual(w[11], '2026-12-23');
});

test('seasonDays: 진행 안 한 수요일(skipDates)은 시즌에서 빠짐', () => {
  const d = L.seasonDays({ seasonStart: '2026-10-07', seasonEnd: '2026-12-23', skipDates: ['2026-10-14'] });
  assert.strictEqual(d.length, 11);
  assert(!d.includes('2026-10-14'));
  assert.strictEqual(d[1], '2026-10-21');
  assert.strictEqual(L.seasonDays({ seasonStart: '2026-10-07', seasonEnd: '2026-12-23' }).length, 12);
});

console.log('generatePool');
for (let n = 4; n <= 23; n++) {
  test(`${n}명: 전원 공식 2경기, 경기 수 ceil(n/2), 한 경기 중복 없음, 파트너 중복 없음`, () => {
    const res = L.generatePool(mkPlayers(n), 12345 + n);
    assert(!res.error, res.error);
    const ms = res.matches;
    assert.strictEqual(ms.length, Math.ceil(n / 2));
    ms.forEach(m => assert.strictEqual(new Set(m.a.concat(m.b)).size, 4, '한 경기에 같은 사람 2번'));
    const c = officialCounts(ms);
    assert.strictEqual(Object.keys(c).length, n);
    Object.entries(c).forEach(([pid, v]) => assert.strictEqual(v.off, 2, pid + ' 공식 ' + v.off));
    const extras = Object.values(c).filter(v => v.apps === 3).length;
    assert.strictEqual(extras, n % 2 === 1 ? 2 : 0);
    assert.strictEqual(partnerRepeats(ms), 0);
  });
}
test('3명 이하는 편성 불가 에러', () => {
  assert(L.generatePool(mkPlayers(3), 1).error);
});
test('추가출전은 그 선수의 마지막 경기에서 기록 제외', () => {
  const ms = L.generatePool(mkPlayers(5), 7).matches;
  const c = officialCounts(ms);
  Object.keys(c).filter(p => c[p].apps === 3).forEach(pid => {
    const idx = ms.map((m, i) => (m.a.concat(m.b).includes(pid) ? i : -1)).filter(i => i >= 0);
    assert(!L.isOfficial(ms[idx[2]], pid), '마지막 경기가 제외돼야 함');
    assert(L.isOfficial(ms[idx[0]], pid) && L.isOfficial(ms[idx[1]], pid));
  });
});
test('지옥도 4명·천국도 4명이면 같은 등급끼리만 경기', () => {
  const ps = mkPlayers(8, i => (i < 4 ? 2 : 0));
  const heat = Object.fromEntries(ps.map(p => [p.id, p.heat]));
  const ms = L.generatePool(ps, 99).matches;
  ms.forEach(m => {
    const hs = m.a.concat(m.b).map(id => heat[id]);
    assert.strictEqual(Math.max(...hs) - Math.min(...hs), 0, '등급 섞임: ' + hs);
  });
});
test('같은 시드면 같은 결과(재현 가능)', () => {
  const a = L.generatePool(mkPlayers(9), 42).matches;
  const b = L.generatePool(mkPlayers(9), 42).matches;
  assert.deepStrictEqual(a, b);
});

// 10/7 캐비어조 실제 편성으로 집계 검증
const state = {
  settings: { countBy: 'registered', groups: [{ id: 'A', name: '캐비어·랍스터', winners: 1 }, { id: 'B', name: '소갈비·양갈비', winners: 2 }] },
  players: [
    { id: 'a', name: '조영재', group: 'A' }, { id: 'b', name: '김성곤', group: 'A' },
    { id: 'c', name: '최신웅', group: 'A' }, { id: 'd', name: '주성모', group: 'A' },
    { id: 'e', name: '박지섭', group: 'A' }, { id: 'f', name: '유성준', group: 'A' },
    { id: 'x', name: '이태훈', group: 'B' },
  ],
  weeks: [{
    date: '2026-10-07', attendees: { a: 'A', b: 'A', c: 'A', d: 'A', e: 'A', f: 'A' },
    matches: [
      { id: 'm1', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: [], win: 'a' },
      { id: 'm2', pool: 'A', a: ['a', 'e'], b: ['b', 'f'], off: [], win: 'a' },
      { id: 'm3', pool: 'A', a: ['c', 'f'], b: ['e', 'd'], off: [], win: null },
    ],
  }],
};

console.log('weekTally / standings / tier');
test('승패·미입력 집계', () => {
  const t = L.weekTally(state.weeks[0]);
  assert.deepStrictEqual([t.a.wins, t.a.losses, t.a.pending], [2, 0, 0]);
  assert.deepStrictEqual([t.b.wins, t.b.losses], [1, 1]);
  assert.deepStrictEqual([t.c.wins, t.c.losses, t.c.pending], [0, 1, 1]);
});
test('기록 제외(off) 선수는 이겨도 승수 없음', () => {
  const w = { matches: [{ id: 'z', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: ['a'], win: 'a' }] };
  const t = L.weekTally(w);
  assert.strictEqual(t.a.wins, 0);
  assert.strictEqual(t.a.extra, 1);
  assert.strictEqual(t.b.wins, 1);
});
test('순위: 승수 내림차순, 동률은 같은 순위', () => {
  const s = L.standings(state).A;
  assert.strictEqual(s[0].name, '조영재');
  assert.strictEqual(s[0].rank, 1);
  // m1 조영재·김성곤 승, m2 조영재·박지섭 승 → 김성곤 1, 박지섭 1, 유성준 0
  const b = s.find(r => r.name === '김성곤'), e = s.find(r => r.name === '박지섭'), f = s.find(r => r.name === '유성준');
  assert.strictEqual(b.wins, 1); assert.strictEqual(e.wins, 1); assert.strictEqual(f.wins, 0);
  assert.strictEqual(b.rank, e.rank, '1승 동률 같은 순위');
  const zero = s.filter(r => r.wins === 0);
  assert(zero.every(r => r.rank === zero[0].rank), '0승 동률 같은 순위');
});
test('다승왕 커트라인 동률이면 추첨 표시', () => {
  const st = JSON.parse(JSON.stringify(state));
  st.weeks[0].matches[1].win = 'b'; // 조영재 1승, 김성곤 2승? -> 김성곤: m1 승, m2 승 = 2승
  st.weeks[0].matches[0].win = 'b'; // m1 최신웅·주성모 승 -> 김성곤 1승(m2), 조영재 0승
  // 결과: 김성곤 1, 유성준 1, 최신웅 1, 주성모 1 -> 1위 4명 동률, 다승왕 1명
  const s = L.standings(st).A;
  const top = s.filter(r => r.rank === 1);
  assert.strictEqual(top.length, 4);
  assert(top.every(r => r.lottery), '추첨 대상 표시');
});
test('등록 조 기준 vs 경기 조 기준', () => {
  const st = JSON.parse(JSON.stringify(state));
  st.weeks[0].matches[0].a = ['x', 'b']; // 이태훈(B)이 A풀 경기에서 승
  let s = L.standings(st);
  assert(s.B.find(r => r.name === '이태훈').wins === 1);
  st.settings.countBy = 'pool';
  s = L.standings(st);
  assert(s.A.find(r => r.name === '이태훈').wins === 1);
  assert(!s.B.find(r => r.name === '이태훈' && r.wins > 0));
});
test('지옥도/천국도: 직전 참가 주 2승→지옥, 0승→천국, 1승→중립, 미입력→미정', () => {
  assert.strictEqual(L.tierOf(state, 'a', '2026-10-14').tier, 'hell');
  assert.strictEqual(L.tierOf(state, 'b', '2026-10-14').tier, 'mid');
  assert.strictEqual(L.tierOf(state, 'd', '2026-10-14').tier, 'heaven'); // m1 패, m3 미입력 -> 결정된 1경기 0승
  assert.strictEqual(L.tierOf(state, 'x', '2026-10-14').tier, 'new');
  assert.strictEqual(L.tierOf(state, 'a', '2026-10-07').tier, 'new'); // 해당 주 자신은 제외
});

test('공개 전 주의 미입력 경기는 대기·참가 주에 안 잡힘', () => {
  const st = JSON.parse(JSON.stringify(state));
  st.weeks[0].published = true;
  st.weeks.push({ date: '2026-10-14', published: false, attendees: { a: 'A' }, matches: [{ id: 'n1', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: [], win: null }] });
  const a = L.standings(st).A.find(r => r.name === '조영재');
  assert.strictEqual(a.pending, 0);
  assert.strictEqual(a.weeks, 1);
  const c = L.standings(st).A.find(r => r.name === '최신웅');
  assert.strictEqual(c.pending, 1); // 10/7(공개) m3 미입력은 대기로 잡힘
});

console.log('validateWeek');
test('공식 2경기 아닌 참석자·파트너 중복·중복 출전 경고', () => {
  const w = {
    attendees: { a: 'A', b: 'A', c: 'A', d: 'A', e: 'A' },
    matches: [
      { id: '1', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: [] },
      { id: '2', pool: 'A', a: ['a', 'b'], b: ['c', 'c'], off: [] },
    ],
  };
  const issues = L.validateWeek(state, w).map(i => i.code);
  assert(issues.includes('dup_in_match'));
  assert(issues.includes('partner_repeat'));
  assert(issues.includes('official_count')); // e 0경기
});
test('10/7 캐비어조 실제 편성은 이슈 없음', () => {
  assert.deepStrictEqual(L.validateWeek(state, state.weeks[0]), []);
});

console.log('parseBand');
test('밴드 참가신청 텍스트에서 이름·조 추출', () => {
  const players = [{ id: '1', name: '박강호', group: 'A' }, { id: '2', name: '서민희', group: 'C' }];
  const r = L.parseBand('수요민턴\n박강호(랍스터), 서민희(닭갈비), 홍길동(양갈비), 22/22', players);
  assert.deepStrictEqual(r.matched, ['1', '2']);
  assert.deepStrictEqual(r.unknown, [{ name: '홍길동', group: 'B' }]);
});

console.log('seeds / strength');
test('시드 인코딩 왕복', () => {
  const seeds = { A: ['a', 'b', 'c'], B: [], C: ['z'] };
  const enc = L.encodeSeeds(seeds);
  assert.strictEqual(typeof enc, 'string');
  assert(!enc.includes('"a"'), '평문 JSON으로 저장되지 않음');
  assert.deepStrictEqual(L.decodeSeeds(enc), seeds);
  assert.deepStrictEqual(L.decodeSeeds(undefined), {});
  assert.deepStrictEqual(L.decodeSeeds('깨진값'), {});
});
test('parseOrder: 줄·쉼표·번호 섞인 순서 입력', () => {
  const players = [{ id: 'a', name: '유성준', group: 'A' }, { id: 'b', name: '김성곤', group: 'A' }, { id: 'c', name: '조영재', group: 'A' }];
  const r = L.parseOrder('1. 김성곤\n2) 유성준, 홍길동\n김성곤', players);
  assert.deepStrictEqual(r.ids, ['b', 'a']);
  assert.deepStrictEqual(r.unknown, ['홍길동']);
});
function seedState(extra) {
  const st = JSON.parse(JSON.stringify(state));
  st.settings.groups.push({ id: 'C', name: 'C', winners: 1 });
  st.weeks = [];
  st.settings.seeds = L.encodeSeeds({ A: ['a', 'b', 'c', 'd', 'e'] });
  return Object.assign(st, extra || {});
}
test('strengthOf: 시드 1위=1, 꼴찌=0, 시드 없음=0.5', () => {
  const st = seedState();
  assert.strictEqual(L.strengthOf(st, 'a', '2026-10-07', 'A'), 1);
  assert.strictEqual(L.strengthOf(st, 'e', '2026-10-07', 'A'), 0);
  assert.strictEqual(L.strengthOf(st, 'c', '2026-10-07', 'A'), 0.5);
  assert.strictEqual(L.strengthOf(st, 'f', '2026-10-07', 'A'), 0.5);
});
test('strengthOf: 다른 조 풀에 들어가면 상위 조=1, 하위 조=0', () => {
  const st = seedState();
  assert.strictEqual(L.strengthOf(st, 'x', '2026-10-07', 'C'), 1); // B조 선수가 C풀
  assert.strictEqual(L.strengthOf(st, 'x', '2026-10-07', 'A'), 0); // B조 선수가 A풀
});
test('strengthOf: 경기가 쌓일수록 실제 승률 비중 증가', () => {
  const st = seedState();
  // 시드 꼴찌 e가 6전 6승
  st.weeks = [1, 2, 3].map(k => ({ date: '2026-09-0' + k, published: true, attendees: {}, matches: [
    { id: 'w' + k + 'a', pool: 'A', a: ['e', 'f'], b: ['c', 'd'], off: [], win: 'a' },
    { id: 'w' + k + 'b', pool: 'A', a: ['e', 'c'], b: ['f', 'd'], off: [], win: 'a' },
  ] }));
  const s = L.strengthOf(st, 'e', '2026-10-07', 'A');
  assert(s > 0.4 && s < 0.8, '시드 0과 승률 0.875 사이: ' + s);
});
test('시드 반영 편성: 같은 등급이면 팀 실력 합 차이가 작다', () => {
  const ps = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, heat: 1, skill: 1 - i / 7 }));
  const sk = Object.fromEntries(ps.map(p => [p.id, p.skill]));
  for (let seed = 1; seed <= 5; seed++) {
    const ms = L.generatePool(ps, seed).matches;
    ms.forEach(m => {
      const d = Math.abs(sk[m.a[0]] + sk[m.a[1]] - sk[m.b[0]] - sk[m.b[1]]);
      assert(d <= 0.3, '팀 차이 ' + d.toFixed(2));
    });
    assert.strictEqual(partnerRepeats(ms), 0);
  }
});
test('balanceOf: 팀 실력 차이 등급', () => {
  assert.strictEqual(L.balanceOf(1.0, 0.95), 'even');
  assert.strictEqual(L.balanceOf(1.2, 0.9), 'ok');
  assert.strictEqual(L.balanceOf(1.6, 0.6), 'lopsided');
});

// ---------- 돼장 요청: 편성 조건(rules)과 수정 계획(applyPlan) ----------
console.log('rules / applyPlan');
const together = (ms, p, q, where) => ms.filter(m => where === 'team'
  ? [m.a, m.b].some(t => t.includes(p) && t.includes(q))
  : m.a.concat(m.b).includes(p) && m.a.concat(m.b).includes(q)).length;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

for (const n of [8, 10, 12]) {
  test(`${n}명: 같은 팀 금지(no_partner) 조건이면 두 사람은 절대 한 팀이 안 됨`, () => {
    for (const s of SEEDS) {
      const ms = L.generatePool(mkPlayers(n), s, { rules: [{ type: 'no_partner', players: ['p0', 'p1'] }] }).matches;
      assert.strictEqual(together(ms, 'p0', 'p1', 'team'), 0, 'seed ' + s);
      assert.strictEqual(partnerRepeats(ms), 0);
    }
  });
}
test('같은 경기 금지(no_same_game): 두 사람이 한 경기에 같이 안 들어감', () => {
  for (const s of SEEDS) {
    const ms = L.generatePool(mkPlayers(10), s, { rules: [{ type: 'no_same_game', players: ['p2', 'p5'] }] }).matches;
    assert.strictEqual(together(ms, 'p2', 'p5', 'game'), 0, 'seed ' + s);
  }
});
test('같은 팀 희망(want_partner): 두 사람이 한 번은 파트너가 됨', () => {
  for (const s of SEEDS) {
    const ms = L.generatePool(mkPlayers(10), s, { rules: [{ type: 'want_partner', players: ['p3', 'p7'] }] }).matches;
    assert(together(ms, 'p3', 'p7', 'team') >= 1, 'seed ' + s);
    assert.strictEqual(partnerRepeats(ms), 0);
  }
});
test('추가출전 지정(extra_prefer): 홀수 인원이면 지정한 사람이 추가출전', () => {
  for (const s of SEEDS) {
    const ms = L.generatePool(mkPlayers(9), s, { rules: [{ type: 'extra_prefer', players: ['p4'] }] }).matches;
    assert(ms.some(m => m.off.includes('p4')), 'seed ' + s);
  }
});
test('추가출전 제외(extra_avoid): 지정한 사람은 추가출전이 안 됨', () => {
  for (const s of SEEDS) {
    const ms = L.generatePool(mkPlayers(9), s, { rules: [{ type: 'extra_avoid', players: ['p0'] }, { type: 'extra_avoid', players: ['p1'] }] }).matches;
    assert(!ms.some(m => m.off.includes('p0') || m.off.includes('p1')), 'seed ' + s);
    const c = officialCounts(ms);
    Object.keys(c).forEach(pid => assert.strictEqual(c[pid].off, 2));
  }
});
test('조건이 있어도 전원 공식 2경기', () => {
  const rules = [{ type: 'no_partner', players: ['p0', 'p1'] }, { type: 'no_same_game', players: ['p2', 'p3'] }, { type: 'want_partner', players: ['p4', 'p5'] }];
  const ms = L.generatePool(mkPlayers(11), 9, { rules }).matches;
  const c = officialCounts(ms);
  assert.strictEqual(Object.keys(c).length, 11);
  Object.keys(c).forEach(pid => assert.strictEqual(c[pid].off, 2));
});

// applyPlan용 상태: A조 8명, B조 4명, 이번 주(2026-10-21) 편성됨
function planState() {
  const players = [];
  for (let i = 0; i < 8; i++) players.push({ id: 'a' + i, name: 'A선수' + i, group: 'A' });
  for (let i = 0; i < 4; i++) players.push({ id: 'b' + i, name: 'B선수' + i, group: 'B' });
  const attendees = {};
  players.forEach(p => { attendees[p.id] = p.group; });
  const mk = (id, pool, a, b) => ({ id, pool, a, b, off: [], win: null, score: '' });
  return {
    settings: { seasonStart: '2026-10-07', seasonEnd: '2026-12-23', groups: [{ id: 'A', name: 'A', winners: 1 }, { id: 'B', name: 'B', winners: 1 }] },
    players,
    weeks: [{
      date: '2026-10-21', published: false, attendees, matches: [
        mk('m1', 'A', ['a0', 'a1'], ['a2', 'a3']), mk('m2', 'A', ['a4', 'a5'], ['a6', 'a7']),
        mk('m3', 'A', ['a0', 'a2'], ['a4', 'a6']), mk('m4', 'A', ['a1', 'a3'], ['a5', 'a7']),
        mk('m5', 'B', ['b0', 'b1'], ['b2', 'b3']), mk('m6', 'B', ['b0', 'b2'], ['b1', 'b3']),
      ],
    }],
  };
}
let idn = 0;
const OPT = { seed: 7, newId: () => 'n' + (++idn) };

test('applyPlan: 입력 state는 바꾸지 않고 새 주 데이터를 돌려줌', () => {
  const st = planState(), before = JSON.stringify(st);
  const r = L.applyPlan(st, '2026-10-21', { edits: [{ type: 'swap', players: ['a0', 'a4'], matches: ['m1'] }] }, OPT);
  assert.strictEqual(JSON.stringify(st), before);
  assert(r.week && Array.isArray(r.errors));
});
test('applyPlan swap: 지정한 경기 안에서만 두 사람 자리를 바꿈', () => {
  const r = L.applyPlan(planState(), '2026-10-21', { edits: [{ type: 'swap', players: ['a1', 'a2'], matches: ['m1'] }] }, OPT);
  const m1 = r.week.matches.find(m => m.id === 'm1'), m3 = r.week.matches.find(m => m.id === 'm3');
  assert.deepStrictEqual(m1.a, ['a0', 'a2']);
  assert.deepStrictEqual(m1.b, ['a1', 'a3']);
  assert.deepStrictEqual(m3.a, ['a0', 'a2'], '다른 경기는 그대로');
  assert.strictEqual(r.errors.length, 0);
});
test('applyPlan swap: 경기 지정이 없으면 그 주 전체에서 맞바꿈', () => {
  const r = L.applyPlan(planState(), '2026-10-21', { edits: [{ type: 'swap', players: ['a0', 'a7'] }] }, OPT);
  const all = r.week.matches.filter(m => m.pool === 'A');
  assert(all.find(m => m.id === 'm1').a.includes('a7'));
  assert(all.find(m => m.id === 'm2').b.includes('a0'));
});
test('applyPlan set_slot / set_off', () => {
  const r = L.applyPlan(planState(), '2026-10-21', { edits: [
    { type: 'set_slot', match: 'm5', side: 'b', index: 1, player: 'b1' },
    { type: 'set_off', match: 'm6', player: 'b3', off: true },
  ] }, OPT);
  assert.deepStrictEqual(r.week.matches.find(m => m.id === 'm5').b, ['b2', 'b1']);
  assert.deepStrictEqual(r.week.matches.find(m => m.id === 'm6').off, ['b3']);
});
test('applyPlan rules_add: 조건을 주에 저장하고, 지금 편성이 어기면 그 조만 다시 짬', () => {
  const r = L.applyPlan(planState(), '2026-10-21', { rules_add: [{ type: 'no_partner', players: ['a0', 'a1'] }] }, OPT);
  assert.strictEqual(r.week.rules.length, 1);
  assert(r.week.rules[0].id);
  const A = r.week.matches.filter(m => m.pool === 'A');
  assert.strictEqual(together(A, 'a0', 'a1', 'team'), 0);
  assert.deepStrictEqual(r.regenerated, ['A']);
  assert.deepStrictEqual(r.week.matches.filter(m => m.pool === 'B').map(m => m.id), ['m5', 'm6'], 'B조는 그대로');
  assert.strictEqual(L.validateWeek(planState(), r.week).length, 0);
});
test('applyPlan rules_add: 지금 편성이 이미 지키면 다시 짜지 않음', () => {
  const r = L.applyPlan(planState(), '2026-10-21', { rules_add: [{ type: 'no_partner', players: ['a0', 'a7'] }] }, OPT);
  assert.deepStrictEqual(r.regenerated, []);
  assert.deepStrictEqual(r.week.matches.map(m => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
});
test('applyPlan rules_remove: 저장된 조건 삭제', () => {
  const st = planState();
  st.weeks[0].rules = [{ id: 'r1', type: 'no_partner', players: ['a0', 'a7'] }];
  const r = L.applyPlan(st, '2026-10-21', { rules_remove: ['r1'] }, OPT);
  assert.strictEqual(r.week.rules.length, 0);
});
test('applyPlan pool_moves: 편성 조를 옮기면 두 조 모두 다시 짬', () => {
  const r = L.applyPlan(planState(), '2026-10-21', { pool_moves: [{ player: 'a7', pool: 'B' }, { player: 'a6', pool: 'B' }] }, OPT);
  assert.strictEqual(r.week.attendees.a7, 'B');
  assert.deepStrictEqual(r.regenerated.slice().sort(), ['A', 'B']);
  const B = r.week.matches.filter(m => m.pool === 'B');
  assert(B.some(m => m.a.concat(m.b).includes('a7')));
  assert.strictEqual(L.validateWeek(planState(), r.week).filter(x => x.level === 'error').length, 0);
});
test('applyPlan regenerate: 조건을 지키며 지정한 조를 새로 짬 (새 경기 id)', () => {
  const st = planState();
  st.weeks[0].rules = [{ id: 'r1', type: 'no_same_game', players: ['a0', 'a1'] }];
  const r = L.applyPlan(st, '2026-10-21', { regenerate: ['A'] }, OPT);
  const A = r.week.matches.filter(m => m.pool === 'A');
  assert.strictEqual(A.length, 4);
  assert(A.every(m => /^n/.test(m.id)));
  assert.strictEqual(together(A, 'a0', 'a1', 'game'), 0);
});
test('applyPlan: 순서는 조건 → 조 옮기기 → 다시 짜기 → 직접 수정', () => {
  const r = L.applyPlan(planState(), '2026-10-21', {
    rules_add: [{ type: 'no_partner', players: ['b0', 'b1'] }],
    edits: [{ type: 'set_off', match: 'm1', player: 'a0', off: true }],
  }, OPT);
  assert.deepStrictEqual(r.regenerated, ['B']);
  assert.deepStrictEqual(r.week.matches.find(m => m.id === 'm1').off, ['a0']);
});
test('applyPlan: 없는 선수·경기·조건 종류는 건너뛰고 errors에 남김', () => {
  const r = L.applyPlan(planState(), '2026-10-21', {
    rules_add: [{ type: 'no_partner', players: ['a0', 'zz'] }, { type: 'teleport', players: ['a0'] }],
    edits: [{ type: 'swap', players: ['a0', 'a1'], matches: ['m99'] }, { type: 'set_slot', match: 'm1', side: 'c', index: 0, player: 'a1' }],
  }, OPT);
  assert.strictEqual(r.errors.length, 4);
  assert.strictEqual((r.week.rules || []).length, 0);
  assert.deepStrictEqual(r.week.matches.find(m => m.id === 'm1').a, ['a0', 'a1']);
});
test('validateWeek: 저장된 조건을 어기면 rule 경고', () => {
  const st = planState();
  st.weeks[0].rules = [{ id: 'r1', type: 'no_partner', players: ['a0', 'a1'] }, { id: 'r2', type: 'extra_avoid', players: ['b3'] }];
  st.weeks[0].matches.find(m => m.id === 'm6').off = ['b3'];
  const rs = L.validateWeek(st, st.weeks[0]).filter(x => x.code === 'rule');
  assert.strictEqual(rs.length, 2);
  assert(rs[0].msg.includes('A선수0') && rs[0].msg.includes('A선수1'));
});
test('ruleText: 조건을 사람이 읽는 문장으로', () => {
  const st = planState();
  assert.strictEqual(L.ruleText(st, { type: 'no_partner', players: ['a0', 'a1'] }), 'A선수0·A선수1 같은 팀 금지');
  assert.strictEqual(L.ruleText(st, { type: 'extra_prefer', players: ['b2'] }), 'B선수2 추가출전 우선');
});

// ---------- 지옥도는 한 조 위, 천국도는 한 조 아래 (tierShift) / 다른 조 경기에 넣어 둔 사람 (regenPool) ----------
console.log('tierShift / borrowed');
// 지난주(10/14): b0 2승(지옥도), a7 2패(천국도), a0 2승(A조 지옥도: 위 조 없음), b3 1승1패(중립)
function shiftState() {
  const st = planState();
  const mk = (id, pool, a, b, win) => ({ id, pool, a, b, off: [], win, score: '' });
  st.weeks.unshift({ date: '2026-10-14', published: true, attendees: {}, matches: [
    mk('x1', 'A', ['a0', 'a1'], ['a6', 'a7'], 'a'), mk('x2', 'A', ['a0', 'a2'], ['a5', 'a7'], 'a'),
    mk('x3', 'B', ['b0', 'b1'], ['b2', 'b3'], 'a'), mk('x4', 'B', ['b0', 'b3'], ['b1', 'b2'], 'a'),
  ] });
  st.settings.groups.push({ id: 'C', name: 'C', winners: 1 });
  return st;
}
test('tierShift: 지옥도는 한 조 위로, 천국도는 한 조 아래로', () => {
  const moves = L.tierShift(shiftState(), '2026-10-21');
  const by = {}; moves.forEach(m => { by[m.player] = m; });
  assert.deepStrictEqual(by.b0 && [by.b0.from, by.b0.to, by.b0.tier], ['B', 'A', 'hell']);
  assert.deepStrictEqual(by.a7 && [by.a7.from, by.a7.to, by.a7.tier], ['A', 'B', 'heaven']);
  assert(!by.a0, 'A조 지옥도는 위 조가 없어 그대로');
  assert(!by.b3, '중립은 그대로');
});
test('tierShift: 이미 조를 옮긴 사람은 건드리지 않음', () => {
  const st = shiftState();
  st.weeks[1].attendees.b0 = 'B';
  st.weeks[1].attendees.a7 = 'A';
  st.weeks[1].attendees.b0 = 'C'; // 돼장이 직접 옮겨 둠
  const moves = L.tierShift(st, '2026-10-21');
  assert(!moves.some(m => m.player === 'b0'));
  assert(moves.some(m => m.player === 'a7'));
});
test('tierShift: 두 번 눌러도 같은 결과 (옮긴 뒤에는 다시 안 옮김)', () => {
  const st = shiftState();
  L.tierShift(st, '2026-10-21').forEach(m => { st.weeks[1].attendees[m.player] = m.to; });
  assert.strictEqual(L.tierShift(st, '2026-10-21').length, 0);
});
test('tierCandidates: 지옥도·천국도 후보 전부 (이미 옮긴 사람은 moved:true, 위·아래 조 없으면 빠짐)', () => {
  const st = shiftState();
  st.weeks[1].attendees.b0 = 'A'; // 이미 위로 옮김
  const c = L.tierCandidates(st, '2026-10-21');
  const by = {}; c.forEach(x => { by[x.player] = x; });
  assert.deepStrictEqual([by.b0.tier, by.b0.from, by.b0.to, by.b0.moved], ['hell', 'B', 'A', true]);
  assert.deepStrictEqual([by.a7.tier, by.a7.from, by.a7.to, by.a7.moved], ['heaven', 'A', 'B', false]);
  assert(!by.a0, 'A조 지옥도는 위 조가 없어 후보 아님');
  assert(!by.b3, '중립은 후보 아님');
});
test('shiftTarget: 등록 조 기준으로 한 조 위(up)/아래(down)/원래 조(back), 없으면 null', () => {
  const st = shiftState();
  assert.strictEqual(L.shiftTarget(st, 'b0', 'up'), 'A');
  assert.strictEqual(L.shiftTarget(st, 'b0', 'down'), 'C');
  assert.strictEqual(L.shiftTarget(st, 'a0', 'up'), null, '맨 위 조는 위가 없음');
  assert.strictEqual(L.shiftTarget(st, 'a0', 'down'), 'B');
  assert.strictEqual(L.shiftTarget(st, 'b0', 'back'), 'B');
  assert.strictEqual(L.shiftTarget(st, 'zz', 'up'), null);
});
test('tierCandidates: 참석 안 한 사람은 후보 아님', () => {
  const st = shiftState();
  delete st.weeks[1].attendees.b0;
  assert(!L.tierCandidates(st, '2026-10-21').some(x => x.player === 'b0'));
});
test('regenPool: 편성 조는 B인데 공식 경기가 전부 A조에 있는 사람은 A조를 다시 짤 때 함께 짬', () => {
  const st = planState(), w = st.weeks[0];
  // b3를 A조 경기에 직접 넣어 둠 (a7 자리), a7은 참석 안 함
  delete w.attendees.a7;
  w.matches.forEach(m => { m.a = m.a.map(x => x === 'a7' ? 'b3' : x); m.b = m.b.map(x => x === 'a7' ? 'b3' : x); });
  w.matches = w.matches.filter(m => m.pool === 'A'); // B조 경기는 없음 (b3는 A조에서만 뜀)
  const r = L.regenPool(st, w, 'A', 3, () => 'n' + (++idn));
  const A = w.matches.filter(m => m.pool === 'A');
  assert(A.some(m => m.a.concat(m.b).includes('b3')), 'b3가 빠짐');
  assert.strictEqual(w.attendees.b3, 'A', '실제 뛰는 조로 편성 조를 맞춤');
  assert.deepStrictEqual(r.split, []);
});
test('regenPool: 두 조에 나눠 들어간 사람은 split으로 알려 줌', () => {
  const st = planState(), w = st.weeks[0];
  const m1 = w.matches.find(m => m.id === 'm1');
  m1.a = ['a0', 'b0']; // b0: A조 1경기 + B조 2경기
  const r = L.regenPool(st, w, 'A', 3, () => 'n' + (++idn));
  assert.deepStrictEqual(r.split, ['b0']);
});
test('applyPlan pool_moves: 원래 조로 되돌린 사람은 예전 경기 위치와 상관없이 그 조로 짬', () => {
  const st = planState(), w = st.weeks[0];
  // b3를 A조로 올려서 A조 경기에 넣어 둔 상태(편성 조 A) → 다시 B조로 되돌림
  w.attendees.b3 = 'A'; delete w.attendees.a7;
  w.matches.forEach(m => { m.a = m.a.map(x => x === 'a7' ? 'b3' : x); m.b = m.b.map(x => x === 'a7' ? 'b3' : x); });
  w.matches = w.matches.filter(m => m.pool === 'A');
  const r = L.applyPlan(st, '2026-10-21', { pool_moves: [{ player: 'b3', pool: 'B' }] }, OPT);
  assert.strictEqual(r.week.attendees.b3, 'B');
  assert(!r.week.matches.filter(m => m.pool === 'A').some(m => m.a.concat(m.b).includes('b3')));
});
test('applyPlan: 다시 짠 조에 나눠 들어간 사람이 있으면 warnings', () => {
  const st = planState();
  st.weeks[0].matches.find(m => m.id === 'm1').a = ['a0', 'b0'];
  const r = L.applyPlan(st, '2026-10-21', { regenerate: ['A'] }, OPT);
  assert(r.warnings.some(x => x.includes('B선수0')));
});

console.log(`\n${passed} passed`);
