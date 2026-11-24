// 뚱뚱배(급수별 복식 리그 대회) 순수 함수 — 화면·서버와 무관하게 Node에서 테스트 (tourney.test.js)
// 명세: 프로젝트 문서 claude/뚱뚱배_기능명세.md v2 (10장, 1차 범위)
var Tourney = (function () {
  'use strict';

  // 시드가 같으면 같은 난수 (logic.js mulberry32와 같은 식)
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 리그 대진: 원형 순환(circle method). 홀수면 쉬는 자리(null)를 넣고 그 경기는 뺌. 2바퀴째는 좌우를 바꿈
  function roundRobin(teamIds, laps) {
    var ids = (teamIds || []).slice(), out = [];
    if (ids.length < 2) return out;
    if (ids.length % 2) ids.push(null);
    var n = ids.length, rounds = n - 1, half = n / 2;
    for (var lap = 0; lap < (laps || 1); lap++) {
      var arr = ids.slice();
      for (var r = 0; r < rounds; r++) {
        for (var i = 0; i < half; i++) {
          var x = arr[i], y = arr[n - 1 - i];
          if (x === null || y === null) continue;
          out.push(lap % 2 ? [y, x] : [x, y]);
        }
        arr.splice(1, 0, arr.pop()); // 첫 자리는 고정, 나머지를 한 칸씩 돌림
      }
    }
    return out;
  }

  // ---- 코트·순서 배정
  // input: { groups:[{id, courts:[번호]}], teams:[{id, group, players:[엔트런트 id 2개]}], entrants:{id:{arrive: 시작 기준 분|null}},
  //          matches:[{id, group, a, b}], settings:{ slotMinutes, seed } }
  // 순서(seq) k의 예상 시작 = 시작 시각 + k × slotMinutes (코트마다 같은 박자로 돈다고 봄)
  // 지켜야 하는 것: 도착 전 배정 없음, 한 사람이 같은 순서에 두 코트 없음, 조 코트에만
  // 줄이고 싶은 것: 같은 팀 연속 출전(3연속은 매우 크게), 쉬는 간격 차이, 늘어지는 총 길이 → 무작위 탐욕 배치를 여러 번 해서 비용이 가장 작은 안
  var COST = { triple: 100000, consecutive: 1000, idle: 50, rest: 1 };
  function scheduleMatches(input) {
    var st = input.settings || {}, slotMin = st.slotMinutes || 15;
    var teamOf = {}, gCourts = {}, earliest = {};
    (input.teams || []).forEach(function (t) {
      teamOf[t.id] = t;
      var arr = 0;
      (t.players || []).forEach(function (e) {
        var a = input.entrants && input.entrants[e] && input.entrants[e].arrive;
        if (a != null && a > arr) arr = a;
      });
      earliest[t.id] = Math.ceil(arr / slotMin); // 도착 뒤 첫 순서
    });
    (input.groups || []).forEach(function (g) { gCourts[g.id] = (g.courts || []).slice().sort(function (x, y) { return x - y; }); });
    var courts = [];
    Object.keys(gCourts).forEach(function (gid) { gCourts[gid].forEach(function (c) { if (courts.indexOf(c) < 0) courts.push(c); }); });
    courts.sort(function (x, y) { return x - y; });
    var all = (input.matches || []).slice();
    var maxEarliest = 0; Object.keys(earliest).forEach(function (k) { if (earliest[k] > maxEarliest) maxEarliest = earliest[k]; });
    var limit = all.length * 2 + maxEarliest + 10;

    function once(rand) {
      var left = all.slice(), placed = [], last = {}, prev = {}, cost = 0;
      for (var seq = 0; left.length && seq < limit; seq++) {
        var busy = {};
        courts.forEach(function (c) {
          var best = null, bestScore = Infinity;
          left.forEach(function (m, idx) {
            if ((gCourts[m.group] || []).indexOf(c) < 0) return;
            var ts = [m.a, m.b], ok = true, score = 0;
            ts.forEach(function (tid) {
              if (seq < (earliest[tid] || 0)) ok = false;
              (teamOf[tid] ? teamOf[tid].players : []).forEach(function (e) { if (busy[e]) ok = false; });
              if (last[tid] === seq - 1) score += prev[tid] === seq - 2 ? COST.triple : COST.consecutive;
              score -= (last[tid] == null ? seq + 1 : seq - last[tid]) * COST.rest; // 오래 쉰 팀 먼저
            });
            if (!ok) return;
            score += rand() * 0.5;
            if (score < bestScore) { bestScore = score; best = idx; }
          });
          if (best === null) { cost += COST.idle; return; }
          var m = left.splice(best, 1)[0];
          [m.a, m.b].forEach(function (tid) {
            if (last[tid] === seq - 1) cost += prev[tid] === seq - 2 ? COST.triple : COST.consecutive;
            prev[tid] = last[tid]; last[tid] = seq;
            (teamOf[tid] ? teamOf[tid].players : []).forEach(function (e) { busy[e] = 1; });
          });
          placed.push({ id: m.id, court: c, seq: seq });
        });
      }
      var span = 0; placed.forEach(function (p) { if (p.seq + 1 > span) span = p.seq + 1; });
      return { placed: placed, cost: cost + span * 10, left: left };
    }

    var rand = rng(st.seed == null ? 1 : st.seed), best = null;
    for (var k = 0; k < 200; k++) {
      var r = once(rand);
      if (!best || r.left.length < best.left.length || (r.left.length === best.left.length && r.cost < best.cost)) best = r;
    }
    var placed = best.placed.sort(function (x, y) { return x.seq - y.seq || x.court - y.court; });
    // 경고: 같은 팀 연속 출전, 배정하지 못한 경기
    var warnings = [], byTeam = {}, mOf = {};
    all.forEach(function (m) { mOf[m.id] = m; });
    placed.forEach(function (p) { var m = mOf[p.id]; [m.a, m.b].forEach(function (t) { (byTeam[t] = byTeam[t] || []).push(p.seq); }); });
    Object.keys(byTeam).forEach(function (t) {
      var s = byTeam[t].sort(function (x, y) { return x - y; });
      for (var i = 1; i < s.length; i++) if (s[i] === s[i - 1] + 1) warnings.push({ kind: 'consecutive', team: t, seq: s[i] });
    });
    best.left.forEach(function (m) { warnings.push({ kind: 'unplaced', match: m.id }); });
    return { matches: placed, warnings: warnings };
  }

  // ---- 예상 시작 시각 (회원 화면은 'N경기' 대신 이 시각을 보여 줌)
  function estimateStarts(list, opt) {
    var t0 = Date.parse(opt.startAt), min = opt.slotMinutes || 15, out = {};
    (list || []).forEach(function (p) { out[p.id] = new Date(t0 + p.seq * min * 60000).toISOString(); });
    return out;
  }

  // ---- 밴드 참가신청서 명단: "박기욱(닭갈비), 심현철, …" / 줄바꿈·번호 목록
  // 활동 중인 회원과 이름이 같으면 player_id, 아니면 게스트(null). 괄호 안은 급수(grade) 그대로
  function parseRoster(text, players) {
    var byName = {};
    (players || []).forEach(function (p) { if (p.active !== false) byName[p.name] = p.id; });
    var entrants = [], dup = [], seen = {};
    String(text || '').split(/[,\n\r，、]+/).forEach(function (tok) {
      var m = tok.trim().replace(/^\d+[.)]\s*/, '').match(/^([가-힣A-Za-z]{2,10})\s*(?:\(([^)]*)\))?/);
      if (!m) return;
      var name = m[1], grade = (m[2] || '').trim() || null;
      if (seen[name]) { if (dup.indexOf(name) < 0) dup.push(name); return; }
      seen[name] = 1;
      entrants.push({ name: name, grade: grade, player_id: byName[name] || null });
    });
    return { entrants: entrants, dup: dup };
  }

  // ---- 처음 열 때 모드: 공개된 대회의 공개일 ~ 대회 다음 날이면 뚱뚱배('tdd'), 아니면 다승왕('dsw')
  function addDays(d, n) {
    var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  }
  function defaultMode(tournaments, today) {
    var on = (tournaments || []).some(function (t) {
      if (t.status === 'draft' || !t.published_on) return false;
      return t.published_on <= today && today <= addDays(t.date, 1);
    });
    return on ? 'tdd' : 'dsw';
  }

  return { roundRobin: roundRobin, scheduleMatches: scheduleMatches, estimateStarts: estimateStarts, parseRoster: parseRoster, defaultMode: defaultMode, COST: COST };
})();
if (typeof module !== 'undefined') module.exports = Tourney;
