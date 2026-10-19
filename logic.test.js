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

console.log(`\n${passed} passed`);
