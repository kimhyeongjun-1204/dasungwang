// 뚱뚱배 순수 함수 테스트 (node tourney.test.js) — 구현 전에 작성 (명세 v2 10장, 1차 범위)
const assert = require('assert');
let T;
try { T = require('./tourney.js'); } catch (e) { T = {}; }

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const need = f => { assert.strictEqual(typeof T[f], 'function', f + ' 없음'); return T[f]; };
const key = (x, y) => [x, y].sort().join('|');

// ---- roundRobin: 원형 순환으로 모든 팀 쌍 ----
console.log('roundRobin');
test('4팀 1바퀴 = 6경기, 모든 쌍이 한 번씩', () => {
  const ps = need('roundRobin')(['t1', 't2', 't3', 't4'], 1);
  assert.strictEqual(ps.length, 6);
  assert.strictEqual(new Set(ps.map(p => key(p[0], p[1]))).size, 6);
});
test('5팀(홀수) 1바퀴 = 10경기, 자기 자신과의 경기 없음', () => {
  const ps = need('roundRobin')(['a', 'b', 'c', 'd', 'e'], 1);
  assert.strictEqual(ps.length, 10);
  assert.ok(ps.every(p => p[0] !== p[1] && p[0] && p[1]));
  assert.strictEqual(new Set(ps.map(p => key(p[0], p[1]))).size, 10);
});
test('6팀 2바퀴 = 30경기, 쌍마다 정확히 두 번', () => {
  const ps = need('roundRobin')(['a', 'b', 'c', 'd', 'e', 'f'], 2);
  assert.strictEqual(ps.length, 30);
  const c = {}; ps.forEach(p => { const k = key(p[0], p[1]); c[k] = (c[k] || 0) + 1; });
  assert.ok(Object.values(c).every(v => v === 2));
});
test('팀이 1개 이하면 경기 없음', () => {
  assert.deepStrictEqual(need('roundRobin')(['a'], 1), []);
  assert.deepStrictEqual(need('roundRobin')([], 1), []);
});

// ---- scheduleMatches: 코트·순서 배정 (도착 시각 포함) ----
console.log('scheduleMatches');
// 팀 = 두 사람. 엔트런트 arrive는 시작 기준 분(null이면 시작부터)
function mkGroup(gid, nTeams, courts, prefix) {
  const teams = [], entrants = {};
  for (let i = 0; i < nTeams; i++) {
    const e1 = prefix + i + 'x', e2 = prefix + i + 'y';
    entrants[e1] = { arrive: null }; entrants[e2] = { arrive: null };
    teams.push({ id: prefix + i, group: gid, players: [e1, e2] });
  }
  return { group: { id: gid, courts }, teams, entrants };
}
function mkInput(specs, slotMinutes) {
  const groups = [], teams = [], entrants = {}, matches = [];
  specs.forEach(s => {
    const g = mkGroup(s.id, s.n, s.courts, s.id);
    groups.push(g.group); teams.push(...g.teams); Object.assign(entrants, g.entrants);
    T.roundRobin(g.teams.map(t => t.id), s.laps || 1).forEach((p, i) => matches.push({ id: s.id + 'm' + i, group: s.id, a: p[0], b: p[1] }));
  });
  return { groups, teams, entrants, matches, settings: { slotMinutes: slotMinutes || 15, seed: 7 } };
}
function check(input, out) {
  const teamOf = {}; input.teams.forEach(t => { teamOf[t.id] = t; });
  const gOf = {}; input.groups.forEach(g => { gOf[g.id] = g; });
  const byId = {}; input.matches.forEach(m => { byId[m.id] = m; });
  const placed = out.matches;
  assert.strictEqual(placed.length, input.matches.length, '모든 경기가 한 번씩 배정돼야 함');
  assert.strictEqual(new Set(placed.map(p => p.id)).size, input.matches.length);
  const cell = {}, atSlot = {};
  placed.forEach(p => {
    const m = byId[p.id];
    assert.ok(gOf[m.group].courts.includes(p.court), p.id + ' 가 조 코트가 아닌 ' + p.court + ' 에 배정');
    const ck = p.court + '@' + p.seq;
    assert.ok(!cell[ck], '같은 코트 같은 순서에 두 경기: ' + ck); cell[ck] = 1;
    [m.a, m.b].forEach(tid => teamOf[tid].players.forEach(e => {
      const k = e + '@' + p.seq;
      assert.ok(!atSlot[k], e + ' 가 같은 시간(' + p.seq + ')에 두 코트'); atSlot[k] = 1;
      const arr = input.entrants[e].arrive;
      if (arr != null) assert.ok(p.seq * input.settings.slotMinutes >= arr, e + ' 도착(' + arr + '분) 전 순서 ' + p.seq + ' 에 배정');
    }));
  });
  return placed;
}
test('한 조 5팀·코트 1개: 모든 경기 배정, 겹침 없음, 순서는 0부터 빈칸 없이', () => {
  const input = mkInput([{ id: 'L', n: 5, courts: [1] }]);
  const out = need('scheduleMatches')(input);
  const placed = check(input, out);
  assert.deepStrictEqual(placed.map(p => p.seq).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
test('세 조 · 코트 3개(조마다 1코트): 사람 겹침 없이 각 조 코트에만', () => {
  const input = mkInput([{ id: 'L', n: 4, courts: [1] }, { id: 'S', n: 5, courts: [2] }, { id: 'C', n: 4, courts: [3], laps: 2 }]);
  check(input, need('scheduleMatches')(input));
});
test('한 조가 코트 2개를 쓰면 두 코트에 나눠서, 같은 팀이 같은 시간 두 코트에 없음', () => {
  const input = mkInput([{ id: 'S', n: 6, courts: [2, 3] }]);
  const out = need('scheduleMatches')(input);
  const placed = check(input, out);
  assert.ok(placed.some(p => p.court === 2) && placed.some(p => p.court === 3), '두 코트를 다 써야 함');
});
test('늦게 오는 사람: 그 팀 경기는 도착 뒤 순서에만 (45분 도착 · 15분 경기 → 순서 3 이후)', () => {
  const input = mkInput([{ id: 'L', n: 5, courts: [1] }]);
  input.entrants['L0y'].arrive = 45;
  const out = need('scheduleMatches')(input);
  const placed = check(input, out);
  const t0 = placed.filter(p => { const m = input.matches.find(x => x.id === p.id); return m.a === 'L0' || m.b === 'L0'; });
  assert.ok(t0.every(p => p.seq >= 3), 'L0 경기가 도착 전에 있음: ' + t0.map(p => p.seq));
});
test('같은 팀 3연속 출전 없음 (5팀·코트 1개, 늦는 사람 없음)', () => {
  const input = mkInput([{ id: 'L', n: 5, courts: [1] }]);
  const placed = need('scheduleMatches')(input).matches.slice().sort((a, b) => a.seq - b.seq);
  const teamsAt = placed.map(p => { const m = input.matches.find(x => x.id === p.id); return [m.a, m.b]; });
  for (let i = 2; i < teamsAt.length; i++) {
    const three = teamsAt[i].filter(t => teamsAt[i - 1].includes(t) && teamsAt[i - 2].includes(t));
    assert.deepStrictEqual(three, [], '순서 ' + (i - 2) + '~' + i + ' 3연속: ' + three);
  }
});
test('연속 출전은 경고 목록에 kind: consecutive 로 (팀 id 포함)', () => {
  // 3팀·코트 1개면 3경기 모두 두 팀씩이라 연속 출전을 피할 수 없음
  const input = mkInput([{ id: 'L', n: 3, courts: [1] }]);
  const out = need('scheduleMatches')(input);
  check(input, out);
  assert.ok(Array.isArray(out.warnings), 'warnings 배열 없음');
  const w = out.warnings.filter(x => x.kind === 'consecutive');
  assert.ok(w.length >= 1 && w.every(x => x.team), '연속 출전 경고가 없음');
});
test('같은 입력·같은 seed면 같은 결과 (다시 눌러도 대진이 안 바뀜)', () => {
  const input = mkInput([{ id: 'L', n: 5, courts: [1] }, { id: 'S', n: 4, courts: [2] }]);
  const a = JSON.stringify(need('scheduleMatches')(input).matches);
  const b = JSON.stringify(need('scheduleMatches')(input).matches);
  assert.strictEqual(a, b);
});

// ---- estimateStarts: 'N경기' 번호 대신 예상 시작 시각 ----
console.log('estimateStarts');
test('17:30 시작 · 15분 경기: 순서 0 → 17:30, 순서 3 → 18:15 (KST 기준 ISO)', () => {
  const r = need('estimateStarts')([{ id: 'a', seq: 0 }, { id: 'b', seq: 3 }], { startAt: '2026-12-18T17:30:00+09:00', slotMinutes: 15 });
  assert.strictEqual(new Date(r.a).toISOString(), '2026-12-18T08:30:00.000Z');
  assert.strictEqual(new Date(r.b).toISOString(), '2026-12-18T09:15:00.000Z');
});

// ---- parseRoster: 밴드 참가신청서 명단 → 회원 매칭·게스트·급수 ----
console.log('parseRoster');
const players = [{ id: 'p1', name: '박기욱' }, { id: 'p2', name: '심현철' }, { id: 'p3', name: '조영재' }, { id: 'p9', name: '쉬는사람', active: false }];
test('"박기욱(닭갈비), 심현철, 코치김(게스트)": 회원 2명 매칭, 급수 읽기, 없는 이름은 게스트', () => {
  const r = need('parseRoster')('박기욱(닭갈비), 심현철, 코치김(게스트)', players);
  assert.deepStrictEqual(r.entrants.map(e => [e.name, e.player_id, e.grade]), [['박기욱', 'p1', '닭갈비'], ['심현철', 'p2', null], ['코치김', null, '게스트']]);
});
test('줄바꿈·번호 목록도 읽고, 같은 이름 두 번이면 한 번만 + dup에 표시', () => {
  const r = need('parseRoster')('1. 조영재(캐비어)\n2) 박기욱\n박기욱(닭갈비)', players);
  assert.deepStrictEqual(r.entrants.map(e => e.name), ['조영재', '박기욱']);
  assert.deepStrictEqual(r.dup, ['박기욱']);
  assert.strictEqual(r.entrants[0].grade, '캐비어');
});
test('쉬는 회원(active:false)은 매칭하지 않고 게스트로', () => {
  const r = need('parseRoster')('쉬는사람(소갈비)', players);
  assert.strictEqual(r.entrants[0].player_id, null);
});

// ---- defaultMode: 처음 열 때 [다승왕 | 뚱뚱배] 중 어느 쪽 ----
console.log('defaultMode');
const tours = [{ id: 't1', date: '2026-12-18', status: 'published', published_on: '2026-12-04' }];
test('공개 전날·공개일·대회 날·대회 다음 날·그다음 날 경계', () => {
  const f = need('defaultMode');
  assert.strictEqual(f(tours, '2026-12-03'), 'dsw');
  assert.strictEqual(f(tours, '2026-12-04'), 'tdd');
  assert.strictEqual(f(tours, '2026-12-18'), 'tdd');
  assert.strictEqual(f(tours, '2026-12-19'), 'tdd');
  assert.strictEqual(f(tours, '2026-12-20'), 'dsw');
});
test('초안(draft) 대회만 있으면 다승왕', () => {
  assert.strictEqual(need('defaultMode')([{ id: 't', date: '2026-12-18', status: 'draft', published_on: null }], '2026-12-18'), 'dsw');
});

console.log('\n' + passed + ' passed');
