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

test('결과 대기는 그 경기날 17:30(KST) 이후만, 그 전 경기는 upcoming으로 따로 (사용자 요청 2026-11-20)', () => {
  const st = JSON.parse(JSON.stringify(state));
  st.weeks[0].published = true;
  st.weeks.push({ date: '2026-10-14', published: true, attendees: { a: 'A' }, matches: [{ id: 'n1', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: [], win: null }] });
  const at = (iso) => L.standings(st, { now: Date.parse(iso) }).A.find(r => r.name === '조영재');
  // 10/14 17:29 KST: 아직 시작 전 → 결과 대기 아님, 참가 주에도 안 셈
  let a = at('2026-10-14T17:29:00+09:00');
  assert.deepStrictEqual([a.pending, a.upcoming, a.weeks], [0, 1, 1]);
  // 10/14 17:30 KST: 시작 시각이 지나면 결과 대기
  a = at('2026-10-14T17:30:00+09:00');
  assert.deepStrictEqual([a.pending, a.upcoming, a.weeks], [1, 0, 2]);
  // 결과가 들어간 경기는 시각과 상관없이 승패
  st.weeks[1].matches[0].win = 'a';
  a = at('2026-10-13T12:00:00+09:00');
  assert.deepStrictEqual([a.wins, a.pending, a.upcoming], [3, 0, 0]);
  // now를 안 넘기면 예전처럼 미입력 전부 대기 (기존 호출 호환)
  st.weeks[1].matches[0].win = null;
  a = L.standings(st).A.find(r => r.name === '조영재');
  assert.deepStrictEqual([a.pending, a.upcoming], [1, 0]);
});
test('matchStarted: 경기날 17:30 KST 경계', () => {
  assert.strictEqual(L.matchStarted('2026-11-25', Date.parse('2026-11-25T17:29:59+09:00')), false);
  assert.strictEqual(L.matchStarted('2026-11-25', Date.parse('2026-11-25T17:30:00+09:00')), true);
});

console.log('경기 진행(코트)');
// 11/25(수) 저녁. 시작 기준 17:30 KST. 코트는 고정 5·6번 + 그날 여는 '추가 코트'(번호 없음, court 0) (사용자 결정 2026-11-23)
const LT = (hm) => Date.parse('2026-11-25T' + hm + ':00+09:00');
const LISO = (hm) => new Date(LT(hm)).toISOString();
function liveWeek() {
  return { date: '2026-11-25', published: true, attendees: {}, matches: [
    { id: 'k1', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: [], win: null },
    { id: 'k2', pool: 'A', a: ['e', 'f'], b: ['g', 'h'], off: [], win: null },
    { id: 'k3', pool: 'A', a: ['a', 'e'], b: ['i', 'j'], off: [], win: null },
    { id: 'k4', pool: 'B', a: ['x', 'y'], b: ['z', 'w'], off: [], win: null },
    { id: 'k5', pool: 'B', a: ['i', 'j'], b: ['k', 'l'], off: [], win: null },
  ] };
}
const ids = (arr) => arr.map(r => (r.m || r).id);
test('courtSlots / courtLabel: 기본 고정 5·6번, 설정으로 바꿈, 추가 코트는 번호 없이 맨 끝', () => {
  assert.deepStrictEqual(L.courtSlots(null, liveWeek()), [5, 6]);
  assert.deepStrictEqual(L.courtSlots({ courts: [3, 4] }, liveWeek()), [3, 4]);
  assert.deepStrictEqual(L.courtSlots({ courts: [] }, liveWeek()), [5, 6], '비어 있으면 기본');
  const w = liveWeek(); w.extraCourt = true;
  assert.deepStrictEqual(L.courtSlots({ courts: [5, 6] }, w), [5, 6, 0]);
  assert.strictEqual(L.courtLabel(5), '코트 5');
  assert.strictEqual(L.courtLabel(0), '추가 코트');
});
test('liveBoard: 코트 칸은 고정 코트(+추가), 진행 중 선수가 낀 경기는 못 함, 끝난 경기는 완료로', () => {
  const w = liveWeek(); w.extraCourt = true;
  w.matches[0].court = 6; w.matches[0].startedAt = LISO('18:00');        // k1 진행 중 (a,b,c,d)
  w.matches[3].win = 'a'; w.matches[3].endedAt = LISO('18:10');          // k4 완료
  const b = L.liveBoard(w, [], LT('18:20'), { slots: [5, 6, 0] });
  assert.deepStrictEqual(b.courts.map(c => [c.no, c.m && c.m.id]), [[5, null], [6, 'k1'], [0, null]]);
  assert.deepStrictEqual(b.freeCourts, [5, 0]);
  assert.deepStrictEqual(ids(b.done), ['k4']);
  assert.deepStrictEqual(ids(b.ready).sort(), ['k2', 'k5']);
  assert.deepStrictEqual(ids(b.blocked), ['k3']);                            // a가 k1에서 경기 중
  assert.deepStrictEqual(b.blocked[0].why, [{ pid: 'a', kind: 'playing', court: 6 }]);
});
test('liveBoard: 늦음·오늘 못 함·레슨은 풀 때까지, 시간이 있는 예전 레슨 행은 시각이 지나면 풀림', () => {
  const w = liveWeek();
  const av = [
    { player_id: 'e', status: 'away', until: LISO('19:00') },
    { player_id: 'k', status: 'late', until: null },
    { player_id: 'z', status: 'out', until: null },
  ];
  let b = L.liveBoard(w, av, LT('18:40'));
  assert.deepStrictEqual(ids(b.ready), ['k1']);
  assert.deepStrictEqual(b.blocked.map(x => [x.m.id, x.why.map(y => y.pid + ':' + y.kind).join(',')]),
    [['k2', 'e:away'], ['k3', 'e:away'], ['k4', 'z:out'], ['k5', 'k:late']]);
  b = L.liveBoard(w, av, LT('19:00'));
  assert.deepStrictEqual(ids(b.ready).sort(), ['k1', 'k2', 'k3']);
  assert.ok(!b.away.e);
  b = L.liveBoard(w, [{ player_id: 'e', status: 'away', until: null }], LT('23:00'));
  assert.ok(b.away.e, '시간 없는 레슨은 왔어요 전까지 유지');
});
test('liveBoard: 바로 가능한 경기는 오래 기다린 사람 순 (4명 기다린 시간 합), 같으면 편성 순서', () => {
  const w = liveWeek();
  w.matches.push({ id: 'p1', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: [], win: 'a', endedAt: LISO('18:00') });
  w.matches.push({ id: 'p2', pool: 'A', a: ['e', 'f'], b: ['g', 'h'], off: [], win: 'b', endedAt: LISO('18:30') });
  w.matches = w.matches.filter(m => m.id !== 'k3' && m.id !== 'k5');
  const b = L.liveBoard(w, [], LT('19:00'));
  assert.deepStrictEqual(ids(b.ready), ['k4', 'k1', 'k2']);
  assert.deepStrictEqual(b.ready.map(r => r.wait), [360, 240, 120]);
  assert.deepStrictEqual(b.ready.map(r => r.longest), [90, 60, 30]);
  assert.deepStrictEqual(ids(b.done), ['p2', 'p1']);
});
test('startMatch / finishMatch / cancelMatch: 열린 코트에만 넣기·결과·빼기', () => {
  const w = liveWeek(), slots = [5, 6];
  assert.strictEqual(L.startMatch(w, 'k1', 5, LISO('18:00'), slots), true);
  assert.deepStrictEqual([w.matches[0].court, w.matches[0].startedAt], [5, LISO('18:00')]);
  assert.strictEqual(L.startMatch(w, 'k2', 5, LISO('18:01'), slots), false, '이미 찬 코트');
  assert.strictEqual(L.startMatch(w, 'k3', 6, LISO('18:01'), slots), false, 'a가 경기 중');
  assert.strictEqual(L.startMatch(w, 'k2', 1, LISO('18:01'), slots), false, '고정 코트가 아님');
  assert.strictEqual(L.startMatch(w, 'k2', 0, LISO('18:01'), slots), false, '추가 코트를 안 열었음');
  assert.strictEqual(L.startMatch(w, 'k2', 0, LISO('18:01'), [5, 6, 0]), true, '추가 코트');
  assert.strictEqual(L.finishMatch(w, 'k1', 'b', LISO('18:20')), true);
  assert.deepStrictEqual([w.matches[0].win, w.matches[0].court, w.matches[0].endedAt], ['b', null, LISO('18:20')]);
  assert.strictEqual(L.cancelMatch(w, 'k2'), true);
  assert.deepStrictEqual([w.matches[1].court, w.matches[1].startedAt], [null, null]);
  assert.strictEqual(L.finishMatch(w, 'k2', 'a', LISO('18:30')), false, '코트에 없는 경기는 결과 안 넣음');
});
test('setExtraCourt: 추가 코트 열기·닫기, 경기가 있으면 못 닫음', () => {
  const w = liveWeek();
  assert.strictEqual(L.setExtraCourt(w, true), true);
  assert.strictEqual(w.extraCourt, true);
  L.startMatch(w, 'k1', 0, LISO('18:00'), [5, 6, 0]);
  assert.strictEqual(L.setExtraCourt(w, false), false, '추가 코트에 경기 중');
  L.finishMatch(w, 'k1', 'a', LISO('18:10'));
  assert.strictEqual(L.setExtraCourt(w, false), true);
  assert.strictEqual(w.extraCourt, false);
});
test('liveBoard: 결과 표에서 결과를 지우면 다시 남은 경기로', () => {
  const w = liveWeek();
  L.startMatch(w, 'k1', 5, LISO('18:00'), [5, 6]); L.finishMatch(w, 'k1', 'a', LISO('18:20'));
  w.matches[0].win = null;
  const b = L.liveBoard(w, [], LT('18:30'));
  assert.ok(ids(b.ready).includes('k1'));
  assert.ok(!ids(b.done).includes('k1'));
});
test('myLive: 진행 중이면 실제 코트 번호', () => {
  const w = liveWeek();
  L.startMatch(w, 'k4', 6, LISO('18:00'), [5, 6]);
  const b = L.liveBoard(w, [], LT('18:10'));
  assert.deepStrictEqual(L.myLive(b, 'x'), { state: 'playing', match: 'k4', court: 6 });
  assert.deepStrictEqual(L.myLive(b, 'a'), { state: 'next', match: 'k1', rank: 1 });
  assert.deepStrictEqual(L.myLive(L.liveBoard(liveWeek(), [], LT('18:10')), 'q'), { state: 'none' });
});

test('shortNames: 경기·예측 화면은 성 빼고 이름만, 겹치면 성까지 (사용자 요청 2026-11-22)', () => {
  const ps = [{ id: 'a', name: '박지섭' }, { id: 'b', name: '유성준' }, { id: 'c', name: '이성준' }, { id: 'd', name: '김혁' }, { id: 'e', name: '남궁민수' }, { id: 'f', name: ' 조인규 ' }];
  const n = L.shortNames(ps);
  assert.strictEqual(n.a, '지섭');
  assert.strictEqual(n.b, '유성준', '성준이 둘이면 성까지');
  assert.strictEqual(n.c, '이성준');
  assert.strictEqual(n.d, '김혁', '두 글자 이름은 그대로');
  assert.strictEqual(n.e, '궁민수', '네 글자는 첫 글자만 뺌(복성은 구분 안 함)');
  assert.strictEqual(n.f, '인규', '앞뒤 공백 무시');
  assert.deepStrictEqual(L.shortNames([]), {});
});

test('typicalMinutes: 코트에서 끝난 경기들의 걸린 시간 중앙값, 3분 미만·90분 초과는 버림, 3경기 미만이면 null (사용자 요청 2026-11-23)', () => {
  const at = (hm) => '2026-11-25T' + hm + ':00+09:00';
  const mk = (s, e) => ({ win: 'a', startedAt: s && new Date(Date.parse(at(s))).toISOString(), endedAt: e && new Date(Date.parse(at(e))).toISOString() });
  const weeks = [{ date: '2026-11-18', matches: [mk('18:00', '18:12'), mk('18:00', '18:15'), mk(null, '18:20')] },
                 { date: '2026-11-25', matches: [mk('18:00', '18:18'), mk('18:00', '18:40'), mk('18:00', '18:16'), mk('18:00', '18:01'), mk('18:00', '20:00'), { win: null, startedAt: at('18:00') }] }];
  assert.deepStrictEqual(L.typicalMinutes(weeks), { minutes: 16, n: 5 });   // 12,15,18,40,16 → 16 (1분·120분·시작 없음·진행 중은 뺌)
  assert.strictEqual(L.typicalMinutes([{ matches: [mk('18:00', '18:12'), mk('18:00', '18:15')] }]), null, '2경기로는 짐작 안 함');
  assert.strictEqual(L.typicalMinutes([]), null);
});
test('courtEta: 진행 시간과 보통 시간으로 남은 시간 짐작', () => {
  const now = Date.parse('2026-11-25T18:13:00+09:00');
  const m = { startedAt: new Date(Date.parse('2026-11-25T18:00:00+09:00')).toISOString() };
  assert.deepStrictEqual(L.courtEta(m, now, { minutes: 16, n: 5 }), { elapsed: 13, left: 3 });
  assert.deepStrictEqual(L.courtEta(m, now + 5 * 60000, { minutes: 16, n: 5 }), { elapsed: 18, left: 0 }, '보통 시간을 넘으면 0(곧 끝남)');
  assert.deepStrictEqual(L.courtEta(m, now, null), { elapsed: 13, left: null }, '기록이 모자라면 진행 시간만');
  assert.deepStrictEqual(L.courtEta({}, now, { minutes: 16, n: 5 }), { elapsed: null, left: null });
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

// ---------- 돼블스플랜(승부 예측) ----------
const PW = {
  date: '2026-11-18', published: true, attendees: {},
  matches: [
    { id: 'p1', pool: 'A', a: ['a', 'b'], b: ['c', 'd'], off: [], win: null },
    { id: 'p2', pool: 'A', a: ['a', 'e'], b: ['b', 'f'], off: [], win: null },
    { id: 'p3', pool: 'A', a: ['c', 'f'], b: ['e', 'd'], off: [], win: null },
    { id: 'p4', pool: 'B', a: ['x', 'y'], b: ['z', 'w'], off: [], win: null },
    { id: 'p5', pool: 'B', a: ['x', 'z'], b: ['y', 'w'], off: [], win: null },
  ],
};
const pk = (s) => s.split(' ').map(t => ({ match: t.slice(0, 2), side: t.slice(2) })); // 'p1a p2b …'
function decided(results) { // {p1:'a', …} → 결과를 넣은 주 사본
  const w = JSON.parse(JSON.stringify(PW));
  w.matches.forEach(m => { if (results[m.id] !== undefined) m.win = results[m.id]; });
  return w;
}

console.log('돼블스플랜: 마감·검사');
test('predictionDeadline: 그 날 17:30 KST (= 08:30 UTC)', () => {
  assert.strictEqual(L.predictionDeadline('2026-11-18').toISOString(), '2026-11-18T08:30:00.000Z');
  assert.strictEqual(L.predictionDeadline('2026-12-23').toISOString(), '2026-12-23T08:30:00.000Z');
});
test('isPredictionClosed: 17:29:59는 열림, 17:30:00부터 마감', () => {
  assert.strictEqual(L.isPredictionClosed('2026-11-18', Date.parse('2026-11-18T08:29:59Z')), false);
  assert.strictEqual(L.isPredictionClosed('2026-11-18', Date.parse('2026-11-18T08:30:00Z')), true);
});
test('validatePicks: 서로 다른 4경기·a/b면 오류 없음', () => {
  assert.deepStrictEqual(L.validatePicks(pk('p1a p2b p3a p4b'), PW), []);
});
test('validatePicks: 3개·5개·배열 아님은 count', () => {
  assert(L.validatePicks(pk('p1a p2b p3a'), PW).includes('count'));
  assert(L.validatePicks(pk('p1a p2b p3a p4b p5a'), PW).includes('count'));
  assert(L.validatePicks(null, PW).includes('count'));
});
test('validatePicks: 중복 경기·없는 경기·잘못된 side', () => {
  assert(L.validatePicks(pk('p1a p1b p3a p4b'), PW).includes('dup_match'));
  assert(L.validatePicks(pk('p1a p2b p3a p9b'), PW).includes('no_match'));
  assert(L.validatePicks(pk('p1a p2b p3a p4c'), PW).includes('bad_side'));
});

// 세 조가 다 있는 주: A 2경기, B 3경기, C 2경기
const QW = { date: '2026-11-18', published: true, matches: ['qa1:A', 'qa2:A', 'qb1:B', 'qb2:B', 'qb3:B', 'qc1:C', 'qc2:C'].map(t => { const [id, pool] = t.split(':'); return { id, pool, a: ['x1', 'x2'], b: ['x3', 'x4'], off: [], win: null }; }) };
const qk = (s) => s.split(' ').map(t => ({ match: t.slice(0, 3), side: t.slice(3) })); // 'qa1a qb1b …'
test('PREDICT.quota: 캐비어·랍스터(A) 1 · 소갈비·양갈비(B) 2 · 돼지갈비·닭갈비(C) 1, 합 4', () => {
  assert.deepStrictEqual(L.PREDICT.quota, { A: 1, B: 2, C: 1 });
  assert.strictEqual(Object.values(L.PREDICT.quota).reduce((a, b) => a + b, 0), L.PREDICT.picks);
});
test('validatePicks 조별 고정: A1·B2·C1이면 통과, 아니면 quota', () => {
  assert.deepStrictEqual(L.validatePicks(qk('qa1a qb1b qb3a qc2b'), QW), []);
  assert(L.validatePicks(qk('qa1a qa2b qb1a qc1b'), QW).includes('quota'), 'A 2개');
  assert(L.validatePicks(qk('qa1a qb1b qb2a qb3b'), QW).includes('quota'), 'B 3개, C 없음');
  assert(L.validatePicks(qk('qb1a qb2b qc1a qc2b'), QW).includes('quota'), 'A 없음');
});
test('validatePicks 조별 고정: 한 조 경기가 모자라 채울 수 없는 주는 예전처럼 아무 4경기', () => {
  // PW: A 3경기, B 2경기, C 0경기 → C 1경기를 채울 수 없음
  assert.deepStrictEqual(L.validatePicks(pk('p1a p2b p3a p4b'), PW), []);
  assert.deepStrictEqual(L.pickQuota(PW), null);
  assert.deepStrictEqual(L.pickQuota(QW), { A: 1, B: 2, C: 1 });
});
test('quotaStatus: 조별로 몇 개 골랐는지·더 고를 수 있는지', () => {
  const s = L.quotaStatus(qk('qa1a qb1b'), QW);
  assert.deepStrictEqual(s.A, { need: 1, have: 1, full: true });
  assert.deepStrictEqual(s.B, { need: 2, have: 1, full: false });
  assert.deepStrictEqual(s.C, { need: 1, have: 0, full: false });
  assert.strictEqual(L.quotaStatus(qk('qa1a'), PW), null, '고정이 없는 주');
});

console.log('돼블스플랜: 채점');
const HIGH = { mode: 'high', picks: pk('p1a p2b p3a p4b') }, SAFE = { mode: 'safe', picks: pk('p1a p2b p3a p4b') };
test('하이리스크 4경기 모두 적중 → hit +3', () => {
  const r = L.scorePrediction(HIGH, decided({ p1: 'a', p2: 'b', p3: 'a', p4: 'b' }));
  assert.strictEqual(r.status, 'hit'); assert.strictEqual(r.bonus, 3);
  assert.deepStrictEqual(r.picks.map(p => p.result), ['hit', 'hit', 'hit', 'hit']);
});
test('하이리스크 하나 틀림 → miss -2', () => {
  const r = L.scorePrediction(HIGH, decided({ p1: 'a', p2: 'b', p3: 'b', p4: 'b' }));
  assert.strictEqual(r.status, 'miss'); assert.strictEqual(r.bonus, -2);
  assert.strictEqual(r.picks[2].result, 'miss');
});
test('livePrediction: 경기 중 내 예측 상태 (사용자 요청 2026-11-20, 수요일 이번 주 탭)', () => {
  // 2개 맞고 2개 남음 → 진행 중, 다 맞히면 +3
  assert.deepStrictEqual(L.livePrediction(HIGH, decided({ p1: 'a', p2: 'b' })),
    { status: 'pending', hits: 2, misses: 0, left: 2, bonus: 0, ifAllHit: 3 });
  // 하나 틀리면 남은 경기와 상관없이 실패 확정
  assert.deepStrictEqual(L.livePrediction(HIGH, decided({ p1: 'b' })),
    { status: 'miss', hits: 0, misses: 1, left: 3, bonus: -2, ifAllHit: 3 });
  assert.deepStrictEqual(L.livePrediction(SAFE, decided({ p1: 'b' })),
    { status: 'miss', hits: 0, misses: 1, left: 3, bonus: 0, ifAllHit: 1 });
  // 다 맞힘
  assert.deepStrictEqual(L.livePrediction(SAFE, decided({ p1: 'a', p2: 'b', p3: 'a', p4: 'b' })),
    { status: 'hit', hits: 4, misses: 0, left: 0, bonus: 1, ifAllHit: 1 });
  // 예측 없음
  assert.strictEqual(L.livePrediction(null, decided({})), null);
});
test('안전형 적중 +1, 실패 0', () => {
  assert.deepStrictEqual(pick2(L.scorePrediction(SAFE, decided({ p1: 'a', p2: 'b', p3: 'a', p4: 'b' }))), ['hit', 1]);
  assert.deepStrictEqual(pick2(L.scorePrediction(SAFE, decided({ p1: 'b', p2: 'b', p3: 'a', p4: 'b' }))), ['miss', 0]);
});
function pick2(r) { return [r.status, r.bonus]; }
test('결과가 덜 나왔고 틀린 게 없으면 pending, 보너스 0', () => {
  const r = L.scorePrediction(HIGH, decided({ p1: 'a', p2: 'b' }));
  assert.deepStrictEqual(pick2(r), ['pending', 0]);
  assert.deepStrictEqual(r.picks.map(p => p.result), ['hit', 'hit', 'pending', 'pending']);
});
test('대기 중이어도 하나 틀리면 즉시 miss', () => {
  assert.deepStrictEqual(pick2(L.scorePrediction(HIGH, decided({ p1: 'b' }))), ['miss', -2]);
  assert.deepStrictEqual(pick2(L.scorePrediction(SAFE, decided({ p1: 'b' }))), ['miss', 0]);
});
test('고른 경기가 편성에서 사라지면 check, 보너스 0', () => {
  const w = decided({ p1: 'a', p2: 'b', p4: 'b' });
  w.matches = w.matches.filter(m => m.id !== 'p3');
  const r = L.scorePrediction(HIGH, w);
  assert.deepStrictEqual(pick2(r), ['check', 0]);
  assert.strictEqual(r.picks[2].result, 'check');
});
test('사라진 경기가 있으면 다른 경기가 틀려도 check (자동 처리 안 함)', () => {
  const w = decided({ p1: 'b' });
  w.matches = w.matches.filter(m => m.id !== 'p3');
  assert.deepStrictEqual(pick2(L.scorePrediction(HIGH, w)), ['check', 0]);
});
test('선수 자리가 빈 경기(무효)는 check', () => {
  const w = decided({ p1: 'a', p2: 'b', p3: 'a', p4: 'b' });
  w.matches[3].a = ['x', ''];
  assert.deepStrictEqual(pick2(L.scorePrediction(HIGH, w)), ['check', 0]);
});
test('주가 없거나 픽이 4개가 아니면 check', () => {
  assert.strictEqual(L.scorePrediction(HIGH, null).status, 'check');
  assert.strictEqual(L.scorePrediction({ mode: 'high', picks: pk('p1a p2b p3a') }, decided({})).status, 'check');
});

console.log('돼블스플랜: 보너스·순위');
function predState() {
  const st = JSON.parse(JSON.stringify(state));
  st.weeks[0].published = true;
  st.weeks.push(decided({ p1: 'a', p2: 'b', p3: 'a', p4: 'b' }));
  return st;
}
test('bonusByPlayer: 주차별 합계, 공개 안 된 주·없는 주는 0', () => {
  const st = predState();
  st.weeks.push(Object.assign(JSON.parse(JSON.stringify(st.weeks[1])), { date: '2026-11-25', published: false }));
  const preds = [
    { week_date: '2026-11-18', player_id: 'f', mode: 'high', picks: HIGH.picks },            // +3
    { week_date: '2026-11-18', player_id: 'c', mode: 'high', picks: pk('p1b p2b p3a p4b') }, // -2
    { week_date: '2026-11-18', player_id: 'e', mode: 'safe', picks: HIGH.picks },            // +1
    { week_date: '2026-11-25', player_id: 'f', mode: 'high', picks: HIGH.picks },            // 공개 전 → 0
    { week_date: '2026-12-02', player_id: 'f', mode: 'high', picks: HIGH.picks },            // 없는 주 → 0
  ];
  assert.deepStrictEqual(L.bonusByPlayer(st, preds), { f: 3, c: -2, e: 1 });
});
test('predictionRecord: 한 사람의 적중·실패·진행 중 횟수와 보너스 합 (내 기록 표시용, 2026-11-19)', () => {
  const st = predState();
  st.weeks.push(Object.assign(JSON.parse(JSON.stringify(st.weeks[1])), { date: '2026-11-25' }));
  st.weeks[2].matches.forEach(m => { m.win = null; });   // 11/25는 결과 전
  st.weeks.push(Object.assign(JSON.parse(JSON.stringify(st.weeks[1])), { date: '2026-12-02', published: false }));
  const preds = [
    { week_date: '2026-11-18', player_id: 'f', mode: 'high', picks: HIGH.picks },            // 적중 +3
    { week_date: '2026-11-25', player_id: 'f', mode: 'high', picks: HIGH.picks },            // 진행 중
    { week_date: '2026-12-02', player_id: 'f', mode: 'high', picks: HIGH.picks },            // 공개 전 → 안 셈
    { week_date: '2026-11-18', player_id: 'c', mode: 'high', picks: pk('p1b p2b p3a p4b') }, // 실패 -2
  ];
  assert.deepStrictEqual(L.predictionRecord(st, preds, 'f'), { hit: 1, miss: 0, pending: 1, bonus: 3 });
  assert.deepStrictEqual(L.predictionRecord(st, preds, 'c'), { hit: 0, miss: 1, pending: 0, bonus: -2 });
  assert.deepStrictEqual(L.predictionRecord(st, preds, 'zz'), { hit: 0, miss: 0, pending: 0, bonus: 0 });
  assert.strictEqual(L.predictionRecord(st, preds, 'f').bonus, L.bonusByPlayer(st, preds).f, '순위표 보너스와 같은 값');
});
test('standings: 보너스 없으면 기존과 같은 순서·순위', () => {
  const a = L.standings(state).A, b = L.standings(state, { bonus: {} }).A;
  assert.deepStrictEqual(b.map(r => [r.id, r.wins, r.losses, r.rank, r.contender, r.lottery]), a.map(r => [r.id, r.wins, r.losses, r.rank, r.contender, r.lottery]));
  assert(b.every(r => r.bonus === 0 && r.total === r.wins));
});
test('standings: 보너스 합산으로 순위, 공식 승은 그대로', () => {
  // 공식: 조영재 2, 김성곤 1, 박지섭 1, 유성준 0, 최신웅 0, 주성모 0
  const s = L.standings(state, { bonus: { f: 3, a: -1 } }).A;
  const f = s.find(r => r.name === '유성준'), a = s.find(r => r.name === '조영재');
  assert.strictEqual(s[0].name, '유성준');
  assert.deepStrictEqual([f.wins, f.bonus, f.total, f.rank], [0, 3, 3, 1]);
  assert.deepStrictEqual([a.wins, a.bonus, a.total], [2, -1, 1]);
  assert(f.contender && !a.contender, '다승왕권도 합계 기준');
});
test('standings: 합계 동률은 같은 순위, 패 적은 쪽이 위 (기존 동률 규칙)', () => {
  // 조영재 2승 0패, 김성곤 1승 1패 +1 → 둘 다 2
  const s = L.standings(state, { bonus: { b: 1 } }).A;
  const a = s.find(r => r.name === '조영재'), b = s.find(r => r.name === '김성곤');
  assert.strictEqual(a.rank, b.rank);
  assert(s.indexOf(a) < s.indexOf(b), '패가 적은 조영재가 위');
  assert(a.lottery && b.lottery, '다승왕 1명 자리에 합계 동률 2명 → 추첨');
});
test('지옥도·천국도는 보너스와 무관 (공식 경기 결과만)', () => {
  const st = predState();
  const before = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => L.tierOf(st, id, '2026-11-25').tier);
  L.standings(st, { bonus: { d: 3, a: -1 } });
  const after = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => L.tierOf(st, id, '2026-11-25').tier);
  assert.deepStrictEqual(after, before);
});

console.log('돼블스플랜: 인기 픽·배지·장 마감 리포트');
const C = (s) => s.split(' ').map(t => { const [k, mode, n] = t.split(':'); return { match_id: k.slice(0, 2), side: k.slice(2), mode, n: +n }; });
const COUNTS = C('p1a:high:5 p1a:safe:4 p1b:high:3 p2a:safe:2 p2b:high:2 p3a:high:0 p9a:high:7');
test('popularPicks: 팀별 인원 순위, 경기 안 비율, 0명·없는 경기 제외', () => {
  const r = L.popularPicks(COUNTS, PW);
  assert.deepStrictEqual(r.map(x => [x.match, x.side, x.n, x.total, x.rank]), [['p1', 'a', 9, 12, 1], ['p1', 'b', 3, 12, 2], ['p2', 'a', 2, 4, 3], ['p2', 'b', 2, 4, 3]]);
  assert.strictEqual(r[0].share, 0.75);
});
test('popularPicks: 방식 필터', () => {
  const r = L.popularPicks(COUNTS, PW, 'high');
  assert.deepStrictEqual(r.map(x => [x.match + x.side, x.n, x.total]), [['p1a', 5, 8], ['p1b', 3, 8], ['p2b', 2, 2]]);
});
test('pickChanges: 최근 1시간 이벤트의 증감 합 (방식 필터)', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');
  const ev = [
    { match_id: 'p1', side: 'a', mode: 'high', delta: 1, at: '2026-11-18T09:30:00Z' },
    { match_id: 'p1', side: 'a', mode: 'safe', delta: 1, at: '2026-11-18T09:40:00Z' },
    { match_id: 'p1', side: 'b', mode: 'high', delta: -1, at: '2026-11-18T09:50:00Z' },
    { match_id: 'p2', side: 'a', mode: 'high', delta: 1, at: '2026-11-18T08:59:59Z' }, // 1시간 넘음
  ];
  assert.deepStrictEqual(L.pickChanges(ev, now), { p1a: 2, p1b: -1 });
  assert.deepStrictEqual(L.pickChanges(ev, now, 'high'), { p1a: 1, p1b: -1 });
});
test('playerPicks: 선수가 들어간 팀을 고른 수를 합친 순위 (동률은 같은 순위, id 순)', () => {
  // a = p1a 9 + p2a 2, b = p1a 9 + p2b 2, c·d = p1b 3, e = p2a 2, f = p2b 2
  const r = L.playerPicks(COUNTS, PW);
  assert.deepStrictEqual(r.map(x => [x.player, x.n, x.rank]), [['a', 11, 1], ['b', 11, 1], ['c', 3, 3], ['d', 3, 3], ['e', 2, 5], ['f', 2, 5]]);
});
test('playerPicks: 최근 증감(pickChanges 결과)을 선수별로 합침, 고른 경기만 넘기면 그 경기들만', () => {
  const r = L.playerPicks(COUNTS, PW, { p1a: 2, p1b: -1 });
  assert.deepStrictEqual(r.map(x => [x.player, x.change]), [['a', 2], ['b', 2], ['c', -1], ['d', -1], ['e', 0], ['f', 0]]);
  const only2 = L.playerPicks(COUNTS, { matches: PW.matches.filter(m => m.id === 'p2') });
  assert.deepStrictEqual(only2.map(x => [x.player, x.n, x.rank]), [['a', 2, 1], ['b', 2, 1], ['e', 2, 1], ['f', 2, 1]]);
  assert.deepStrictEqual(L.playerPicks([], PW), []);
});
test('playerPicks: 선택 비율 = 그 선수 경기를 고른 수 중 그 선수 팀을 고른 수 (상대 팀만 고른 경기도 분모에 포함)', () => {
  const r = L.playerPicks(COUNTS, PW);
  const get = id => r.find(x => x.player === id);
  // a: p1(12명) + p2(4명) 중 11 / c: p1(12명) + p3(0명) 중 3 / e: p2(4명) + p3(0명) 중 2
  assert.deepStrictEqual([get('a').total, get('a').share], [16, 11 / 16]);
  assert.deepStrictEqual([get('c').total, get('c').share], [12, 0.25]);
  assert.deepStrictEqual([get('e').total, get('e').share], [4, 0.5]);
});
test('matchBoard: 경기별 양 팀 인원·비율(분모는 그 경기를 고른 인원), 0명 경기도 오류 없이 포함', () => {
  const r = L.matchBoard(COUNTS, PW);
  assert.deepStrictEqual(r.map(x => [x.match, x.pool, x.total, x.a.n, x.b.n]), [['p1', 'A', 12, 9, 3], ['p2', 'A', 4, 2, 2], ['p3', 'A', 0, 0, 0], ['p4', 'B', 0, 0, 0], ['p5', 'B', 0, 0, 0]]);
  assert.deepStrictEqual([r[0].a.share, r[0].b.share], [0.75, 0.25]);
  assert.deepStrictEqual([r[2].a.share, r[2].b.share, r[2].a.badge, r[2].b.badge], [0, 0, '', '']);
  assert.deepStrictEqual(L.matchBoard([], PW).map(x => x.total), [0, 0, 0, 0, 0]);
});
test('matchBoard 배지: 70% 초과 인기 픽(hot), 30% 미만 역배 후보(under), 고른 사람이 5명 미만이면 배지 없음', () => {
  const b = (s, id) => { const m = L.matchBoard(C(s), PW).find(x => x.match === (id || 'p1')); return [m.a.badge, m.b.badge]; };
  assert.deepStrictEqual(b('p1a:high:5 p1a:safe:4 p1b:high:3'), ['hot', 'under']);        // 75 : 25
  assert.deepStrictEqual(b('p1a:high:7 p1b:high:3'), ['', '']);                            // 정확히 70 : 30은 일반
  assert.deepStrictEqual(b('p1a:high:71 p1b:high:29'), ['hot', 'under']);
  assert.deepStrictEqual(b('p1a:high:6'), ['hot', 'under']);                               // 한쪽 100%
  assert.deepStrictEqual(b('p1a:high:4'), ['', '']);                                       // 4명뿐 → 배지 없음
  assert.deepStrictEqual(b('p1a:high:3 p1b:high:1'), ['', '']);
  assert.deepStrictEqual(b('p1a:high:3 p1b:safe:3'), ['', '']);                            // 50 : 50
});
test('superMatches: 조마다 예측 인원이 가장 많은 경기 (양 팀·두 방식 합산), 다른 조와는 비교하지 않음', () => {
  // A조: p1 12명, p2 4명 / B조: p4 3명, p5 1명 → B조 1위(3명)는 A조 2위(4명)보다 적어도 슈퍼매치
  const s = L.superMatches(C('p1a:high:5 p1a:safe:4 p1b:high:3 p2a:safe:2 p2b:high:2 p4a:high:2 p4b:safe:1 p5a:high:1'), PW);
  assert.deepStrictEqual(s, { p1: 12, p4: 3 });
});
test('superMatches: 공동 1위는 모두, 예측이 없는 조는 없음, 0명·없는 경기는 무시', () => {
  assert.deepStrictEqual(L.superMatches(C('p4a:high:2 p5b:safe:2 p1a:high:1'), PW), { p1: 1, p4: 2, p5: 2 });
  assert.deepStrictEqual(L.superMatches(C('p1a:high:5 p3a:high:0 p9a:high:7'), PW), { p1: 5 });
  assert.deepStrictEqual(L.superMatches([], PW), {});
});
test('superMatches: 마감 스냅숏(prediction_close 모양, mode 없음)으로도 같은 결과', () => {
  const close = [{ match_id: 'p1', side: 'a', n: 9, total: 12 }, { match_id: 'p1', side: 'b', n: 3, total: 12 }, { match_id: 'p2', side: 'a', n: 4, total: 4 }, { match_id: 'p5', side: 'b', n: 2, total: 2 }];
  assert.deepStrictEqual(L.superMatches(close, PW), { p1: 12, p5: 2 });
  assert.deepStrictEqual(L.matchBoard(close, PW)[0].a.share, 0.75);
});
test('pickBadges: 상한가는 경기 안 70% 이상, 인기 선수(sneaky)는 가장 많이 걸린 선수 1명', () => {
  // p1: a 9 / b 3 → 75% 상한가. p2: 2/2 → 50%
  const b = L.pickBadges(COUNTS, PW);
  assert.deepStrictEqual(b.upper, { p1a: 1 });
  // 걸린 횟수: a = p1a 9 + p2a 2 = 11, b = p1a 9 + p2b 2 = 11, c,d = 3, e = 2, f = 2 → 동률이면 id 순으로 a
  assert.strictEqual(b.sneaky, 'a');
  assert.strictEqual(L.pickBadges(C('p1a:high:7 p1b:high:3'), PW).upper.p1a, 1, '정확히 70%도 상한가');
  assert.deepStrictEqual(L.pickBadges(C('p1a:high:69 p1b:high:31'), PW).upper, {}, '69%는 아님');
  assert.deepStrictEqual(L.pickBadges([], PW), { upper: {}, sneaky: null });
});
test('closeFromPredictions: 두 방식 합산 마감 비율 (prediction_close 모양)', () => {
  const preds = [
    { player_id: 'f', mode: 'high', picks: pk('p1a p2b p3a p4b') },
    { player_id: 'c', mode: 'safe', picks: pk('p1a p2a p3a p5a') },
    { player_id: 'e', mode: 'high', picks: pk('p1b p2b p3b p4b') },
  ];
  const r = L.closeFromPredictions(preds);
  const get = k => r.find(x => x.match_id + x.side === k);
  assert.deepStrictEqual([get('p1a').n, get('p1a').total], [2, 3]);
  assert.deepStrictEqual([get('p5a').n, get('p5a').total], [1, 1]);
  assert.strictEqual(get('p5b'), undefined, '0명인 쪽은 행 없음');
});
const REPORT_PREDS = [
  { player_id: 'f', mode: 'high', picks: pk('p1a p2b p3a p4b') }, // 적중 +3
  { player_id: 'c', mode: 'safe', picks: pk('p1a p2b p3a p4b') }, // 적중 +1
  { player_id: 'e', mode: 'high', picks: pk('p1a p2a p3a p4b') }, // 실패 -1
  { player_id: 'd', mode: 'safe', picks: pk('p1b p2a p3b p5a') }, // 실패 0
];
const ALL_DONE = { p1: 'a', p2: 'b', p3: 'a', p4: 'b', p5: 'b' };
test('closingReport: 결과가 다 안 나오면 ready false', () => {
  assert.strictEqual(L.closingReport(decided({ p1: 'a' }), [], REPORT_PREDS).ready, false);
});
test('closingReport: 상한가·폭락주·역배 적중·수익·적중자', () => {
  const close = [
    { match_id: 'p1', side: 'a', n: 9, total: 12 }, { match_id: 'p1', side: 'b', n: 3, total: 12 },
    { match_id: 'p2', side: 'a', n: 8, total: 10 }, { match_id: 'p2', side: 'b', n: 2, total: 10 },
    { match_id: 'p3', side: 'a', n: 4, total: 4 },
  ];
  const r = L.closingReport(decided(ALL_DONE), close, REPORT_PREDS);
  assert.strictEqual(r.ready, true);
  assert.deepStrictEqual([r.participants, r.hits, r.misses], [4, 2, 2]);
  assert.deepStrictEqual([r.upper.match, r.upper.side, r.upper.n, r.upper.share], ['p1', 'a', 9, 0.75]); // 최다 픽 중 승
  assert.deepStrictEqual([r.crash.match, r.crash.side, r.crash.n], ['p2', 'a', 8]);                    // 최다 픽 중 패
  assert.deepStrictEqual([r.contrarian.match, r.contrarian.side, r.contrarian.n, r.contrarian.share], ['p2', 'b', 2, 0.2]); // 소수 픽 승
  assert.deepStrictEqual(r.profit, { total: 4, high: 1, safe: 1 });
  assert.deepStrictEqual(r.hitters.map(h => [h.player, h.bonus]), [['f', 3], ['c', 1]]);
});
test('closingReport: 마감 스냅숏이 있으면 그 비율을 씀 (마감 후 수정과 무관)', () => {
  const close = [{ match_id: 'p4', side: 'b', n: 1, total: 4 }, { match_id: 'p4', side: 'a', n: 3, total: 4 }];
  const r = L.closingReport(decided(ALL_DONE), close, REPORT_PREDS);
  assert.deepStrictEqual([r.contrarian.match, r.contrarian.side, r.contrarian.share], ['p4', 'b', 0.25]);
});
test('closingReport: 스냅숏이 없으면 예측으로 계산, 소수 픽 승이 없으면 역배 null', () => {
  const r = L.closingReport(decided(ALL_DONE), [], REPORT_PREDS.slice(0, 2));
  assert.strictEqual(r.contrarian, null);
  assert.strictEqual(r.crash, null);
  assert.deepStrictEqual([r.upper.match, r.upper.n, r.upper.share], ['p1', 2, 1]);
});

// 내 기록 승수 표시: 총합 = 공식 승 + 돼블스플랜 보너스 (2026-11-19, 적중했는데 내 기록 승수가 그대로라 반영 안 된 것처럼 보이던 문제)
const recOf = r => { const x = L.meRecord(r); return [x.has, x.total, x.wins, x.losses, x.bonus]; };
test('meRecord: 보너스가 없으면 총합 = 공식 승', () => {
  assert.deepStrictEqual(recOf({ wins: 2, losses: 0, bonus: 0 }), [true, 2, 2, 0, 0]);
});
test('meRecord: 보너스 +3이면 총합 5', () => {
  assert.deepStrictEqual(recOf({ wins: 2, losses: 0, bonus: 3 }), [true, 5, 2, 0, 3]);
});
test('meRecord: 하이리스크 실패 -2로 총합이 음수여도 그대로', () => {
  assert.deepStrictEqual(recOf({ wins: 1, losses: 1, bonus: -2 }), [true, -1, 1, 1, -2]);
});
test('meRecord: 공식 경기 없이 예측 보너스만 있어도 기록 있음', () => {
  assert.deepStrictEqual(recOf({ wins: 0, losses: 0, bonus: 1 }), [true, 1, 0, 0, 1]);
});
test('meRecord: 행이 없거나 아무 기록도 없으면 has=false', () => {
  assert.deepStrictEqual(recOf(null), [false, 0, 0, 0, 0]);
  assert.strictEqual(L.meRecord({ wins: 0, losses: 0 }).has, false);
});

// ---- 클럽 홈 (2026-11-24): 다승왕전 카드에 들어갈 요약 ----
test('homeSummary: 시즌 전·중·후 상태, 끝난 주 수, 다음 경기날', () => {
  assert.strictEqual(typeof L.homeSummary, 'function', 'homeSummary 없음');
  const st = { settings: { seasonStart: '2026-10-07', seasonEnd: '2026-10-28', skipDates: [] }, players: [{ id: 'p1', name: 'A', group: 'A' }],
    weeks: [{ date: '2026-10-07', attendees: {}, matches: [{ id: 'm1', pool: 'A', a: ['p1', 'p1'], b: ['x', 'y'], win: 'a' }] },
            { date: '2026-10-14', attendees: {}, matches: [{ id: 'm2', pool: 'A', a: ['p1', 'p1'], b: ['x', 'y'], win: null }] }] };
  const pre = L.homeSummary(st, '2026-10-01', null);
  assert.strictEqual(pre.status, 'upcoming'); assert.strictEqual(pre.next, '2026-10-07'); assert.strictEqual(pre.total, 4);
  const mid = L.homeSummary(st, '2026-10-10', 'p1');
  assert.strictEqual(mid.status, 'live'); assert.strictEqual(mid.done, 1, '결과가 다 들어간 주만 끝난 주'); assert.strictEqual(mid.next, '2026-10-14');
  assert.ok(['hell', 'heaven', 'mid'].includes(mid.myTier), '내 이름을 고르면 다음 주 배정(지옥도·천국도)');
  assert.strictEqual(L.homeSummary(st, '2026-10-10', null).myTier, null);
  const today = L.homeSummary(st, '2026-10-14', null);
  assert.strictEqual(today.next, '2026-10-14', '경기 당일은 오늘이 다음 경기날');
  const post = L.homeSummary(st, '2026-10-29', null);
  assert.strictEqual(post.status, 'ended'); assert.strictEqual(post.next, null);
});

// ---- 앱을 열 때 첫 화면 (2026-11-25): 다승왕전 경기날이면 바로 '이번 주', 아니면 마지막에 보던 탭(처음이면 홈) ----
test('startTab: 앱을 열면 늘 홈 (2026-11-27, 경기날 다승왕으로 열던 것 바뀜), 관리 화면에서 새로 고침만 그대로', () => {
  const ds = ['2026-11-18', '2026-11-25'];
  assert.strictEqual(L.startTab('week', '2026-11-25', ds), 'home', '경기날에도 홈');
  assert.strictEqual(L.startTab(null, '2026-11-25', ds), 'home');
  assert.strictEqual(L.startTab('records', '2026-11-26', ds), 'home', '보던 탭이 아니라 홈');
  assert.strictEqual(L.startTab(null, '2026-11-26', ds), 'home');
  assert.strictEqual(L.startTab('admin', '2026-11-25', ds), 'admin', '관리 화면에서 새로 고침하면 그대로');
});

// ---- 클럽 홈 밴드 정보 (2026-11-25): 진행 중 공지·행사·참가신청서 (club.js, 밴드 원문 링크) ----
let CL = {};
try { CL = require('./club.js'); } catch (e) { }
const needC = f => { assert.strictEqual(typeof CL[f], 'function', 'club.js ' + f + ' 없음'); return CL[f]; };
test('activeNotices: 오늘 기준 끝난 공지는 빼고, 기한 없는 공지(규칙)는 늘 포함', () => {
  const list = [{ title: 'a', until: '2026-11-26' }, { title: 'b', until: '2026-11-24' }, { title: 'c', until: null }, { title: 'd', from: '2026-12-01', until: '2026-12-05' }];
  assert.deepStrictEqual(needC('activeNotices')('2026-11-25', list).map(n => n.title), ['a', 'c']);
  assert.deepStrictEqual(CL.activeNotices('2026-11-26', list).map(n => n.title), ['a', 'c'], '마지막 날까지는 보임');
  assert.deepStrictEqual(CL.activeNotices('2026-12-01', list).map(n => n.title), ['c', 'd'], '시작 전 공지는 안 보임');
});
test('currentSignup: 오늘이 들어 있거나 다음에 오는 밴드 참가신청서 주간', () => {
  const s = [{ from: '2026-11-23', to: '2026-11-26', post: 1 }, { from: '2026-11-30', to: '2026-12-04', post: 2 }];
  assert.strictEqual(needC('currentSignup')('2026-11-25', s).post, 1);
  assert.strictEqual(CL.currentSignup('2026-11-27', s).post, 2, '이번 주가 끝나면 다음 주');
  assert.strictEqual(CL.currentSignup('2026-12-05', s), null);
});
test('upcoming: 다승왕전 날짜와 행사를 날짜순으로 합쳐 오늘부터 n개', () => {
  const ev = [{ name: '청백전', date: '2026-11-29' }, { name: '뚠뚠배', date: '2026-12-18' }];
  const r = needC('upcoming')('2026-11-25', ['2026-11-18', '2026-11-25', '2026-12-02'], ev, 4);
  assert.deepStrictEqual(r.map(x => x.date + ' ' + x.kind), ['2026-11-25 dsw', '2026-11-29 event', '2026-12-02 dsw', '2026-12-18 event']);
});
test('club.js 데이터: 진행 중 공지마다 밴드 글 번호, 2025년 비상연락망 같은 지난 공지 없음', () => {
  assert.ok(Array.isArray(CL.NOTICES) && CL.NOTICES.length >= 4, '공지 데이터 없음');
  CL.NOTICES.forEach(n => { assert.ok(n.post > 0 && n.kind && n.title, '공지 항목 모양: ' + JSON.stringify(n)); });
  assert.ok(CL.activeNotices('2026-11-25', CL.NOTICES).every(n => !/2025|비상연락망/.test(n.title)));
  assert.ok(/^https:\/\/band\.us\/band\/\d+$/.test(CL.BAND), '밴드 주소');
  const cb = CL.EVENTS.filter(e => e.short === '청백전')[0];
  assert.ok(cb && cb.date === '2026-11-27' && new Date(cb.date + 'T00:00:00Z').getUTCDay() === 5 && !cb.noDow, '청백전은 11/27(금) (사용자 확인 2026-11-25)');
});

// ---- 회원 로그인·회원 관리 (2026-11-26): 조 → 이름 → 비밀번호, 급수 → 조 자동, 조 변경은 바로 ----
test('급수 → 처음 추천 조(새 회원 추가 때만): 캐비어·랍스터 A, 소갈비·양갈비 B, 돼지갈비·닭갈비 C', () => {
  assert.deepStrictEqual(L.GRADES, ['캐비어', '랍스터', '소갈비', '양갈비', '돼지갈비', '닭갈비']);
  assert.deepStrictEqual(L.GRADES.map(L.gradeGroup), ['A', 'A', 'B', 'B', 'C', 'C']);
  assert.strictEqual(L.gradeGroup('없음'), null);
});
test('loginGroups: 조마다 활동 회원만 가나다순, 쉬는 회원은 빠짐', () => {
  const ps = [{ id: 'p1', name: '최', group: 'A' }, { id: 'p2', name: '가', group: 'A' }, { id: 'p3', name: '나', group: 'B' }, { id: 'p4', name: '다', group: 'C', active: false }];
  const r = L.loginGroups(ps, [{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
  assert.deepStrictEqual(r.map(g => g.id + ':' + g.members.map(m => m.name).join(',')), ['A:가,최', 'B:나', 'C:']);
});
// 2026-11-27 김형준: 급수(회원 등급)와 조(다승왕·대회에서 뛰는 조)는 따로. 급수가 랍스터여도 소갈비·양갈비조에서 뛸 수 있음
test('memberEdit: 새 회원은 이름 + 급수 + 조(안 고르면 급수로 추천한 조), 이름 겹치면 안 됨', () => {
  const w = { players: [{ id: 'p1', name: '김가가', group: 'A' }, { id: 'p9', name: '박쉬는', group: 'B', active: false }] };
  assert.deepStrictEqual(L.memberEdit(w, { name: '  ', grade: '소갈비', group: 'B' }).errors, ['이름을 적어 주세요.']);
  assert.deepStrictEqual(L.memberEdit(w, { name: '김가가', grade: '소갈비', group: 'B' }).errors, ['같은 이름이 이미 있어요.']);
  assert.deepStrictEqual(L.memberEdit(w, { name: '새사람', grade: '없는급수', group: 'B' }).errors, ['급수를 골라 주세요.']);
  assert.deepStrictEqual(L.memberEdit(w, { name: '새사람', grade: '양갈비', group: 'D' }).errors, ['조를 골라 주세요.']);
  assert.deepStrictEqual(L.memberEdit(w, { name: ' 새사람 ', grade: '랍스터', group: 'B' }, 'pNEW').errors, []);
  assert.deepStrictEqual(w.players[2], { id: 'pNEW', name: '새사람', group: 'B', grade: '랍스터' }, '랍스터인데 B조로 뛸 수 있음');
  L.memberEdit(w, { name: '또사람', grade: '닭갈비' }, 'pN2');
  assert.strictEqual(w.players[3].group, 'C', '조를 안 주면 급수로 추천한 조');
});
test('memberEdit: 급수를 바꿔도 조는 그대로, 조는 따로 바꾸면 바로, 쉬는 회원·다시 활동', () => {
  const w = { players: [{ id: 'p1', name: '김가가', group: 'A' }, { id: 'p2', name: '이나나', group: 'B', grade: '소갈비' }] };
  assert.deepStrictEqual(L.memberEdit(w, { id: 'p2', name: '이나나', grade: '랍스터' }).errors, []);
  assert.deepStrictEqual(w.players[1], { id: 'p2', name: '이나나', group: 'B', grade: '랍스터' }, '급수만 바뀌고 조는 B 그대로');
  assert.deepStrictEqual(L.memberEdit(w, { id: 'p2', group: 'A' }).errors, []);
  assert.strictEqual(w.players[1].group, 'A', '조는 고른 대로 바로');
  assert.deepStrictEqual(L.memberEdit(w, { id: 'p2', group: 'X' }).errors, ['조를 골라 주세요.']);
  assert.deepStrictEqual(L.memberEdit(w, { id: 'p2', name: '김가가', grade: '랍스터' }).errors, ['같은 이름이 이미 있어요.']);
  assert.deepStrictEqual(L.memberEdit(w, { id: 'p1', active: false }).errors, []);
  assert.strictEqual(w.players[0].active, false);
  assert.deepStrictEqual(L.memberEdit(w, { id: 'p1', active: true }).errors, []);
  assert.ok(!('active' in w.players[0]), '다시 활동하면 active 표시를 지움');
  assert.deepStrictEqual(L.memberEdit(w, { id: 'nope', grade: '캐비어' }).errors, ['없는 회원이에요.']);
});
test('pinInput: 4자리 숫자만, 두 번 입력이 같아야 함', () => {
  assert.strictEqual(L.pinError('12a4'), '숫자 4자리로 적어 주세요.');
  assert.strictEqual(L.pinError('123'), '숫자 4자리로 적어 주세요.');
  assert.strictEqual(L.pinError('1234'), null);
  assert.strictEqual(L.pinError('1234', '1235'), '두 번 적은 비밀번호가 달라요.');
  assert.strictEqual(L.pinError('1234', '1234'), null);
});
test('club.js 청백전: 다른 회원이 만든 실시간 점수판 링크 (김형준 요청 2026-11-27)', () => {
  const cb = CL.EVENTS.filter(e => e.short === '청백전')[0];
  assert.strictEqual(cb.live, 'https://chang333787-boop.github.io/cheongbaek-2026/');
  assert.ok(CL.EVENTS.filter(e => e.live).every(e => /^https:\/\//.test(e.live)), '링크는 https만');
});

test('club.js heroEvent: 행사 당일이고 따로 페이지(live)가 있으면 그날만 홈 맨 위 큰 카드 (2026-11-27 청백전)', () => {
  assert.strictEqual(CL.heroEvent('2026-11-27').short, '청백전');
  assert.strictEqual(CL.heroEvent('2026-11-26'), null, '전날은 아님');
  assert.strictEqual(CL.heroEvent('2026-11-28'), null, '다음 날은 아님');
  assert.strictEqual(CL.heroEvent('2026-12-18'), null, 'live 없는 뚠뚠배는 아님');
});

// ---- 운동 참가 신청 (2026-11-26) ----
test('signupWeeks: 이번 주·다음 주 월~금 (주말에 열면 다음 주가 "이번 주")', () => {
  assert.deepStrictEqual(L.signupWeeks('2026-11-26'), [{ from: '2026-11-23', to: '2026-11-27', label: '이번 주' }, { from: '2026-11-30', to: '2026-12-04', label: '다음 주' }]);
  assert.deepStrictEqual(L.signupWeeks('2026-11-29').map(w => w.from), ['2026-11-30', '2026-12-07']);
  assert.deepStrictEqual(L.signupWeeks('2026-11-28').map(w => w.from), ['2026-11-30', '2026-12-07']);
});
test('signupDay: 신청 완료·대기 수, 남은 자리, 내 상태(본인·내 게스트)', () => {
  const row = { day: '2026-11-30', cap: 2, open: true, closed: false, entries: [
    { id: 1, player_id: 'a', host_id: 'a', status: 'in', no: 1, pos: 1 }, { id: 2, guest: '손님', host_id: 'b', status: 'in', no: 2, pos: 2 },
    { id: 3, player_id: 'b', host_id: 'b', status: 'wait', no: 1, pos: 3 }] };
  const b = L.signupDay(row, 'b');
  assert.deepStrictEqual([b.inCount, b.waitCount, b.left, b.full], [2, 1, 0, true]);
  assert.deepStrictEqual(b.mine, { id: 3, status: 'wait', no: 1, ahead: 0 });
  assert.deepStrictEqual(b.guests.map(g => g.guest + ':' + g.status), ['손님:in']);
  const c = L.signupDay(row, 'c');
  assert.strictEqual(c.mine, null);
  assert.deepStrictEqual(L.signupDay(Object.assign({}, row, { cap: 5 }), 'a').left, 3);
});

test('bandTime: 신청 일시를 밴드처럼 "2026년 11월 26일 오후 2:38" (KST)', () => {
  assert.strictEqual(L.bandTime('2026-11-26T05:38:12.5+00:00'), '2026년 11월 26일 오후 2:38');
  assert.strictEqual(L.bandTime('2026-11-23T01:30:00Z'), '2026년 11월 23일 오전 10:30');
  assert.strictEqual(L.bandTime('2026-11-22T15:05:00Z'), '2026년 11월 23일 오전 12:05');
  assert.strictEqual(L.bandTime('2026-11-23T03:00:00Z'), '2026년 11월 23일 오후 12:00');
  assert.strictEqual(L.bandTime(null), '');
});

console.log(`\n${passed} passed`);
