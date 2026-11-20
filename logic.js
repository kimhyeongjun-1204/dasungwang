var Logic = (function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function wednesdays(startIso, endIso) {
    var out = [];
    var d = new Date(startIso + 'T00:00:00Z');
    var e = new Date(endIso + 'T00:00:00Z');
    while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
    while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
    return out;
  }

  // 시즌 수요일 중 진행하지 않은 날(skipDates) 제외
  function seasonDays(settings) {
    var skip = settings.skipDates || [];
    return wednesdays(settings.seasonStart, settings.seasonEnd).filter(function (d) { return skip.indexOf(d) < 0; });
  }

  function isOfficial(m, pid) { return !(m.off && m.off.indexOf(pid) >= 0); }
  function playersOf(m) { return m.a.concat(m.b).filter(Boolean); }

  // pid -> {games(공식), wins, losses, pending, extra(기록 제외 출전), apps}
  function weekTally(week) {
    var t = {};
    (week.matches || []).forEach(function (m) {
      ['a', 'b'].forEach(function (side) {
        m[side].forEach(function (pid) {
          if (!pid) return;
          var r = t[pid] || (t[pid] = { games: 0, wins: 0, losses: 0, pending: 0, extra: 0, apps: 0 });
          r.apps++;
          if (!isOfficial(m, pid)) { r.extra++; return; }
          r.games++;
          if (!m.win) r.pending++;
          else if (m.win === side) r.wins++;
          else r.losses++;
        });
      });
    });
    return t;
  }

  function playerMap(state) {
    var map = {};
    state.players.forEach(function (p) { map[p.id] = p; });
    return map;
  }

  // 조별 순위. countBy: 'registered'(현재 등록 조) | 'pool'(경기한 조)
  // opts.bonus: {pid: 돼블스플랜 보너스} → 원소속 조 행에 bonus·total(공식 승 + 보너스)을 넣고 total로 순위
  // opts.now(ms): 결과 없는 경기 중 그 날 17:30 KST 전은 upcoming(참가 주에도 안 셈), 지난 건 pending(결과 대기). now 없으면 전부 pending
  function standings(state, opts) {
    var useBonus = !!(opts && opts.bonus);
    var now = opts && opts.now != null ? opts.now : null;
    var bonus = useBonus ? opts.bonus : {};
    var pm = playerMap(state);
    var mode = state.settings.countBy || 'registered';
    var rows = {};
    state.settings.groups.forEach(function (g) { rows[g.id] = {}; });
    function row(gid, pid) {
      if (!rows[gid]) rows[gid] = {};
      var p = pm[pid];
      return rows[gid][pid] || (rows[gid][pid] = { id: pid, name: p ? p.name : '(삭제된 선수)', wins: 0, losses: 0, pending: 0, upcoming: 0, weeks: 0 });
    }
    state.players.forEach(function (p) { if (p.active !== false) row(p.group, p.id); });
    state.weeks.forEach(function (w) {
      var seen = {};
      (w.matches || []).forEach(function (m) {
        ['a', 'b'].forEach(function (side) {
          m[side].forEach(function (pid) {
            if (!pid || !isOfficial(m, pid)) return;
            if (!m.win && w.published === false) return; // 공개 전 편성은 집계 제외
            var gid = mode === 'pool' ? m.pool : (pm[pid] ? pm[pid].group : m.pool);
            var r = row(gid, pid);
            if (!m.win && now != null && !matchStarted(w.date, now)) { r.upcoming++; return; } // 앞으로 할 경기
            if (!seen[gid + pid]) { seen[gid + pid] = 1; r.weeks++; }
            if (!m.win) r.pending++;
            else if (m.win === side) r.wins++;
            else r.losses++;
          });
        });
      });
    });
    if (useBonus) Object.keys(bonus).forEach(function (pid) { if (pm[pid] && bonus[pid]) row(pm[pid].group, pid); });
    // 순위 기준 승수: 보너스가 있으면 합계, 없으면 공식 승 (기존과 같음)
    var W = function (r) { return useBonus ? r.total : r.wins; };
    var out = {};
    Object.keys(rows).forEach(function (gid) {
      var g = state.settings.groups.filter(function (x) { return x.id === gid; })[0];
      var winners = g ? g.winners : 1;
      var list = Object.keys(rows[gid]).map(function (k) { return rows[gid][k]; });
      if (useBonus) list.forEach(function (r) { r.bonus = pm[r.id] && pm[r.id].group === gid ? bonus[r.id] || 0 : 0; r.total = r.wins + r.bonus; });
      list.sort(function (x, y) {
        return W(y) - W(x) || x.losses - y.losses || x.name.localeCompare(y.name, 'ko');
      });
      list.forEach(function (r, i) {
        r.rank = i > 0 && W(list[i - 1]) === W(r) ? list[i - 1].rank : i + 1;
      });
      var cutoff = list[winners - 1];
      list.forEach(function (r) {
        r.contender = !!cutoff && W(cutoff) > 0 && W(r) >= W(cutoff);
        r.lottery = false;
      });
      if (cutoff && W(cutoff) > 0) {
        var tied = list.filter(function (r) { return W(r) === W(cutoff); });
        var above = list.filter(function (r) { return W(r) > W(cutoff); }).length;
        if (above + tied.length > winners) tied.forEach(function (r) { r.lottery = true; });
      }
      out[gid] = list;
    });
    return out;
  }

  // 직전 참가 주 성적 → 지옥도(전승)/천국도(전패)/중립/미정
  function tierOf(state, pid, beforeDate) {
    var weeks = state.weeks.filter(function (w) { return w.date < beforeDate; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    for (var i = 0; i < weeks.length; i++) {
      var t = weekTally(weeks[i])[pid];
      if (!t || t.games === 0) continue;
      var decided = t.wins + t.losses;
      if (decided === 0) return { tier: 'unknown', date: weeks[i].date, wins: 0, losses: 0 };
      var tier = t.wins === decided ? 'hell' : t.wins === 0 ? 'heaven' : 'mid';
      return { tier: tier, date: weeks[i].date, wins: t.wins, losses: t.losses };
    }
    return { tier: 'new' };
  }
  var HEAT = { hell: 2, mid: 1, unknown: 1, new: 1, heaven: 0 };

  // 시즌 누적 승률(편성 균형용, 0~1, 표본 적으면 0.5 쪽으로)
  function skillOf(state, pid, beforeDate) {
    var w = 0, l = 0;
    state.weeks.forEach(function (wk) {
      if (wk.date >= beforeDate) return;
      var t = weekTally(wk)[pid];
      if (t) { w += t.wins; l += t.losses; }
    });
    return (w + 1) / (w + l + 2);
  }

  var PAIRINGS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];
  function pkey(x, y) { return x < y ? x + '|' + y : y + '|' + x; }

  // 편성 조건(돼장 요청): 2인 조건과 1인 조건
  var RULE_ARITY = { no_partner: 2, want_partner: 2, no_same_game: 2, extra_prefer: 1, extra_avoid: 1 };
  var RULE_COST = 2000;
  function compileRules(rules, byId) {
    var R = { noPartner: {}, noGame: {}, want: [], prefer: {}, avoid: {} };
    (rules || []).forEach(function (r) {
      var ps = r && r.players || [];
      if (RULE_ARITY[r.type] !== ps.length || ps.some(function (p) { return !byId[p]; })) return;
      if (r.type === 'no_partner') R.noPartner[pkey(ps[0], ps[1])] = 1;
      else if (r.type === 'no_same_game') R.noGame[pkey(ps[0], ps[1])] = 1;
      else if (r.type === 'want_partner') R.want.push(pkey(ps[0], ps[1]));
      else if (r.type === 'extra_prefer') R.prefer[ps[0]] = 1;
      else if (r.type === 'extra_avoid') R.avoid[ps[0]] = 1;
    });
    return R;
  }

  function evaluate(games, byId, R) {
    R = R || compileRules([], byId);
    var partner = {}, opp = {}, cost = 0, pairs = [];
    for (var g = 0; g < games.length; g++) {
      var gm = games[g];
      if (gm[0] === gm[1] || gm[0] === gm[2] || gm[0] === gm[3] || gm[1] === gm[2] || gm[1] === gm[3] || gm[2] === gm[3]) {
        cost += 1e6; pairs.push(null); continue;
      }
      var hs = gm.map(function (id) { return byId[id].heat; });
      cost += (Math.max.apply(null, hs) - Math.min.apply(null, hs)) * 30;
      for (var u = 0; u < 4; u++) for (var v = u + 1; v < 4; v++) if (R.noGame[pkey(gm[u], gm[v])]) cost += RULE_COST;
      var best = null, bc = Infinity;
      for (var p = 0; p < 3; p++) {
        var P = PAIRINGS[p];
        var A = [gm[P[0]], gm[P[1]]], B = [gm[P[2]], gm[P[3]]];
        var c = 0;
        if (partner[pkey(A[0], A[1])]) c += 1000;
        if (partner[pkey(B[0], B[1])]) c += 1000;
        if (R.noPartner[pkey(A[0], A[1])] || R.noPartner[pkey(B[0], B[1])]) c += RULE_COST;
        // 같은 팀 희망인 두 사람이 이 경기에 같이 있는데 아직 파트너가 아니면 갈라놓는 쪽에 벌점
        for (var w = 0; w < R.want.length; w++) {
          var wk = R.want[w];
          if (partner[wk]) continue;
          var inA = pkey(A[0], A[1]) === wk, inB = pkey(B[0], B[1]) === wk;
          var both = wk.split('|').every(function (id) { return gm.indexOf(id) >= 0; });
          if (both && !inA && !inB) c += RULE_COST * 0.75;
        }
        var sa = byId[A[0]].skill + byId[A[1]].skill, sb = byId[B[0]].skill + byId[B[1]].skill;
        c += Math.abs(sa - sb) * 40;
        for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) if (opp[pkey(A[i], B[j])]) c += 8;
        if (c < bc) { bc = c; best = [A, B]; }
      }
      cost += bc;
      partner[pkey(best[0][0], best[0][1])] = 1;
      partner[pkey(best[1][0], best[1][1])] = 1;
      for (var x = 0; x < 2; x++) for (var y = 0; y < 2; y++) opp[pkey(best[0][x], best[1][y])] = 1;
      pairs.push(best);
    }
    R.want.forEach(function (wk) { if (!partner[wk]) cost += RULE_COST; });
    return { cost: cost, pairs: pairs };
  }

  // 연속 출전이 적도록 경기 순서 정하기
  function orderGames(pairs) {
    var left = pairs.slice(), out = [];
    var prev = [];
    while (left.length) {
      var bi = 0, bs = Infinity;
      for (var i = 0; i < left.length; i++) {
        var ps = left[i][0].concat(left[i][1]);
        var s = ps.filter(function (p) { return prev.indexOf(p) >= 0; }).length;
        if (s < bs) { bs = s; bi = i; }
      }
      var g = left.splice(bi, 1)[0];
      out.push(g);
      prev = g[0].concat(g[1]);
    }
    return out;
  }

  // players: [{id, heat(0~2), skill(0~1)}], opts.rules: 편성 조건 → {matches:[{a,b,off}]} 또는 {error}
  function generatePool(players, seed, opts) {
    opts = opts || {};
    var n = players.length;
    if (n < 4) return { error: '4명 이상이어야 편성할 수 있어요 (현재 ' + n + '명)' };
    var rng = mulberry32(seed >>> 0);
    var G = Math.ceil(n / 2);
    var extraCount = 4 * G - 2 * n;
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    var R = compileRules(opts.rules, byId);
    var restarts = opts.restarts || 12, iters = opts.iters || (300 + G * 100);
    var best = null;
    for (var r = 0; r < restarts; r++) {
      var slots = [];
      players.forEach(function (p) { slots.push(p.id, p.id); });
      var ids = shuffle(players.map(function (p) { return p.id; }), rng);
      // 추가출전(3번 출전)은 시작할 때 정해지고 자리 바꾸기로는 안 바뀜: 우선 지정 → 보통 → 제외 순으로 고름
      ids = ids.filter(function (id) { return R.prefer[id]; })
        .concat(ids.filter(function (id) { return !R.prefer[id] && !R.avoid[id]; }), ids.filter(function (id) { return R.avoid[id] && !R.prefer[id]; }));
      for (var k = 0; k < extraCount; k++) slots.push(ids[k]);
      shuffle(slots, rng);
      var games = [];
      for (var g = 0; g < G; g++) games.push(slots.slice(g * 4, g * 4 + 4));
      var cur = evaluate(games, byId, R).cost;
      for (var it = 0; it < iters && cur > 0; it++) {
        var g1 = Math.floor(rng() * G), g2 = Math.floor(rng() * G);
        if (g1 === g2) continue;
        var i1 = Math.floor(rng() * 4), i2 = Math.floor(rng() * 4);
        var t = games[g1][i1]; games[g1][i1] = games[g2][i2]; games[g2][i2] = t;
        var c = evaluate(games, byId, R).cost;
        if (c <= cur) cur = c;
        else { t = games[g1][i1]; games[g1][i1] = games[g2][i2]; games[g2][i2] = t; }
      }
      if (!best || cur < best.cost) best = { cost: cur, games: games.map(function (x) { return x.slice(); }) };
    }
    var ev = evaluate(best.games, byId, R);
    if (ev.pairs.indexOf(null) >= 0) return { error: '편성에 실패했어요. 다시 시도해 주세요' };
    var ordered = orderGames(ev.pairs);
    var count = {};
    var matches = ordered.map(function (pr) {
      var m = { a: pr[0].slice(), b: pr[1].slice(), off: [] };
      m.a.concat(m.b).forEach(function (pid) {
        count[pid] = (count[pid] || 0) + 1;
        if (count[pid] > 2) m.off.push(pid);
      });
      return m;
    });
    return { matches: matches, cost: best.cost };
  }

  function validateWeek(state, week) {
    var pm = playerMap(state);
    var name = function (id) { return pm[id] ? pm[id].name : id; };
    var issues = [];
    var partners = {};
    (week.matches || []).forEach(function (m, i) {
      var label = (i + 1) + '경기';
      var ps = m.a.concat(m.b);
      if (ps.filter(Boolean).length < 4) issues.push({ level: 'error', code: 'incomplete', match: m.id, msg: label + ': 선수 4명이 다 채워지지 않았어요' });
      var f = ps.filter(Boolean);
      if (new Set(f).size < f.length) issues.push({ level: 'error', code: 'dup_in_match', match: m.id, msg: label + ': 같은 선수가 두 번 들어가 있어요' });
      [m.a, m.b].forEach(function (t) {
        if (!t[0] || !t[1] || t[0] === t[1]) return;
        var k = pkey(t[0], t[1]);
        if (partners[k]) issues.push({ level: 'warn', code: 'partner_repeat', match: m.id, msg: name(t[0]) + '·' + name(t[1]) + ' 파트너가 ' + partners[k] + '와 ' + label + '에서 겹쳐요' });
        else partners[k] = label;
      });
    });
    var tally = weekTally(week);
    var att = week.attendees || {};
    Object.keys(att).forEach(function (pid) {
      var g = tally[pid] ? tally[pid].games : 0;
      if (g !== 2) issues.push({ level: 'warn', code: 'official_count', pid: pid, msg: name(pid) + ': 공식 ' + g + '경기 (2경기여야 해요)' });
    });
    Object.keys(tally).forEach(function (pid) {
      if (!att[pid]) issues.push({ level: 'warn', code: 'not_attending', pid: pid, msg: name(pid) + ': 참석 체크가 안 된 채 경기에 들어가 있어요' });
    });
    (week.rules || []).forEach(function (r) {
      var why = ruleViolation(week, r);
      if (why) issues.push({ level: 'warn', code: 'rule', rule: r.id, msg: ruleText(state, r) + ': ' + why });
    });
    return issues;
  }

  var RULE_LABEL = { no_partner: '같은 팀 금지', want_partner: '같은 팀 희망', no_same_game: '같은 경기 금지', extra_prefer: '추가출전 우선', extra_avoid: '추가출전 제외' };
  function ruleText(state, r) {
    var pm = playerMap(state);
    return (r.players || []).map(function (id) { return pm[id] ? pm[id].name : id; }).join('·') + ' ' + (RULE_LABEL[r.type] || r.type);
  }
  // 이 주 편성이 조건을 어기면 이유, 지키면 null (matches: 볼 경기, 기본은 그 주 전체)
  function ruleViolation(week, r, matches) {
    var ms = matches || week.matches || [], ps = r.players || [], p = ps[0], q = ps[1];
    var label = function (m) { return ((week.matches || []).indexOf(m) + 1) + '경기'; };
    var hit;
    if (r.type === 'no_partner') {
      hit = ms.filter(function (m) { return [m.a, m.b].some(function (t) { return t.indexOf(p) >= 0 && t.indexOf(q) >= 0; }); })[0];
      return hit ? label(hit) + '에서 한 팀이에요' : null;
    }
    if (r.type === 'no_same_game') {
      hit = ms.filter(function (m) { var all = m.a.concat(m.b); return all.indexOf(p) >= 0 && all.indexOf(q) >= 0; })[0];
      return hit ? label(hit) + '에 같이 들어가 있어요' : null;
    }
    var inAny = function (id) { return ms.some(function (m) { return m.a.concat(m.b).indexOf(id) >= 0; }); };
    if (r.type === 'want_partner') {
      if (!inAny(p) || !inAny(q)) return null;
      return ms.some(function (m) { return [m.a, m.b].some(function (t) { return t.indexOf(p) >= 0 && t.indexOf(q) >= 0; }); }) ? null : '한 번도 같은 팀이 아니에요';
    }
    var isOff = function (id) { return ms.some(function (m) { return (m.off || []).indexOf(id) >= 0; }); };
    if (r.type === 'extra_avoid') return isOff(p) ? '추가출전으로 들어가 있어요' : null;
    if (r.type === 'extra_prefer') {
      var pool = (week.attendees || {})[p];
      if (!inAny(p) || isOff(p)) return null;
      var others = ms.some(function (m) { return m.pool === pool && (m.off || []).some(function (id) { return id !== p; }); });
      return others ? '다른 사람이 추가출전이에요' : null;
    }
    return null;
  }

  // 지옥도는 한 조 위, 천국도는 한 조 아래에서 경기 (조 순서: settings.groups 앞이 강한 조)
  // → [{player, from, to, tier}]. 편성 조가 등록 조와 같은 참석자만 (돼장이 직접 옮긴 사람은 그대로)
  function tierShift(state, date) {
    var week = state.weeks.filter(function (w) { return w.date === date; })[0];
    return tierCandidates(state, date).filter(function (c) { return week.attendees[c.player] === c.from; })
      .map(function (c) { return { player: c.player, from: c.from, to: c.to, tier: c.tier }; });
  }
  // 등록 조 기준으로 옮길 조: up(한 조 위) / down(한 조 아래) / back(원래 조). 없으면 null
  function shiftTarget(state, pid, dir) {
    var p = playerMap(state)[pid];
    if (!p) return null;
    var order = state.settings.groups.map(function (g) { return g.id; }), i = order.indexOf(p.group);
    if (i < 0) return null;
    return (dir === 'up' ? order[i - 1] : dir === 'down' ? order[i + 1] : dir === 'back' ? p.group : null) || null;
  }
  // 이번 주 참석자 중 옮길 수 있는 지옥도·천국도 후보 전부 → [{player, from(등록 조), to, tier, moved(지금 to에서 뜀)}]
  function tierCandidates(state, date) {
    var week = state.weeks.filter(function (w) { return w.date === date; })[0];
    if (!week) return [];
    var pm = playerMap(state), order = state.settings.groups.map(function (g) { return g.id; }), out = [];
    Object.keys(week.attendees || {}).forEach(function (id) {
      var p = pm[id];
      if (!p) return;
      var t = tierOf(state, id, date).tier, i = order.indexOf(p.group);
      var to = t === 'hell' ? order[i - 1] : t === 'heaven' ? order[i + 1] : null;
      if (i >= 0 && to) out.push({ player: id, from: p.group, to: to, tier: t, moved: week.attendees[id] === to });
    });
    return out;
  }

  // 공식 경기가 들어가 있는 조들 (pid → {조: 1})
  function officialPools(week) {
    var r = {};
    (week.matches || []).forEach(function (m) {
      m.a.concat(m.b).forEach(function (id) { if (id && isOfficial(m, id)) (r[id] = r[id] || {})[m.pool] = 1; });
    });
    return r;
  }

  // 한 조를 (저장된 조건까지 지켜서) 다시 짜서 week.matches에 반영. week는 직접 바뀜
  // 편성 조를 따로 옮긴 적 없는(편성 조 = 등록 조) 사람이 공식 경기를 전부 다른 조에서 하면 실제로 뛰는 조 사람으로 봄
  // (돼장이 경기 칸에 직접 넣은 경우). fixed: 이번에 조를 옮긴 사람 {id:1} — 편성 조를 그대로 믿음
  // → {count, split:[두 조에 나눠 들어가 있어 경기 수가 어긋날 사람]} 또는 {error}
  function regenPool(state, week, gid, seed, newId, fixed) {
    var pm = playerMap(state), op = officialPools(week);
    var poolOf = function (id) {
      var ps = Object.keys(op[id] || {});
      if ((fixed && fixed[id]) || week.attendees[id] !== pm[id].group || ps.length !== 1) return week.attendees[id];
      return ps[0];
    };
    var split = Object.keys(op).filter(function (id) { return op[id][gid] && Object.keys(op[id]).length > 1; });
    var ids = Object.keys(week.attendees || {}).filter(function (id) { return pm[id] && poolOf(id) === gid && split.indexOf(id) < 0; })
      .concat(Object.keys(week.attendees || {}).filter(function (id) { return pm[id] && split.indexOf(id) >= 0 && week.attendees[id] === gid; }));
    ids.forEach(function (id) { week.attendees[id] = gid; });
    var order = state.settings.groups.map(function (g) { return g.id; });
    var keep = (week.matches || []).filter(function (m) { return m.pool !== gid; });
    var fresh = [];
    if (ids.length) {
      var ps = ids.map(function (id) { return { id: id, heat: HEAT[tierOf(state, id, week.date).tier], skill: strengthOf(state, id, week.date, gid) }; });
      var rules = (week.rules || []).filter(function (r) { return (r.players || []).every(function (id) { return ids.indexOf(id) >= 0; }); });
      var res = generatePool(ps, seed, { rules: rules });
      if (res.error) return { error: res.error };
      fresh = res.matches.map(function (m) { return { id: newId(), pool: gid, a: m.a, b: m.b, off: m.off, win: null, score: '' }; });
    }
    var all = keep.concat(fresh).map(function (m, i) { return { m: m, i: i }; });
    all.sort(function (x, y) {
      var ox = order.indexOf(x.m.pool), oy = order.indexOf(y.m.pool);
      return (ox < 0 ? 99 : ox) - (oy < 0 ? 99 : oy) || x.i - y.i;
    });
    week.matches = all.map(function (x) { return x.m; });
    return { count: fresh.length, split: split };
  }

  // 돼장 요청을 해석한 계획을 적용: 조건 삭제·추가 → 조 옮기기 → 다시 짜기 → 직접 수정
  // plan: {rules_add:[{type,players}], rules_remove:[id], pool_moves:[{player,pool}], regenerate:[gid],
  //        edits:[{type:'swap',players:[p,q],matches?:[id]} | {type:'set_slot',match,side,index,player} | {type:'set_off',match,player,off}]}
  // → {week(새 객체), regenerated:[gid], errors:[문장], warnings:[문장]}  (state는 바꾸지 않음)
  function applyPlan(state, date, plan, opt) {
    opt = opt || {};
    plan = plan || {};
    var st = JSON.parse(JSON.stringify(state));
    var week = st.weeks.filter(function (w) { return w.date === date; })[0];
    if (!week) { week = { date: date, published: false, attendees: {}, matches: [] }; st.weeks.push(week); }
    week.attendees = week.attendees || {};
    week.matches = week.matches || [];
    week.rules = week.rules || [];
    var pm = playerMap(st), errors = [], warnings = [], touched = {}, moved = {};
    var gids = st.settings.groups.map(function (g) { return g.id; });
    var newId = opt.newId || function () { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
    var seed = opt.seed == null ? (Math.random() * 4294967296) >>> 0 : opt.seed;
    var nm = function (id) { return pm[id] ? pm[id].name : String(id); };
    var findM = function (id) { return week.matches.filter(function (m) { return m.id === id; })[0]; };

    (plan.rules_remove || []).forEach(function (id) {
      if (!week.rules.some(function (r) { return r.id === id; })) { errors.push('없는 조건이라 지우지 못했어요: ' + id); return; }
      week.rules = week.rules.filter(function (r) { return r.id !== id; });
    });
    (plan.rules_add || []).forEach(function (r) {
      var type = r && r.type, ps = (r && r.players) || [];
      if (!RULE_ARITY[type]) { errors.push('알 수 없는 조건 종류예요: ' + type); return; }
      var bad = ps.filter(function (p) { return !pm[p]; });
      if (ps.length !== RULE_ARITY[type] || bad.length || (ps.length === 2 && ps[0] === ps[1])) {
        errors.push('조건에 맞지 않는 선수예요: ' + (bad.length ? bad.join(', ') : ps.map(nm).join('·'))); return;
      }
      var rule = { id: 'r' + newId(), type: type, players: ps.slice() };
      week.rules.push(rule);
      // 지금 편성이 새 조건을 어기는 조만 다시 짬
      gids.forEach(function (g) {
        if (ruleViolation(week, rule, week.matches.filter(function (m) { return m.pool === g; }))) touched[g] = 1;
      });
    });
    (plan.pool_moves || []).forEach(function (mv) {
      var p = mv && mv.player, g = mv && mv.pool;
      if (!pm[p] || gids.indexOf(g) < 0) { errors.push('조 옮기기를 할 수 없어요: ' + nm(p) + ' → ' + g); return; }
      if (!week.attendees[p]) { errors.push(nm(p) + '은(는) 이번 주 참석자가 아니에요'); return; }
      touched[week.attendees[p]] = 1; touched[g] = 1;
      week.attendees[p] = g; moved[p] = 1;
    });
    (plan.regenerate || []).forEach(function (g) {
      if (gids.indexOf(g) < 0) errors.push('없는 조예요: ' + g); else touched[g] = 1;
    });
    var regenerated = [];
    gids.forEach(function (g, i) {
      if (!touched[g]) return;
      var res = regenPool(st, week, g, (seed + i * 7919) >>> 0, newId, moved);
      if (res.error) { errors.push(g + '조 다시 짜기 실패: ' + res.error); return; }
      regenerated.push(g);
      res.split.forEach(function (id) { warnings.push(nm(id) + ': 두 조 경기에 나눠 들어가 있어서 ' + g + '조를 다시 짜면 경기 수가 맞지 않아요. 한 조로 옮겨 주세요.'); });
    });

    (plan.edits || []).forEach(function (e) {
      var type = e && e.type;
      if (type === 'swap') {
        var ps = e.players || [], p = ps[0], q = ps[1];
        if (ps.length !== 2 || !pm[p] || !pm[q] || p === q) { errors.push('맞바꿀 두 선수를 찾지 못했어요'); return; }
        var targets = e.matches && e.matches.length ? e.matches.map(findM) : week.matches;
        if (targets.some(function (m) { return !m; })) { errors.push('없는 경기라 맞바꾸지 못했어요: ' + e.matches.join(', ')); return; }
        var sw = function (id) { return id === p ? q : id === q ? p : id; };
        targets.forEach(function (m) { m.a = m.a.map(sw); m.b = m.b.map(sw); m.off = (m.off || []).map(sw); });
      } else if (type === 'set_slot') {
        var m = findM(e.match);
        if (!m || (e.side !== 'a' && e.side !== 'b') || (e.index !== 0 && e.index !== 1) || (e.player && !pm[e.player])) { errors.push('경기 자리를 바꾸지 못했어요: ' + e.match); return; }
        m[e.side][e.index] = e.player || '';
        m.off = (m.off || []).filter(function (id) { return m.a.concat(m.b).indexOf(id) >= 0; });
      } else if (type === 'set_off') {
        var m2 = findM(e.match);
        if (!m2 || m2.a.concat(m2.b).indexOf(e.player) < 0) { errors.push('추가출전 표시를 바꾸지 못했어요: ' + nm(e.player)); return; }
        m2.off = (m2.off || []).filter(function (id) { return id !== e.player; });
        if (e.off) m2.off.push(e.player);
      } else errors.push('알 수 없는 수정 종류예요: ' + type);
    });
    return { week: week, regenerated: regenerated, errors: errors, warnings: warnings };
  }

  var HINTS = { '캐비어': 'A', '랍스터': 'A', '소갈비': 'B', '양갈비': 'B', '돼지갈비': 'C', '닭갈비': 'C', '돼지': 'C', '닭': 'C' };
  function parseBand(text, players) {
    var byName = {};
    players.forEach(function (p) { if (p.active !== false) byName[p.name] = p.id; });
    var matched = [], unknown = [], seen = {};
    String(text || '').split(/[,\n\r，、]+/).forEach(function (tok) {
      var m = tok.trim().replace(/^\d+[.)]\s*/, '').match(/^([가-힣A-Za-z]{2,6})\s*(?:\(([^)]*)\))?/);
      if (!m) return;
      var nm = m[1], hint = (m[2] || '').trim();
      if (seen[nm]) return;
      if (byName[nm]) { seen[nm] = 1; matched.push(byName[nm]); return; }
      if (hint) {
        var g = HINTS[hint] || null;
        if (!g) Object.keys(HINTS).forEach(function (h) { if (!g && hint.indexOf(h) >= 0) g = HINTS[h]; });
        seen[nm] = 1;
        unknown.push({ name: nm, group: g });
      }
    });
    return { matched: matched, unknown: unknown };
  }

  // ---- 실력 시드: {A:[pid 1위, 2위…], B:[…], C:[…]} — 화면에 안 보이게 가볍게 인코딩
  function b64e(s) { return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); }
  function b64d(s) { return typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); }
  function encodeSeeds(seeds) {
    var s = unescape(encodeURIComponent(JSON.stringify(seeds || {})));
    return 's1:' + b64e(s).split('').reverse().join('');
  }
  function decodeSeeds(enc) {
    if (typeof enc !== 'string' || enc.indexOf('s1:') !== 0) return {};
    try {
      var o = JSON.parse(decodeURIComponent(escape(b64d(enc.slice(3).split('').reverse().join('')))));
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }
  function parseOrder(text, players) {
    var byName = {};
    players.forEach(function (p) { byName[p.name] = p.id; });
    var ids = [], unknown = [], seen = {};
    String(text || '').split(/[,\n\r，、]+/).forEach(function (tok) {
      var nm = tok.trim().replace(/^\d+\s*[.)위]?\s*/, '').replace(/\(.*$/, '').trim();
      if (!/^[가-힣A-Za-z]{2,6}$/.test(nm) || seen[nm]) return;
      seen[nm] = 1;
      if (byName[nm]) ids.push(byName[nm]); else unknown.push(nm);
    });
    return { ids: ids, unknown: unknown };
  }
  // 편성용 실력(0~1): 시드 점수 → 경기가 쌓일수록 실제 승률 비중↑ (6경기면 반반)
  function strengthOf(state, pid, beforeDate, pool) {
    var pm = playerMap(state), p = pm[pid];
    var order = state.settings.groups.map(function (g) { return g.id; });
    var seedScore = 0.5;
    if (p && pool && p.group !== pool && order.indexOf(p.group) >= 0 && order.indexOf(pool) >= 0) {
      seedScore = order.indexOf(p.group) < order.indexOf(pool) ? 1 : 0;
    } else if (p) {
      var list = (decodeSeeds(state.settings.seeds)[p.group] || []).filter(function (id) { return pm[id] && pm[id].group === p.group; });
      var r = list.indexOf(pid);
      if (r >= 0) seedScore = list.length > 1 ? 1 - r / (list.length - 1) : 0.5;
    }
    var w = 0, l = 0;
    state.weeks.forEach(function (wk) {
      if (wk.date >= beforeDate) return;
      var t = weekTally(wk)[pid];
      if (t) { w += t.wins; l += t.losses; }
    });
    var dec = w + l;
    if (!dec) return seedScore;
    var wr = dec / (dec + 6);
    return seedScore * (1 - wr) + ((w + 1) / (dec + 2)) * wr;
  }
  function balanceOf(sumA, sumB) {
    var d = Math.abs(sumA - sumB);
    return d <= 0.15 ? 'even' : d <= 0.4 ? 'ok' : 'lopsided';
  }

  // ---------- 돼블스플랜(승부 예측) ----------
  // 규칙 숫자는 여기서만 바꿈. 마감 시각은 앱에서 바꿀 수 없음(테스트는 now 인자로 시험)
  var PREDICT = {
    picks: 4,
    closeUtc: { h: 8, m: 30 },                 // 수요일 17:30 KST = 08:30 UTC
    bonus: { high: { hit: 3, miss: -2 }, safe: { hit: 1, miss: 0 } },   // 하이리스크 실패 -2 (돼장 결정 2026-11-16)
    quota: { A: 1, B: 2, C: 1 },                // 조별로 고를 경기 수: 캐비어·랍스터 1 · 소갈비·양갈비 2 · 돼지갈비·닭갈비 1 (schema.sql pred_check와 같게)
    upperShare: 0.7,                            // 🔺상한가: 한 경기 안에서 이 비율 이상
    changeWindowMs: 3600e3,                     // 인기 픽 ▲▼: 최근 1시간 증감
    hotShare: 0.7, underShare: 0.3,             // 인기 픽 배지: 70% 초과 / 역배 후보: 30% 미만
    badgeMin: 5,                                // 그 경기를 고른 사람이 이보다 적으면 배지 없음
  };
  function predictionDeadline(weekDate) {
    var p = String(weekDate).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], PREDICT.closeUtc.h, PREDICT.closeUtc.m));
  }
  function isPredictionClosed(weekDate, now) { return now >= predictionDeadline(weekDate).getTime(); }
  // 경기 시작(= 예측 마감과 같은 수요일 17:30 KST) 지났는지. 결과 대기 표시 기준
  function matchStarted(weekDate, now) { return isPredictionClosed(weekDate, now); }
  function matchOf(week, id) { return week && (week.matches || []).filter(function (m) { return m.id === id; })[0] || null; }
  function matchValid(m) { return !!m && m.a.length === 2 && m.b.length === 2 && m.a.concat(m.b).every(Boolean); }

  // 오류 코드 목록: count(4개 아님) / dup_match / no_match / bad_side
  function validatePicks(picks, week) {
    if (!Array.isArray(picks) || picks.length !== PREDICT.picks) return ['count'];
    var out = [], seen = {};
    picks.forEach(function (p) {
      var id = p && p.match;
      if (seen[id] && out.indexOf('dup_match') < 0) out.push('dup_match');
      seen[id] = 1;
      if (!matchOf(week, id) && out.indexOf('no_match') < 0) out.push('no_match');
      if (!p || (p.side !== 'a' && p.side !== 'b')) { if (out.indexOf('bad_side') < 0) out.push('bad_side'); }
    });
    var st = !out.length && quotaStatus(picks, week);
    if (st && Object.keys(st).some(function (g) { return st[g].have !== st[g].need; })) out.push('quota');
    return out;
  }
  // 이 주에 적용할 조별 고정. 한 조라도 경기 수가 모자라 채울 수 없으면 null (그 주는 아무 4경기)
  function pickQuota(week) {
    var q = PREDICT.quota, ms = (week && week.matches) || [];
    var ok = Object.keys(q).every(function (g) { return ms.filter(function (m) { return m.pool === g; }).length >= q[g]; });
    return ok ? q : null;
  }
  // 조별 고른 수 → {조: {need, have, full}} (고정이 없는 주면 null)
  function quotaStatus(picks, week) {
    var q = pickQuota(week);
    if (!q) return null;
    var out = {};
    Object.keys(q).forEach(function (g) {
      var have = (picks || []).filter(function (p) { var m = matchOf(week, p && p.match); return m && m.pool === g; }).length;
      out[g] = { need: q[g], have: have, full: have >= q[g] };
    });
    return out;
  }

  // → {status: pending|hit|miss|check, bonus, picks:[{match, side, result}]}
  // 사라졌거나 무효인 경기가 있으면 다른 결과와 상관없이 check(돼장 확인). 그다음 하나라도 틀리면 miss
  function scorePrediction(pred, week) {
    var picks = (pred && pred.picks) || [];
    var rs = (Array.isArray(picks) ? picks : []).map(function (p) {
      var m = matchOf(week, p && p.match);
      var r = !matchValid(m) ? 'check' : !m.win ? 'pending' : m.win === p.side ? 'hit' : 'miss';
      return { match: p && p.match, side: p && p.side, result: r };
    });
    var has = function (k) { return rs.some(function (x) { return x.result === k; }); };
    var status = !week || validatePicks(picks, week).length || has('check') ? 'check' : has('miss') ? 'miss' : has('pending') ? 'pending' : 'hit';
    var table = PREDICT.bonus[pred && pred.mode] || { hit: 0, miss: 0 };
    var bonus = status === 'hit' ? table.hit : status === 'miss' ? table.miss : 0;
    return { status: status, bonus: bonus, picks: rs };
  }

  // predictions: [{week_date, player_id, mode, picks}] → {pid: 보너스 합계}. 공개된 주만
  function bonusByPlayer(state, predictions) {
    var out = {};
    (predictions || []).forEach(function (p) {
      var w = state.weeks.filter(function (x) { return x.date === p.week_date; })[0];
      if (!w || w.published === false) return;
      var b = scorePrediction(p, w).bonus;
      if (b) out[p.player_id] = (out[p.player_id] || 0) + b;
    });
    return out;
  }

  function weekMatchIndex(week) { var r = {}; (week && week.matches || []).forEach(function (m, i) { r[m.id] = i; }); return r; }
  // counts: [{match_id, side, mode, n}] → 이 주 경기만, (mode 필터) → {key: {match, side, n}}, 경기별 합계
  function sumCounts(counts, week, mode) {
    var idx = weekMatchIndex(week), sides = {}, totals = {};
    (counts || []).forEach(function (c) {
      if (!(c.match_id in idx) || (mode && c.mode !== mode) || !(c.n > 0)) return;
      var k = c.match_id + c.side;
      var s = sides[k] || (sides[k] = { match: c.match_id, side: c.side, n: 0 });
      s.n += c.n;
      totals[c.match_id] = (totals[c.match_id] || 0) + c.n;
    });
    return { sides: sides, totals: totals, idx: idx };
  }
  // 팀(경기의 한쪽)별 선택 인원 순위 → [{match, side, n, total, share, rank, index}]
  function popularPicks(counts, week, mode) {
    var s = sumCounts(counts, week, mode);
    var list = Object.keys(s.sides).map(function (k) {
      var x = s.sides[k], t = s.totals[x.match];
      return { match: x.match, side: x.side, n: x.n, total: t, share: x.n / t, index: s.idx[x.match] };
    });
    list.sort(function (x, y) { return y.n - x.n || y.share - x.share || x.index - y.index || (x.side < y.side ? -1 : 1); });
    list.forEach(function (r, i) { r.rank = i > 0 && list[i - 1].n === r.n ? list[i - 1].rank : i + 1; });
    return list;
  }
  // events: [{match_id, side, mode, delta, at}] → {match+side: 최근 1시간 증감}
  function pickChanges(events, now, mode) {
    var from = now - PREDICT.changeWindowMs, out = {};
    (events || []).forEach(function (e) {
      var t = Date.parse(e.at);
      if (t < from || t > now || (mode && e.mode !== mode)) return;
      var k = e.match_id + e.side;
      out[k] = (out[k] || 0) + (e.delta == null ? 1 : e.delta);
      if (!out[k]) delete out[k];
    });
    return out;
  }
  // 선수별 인기: 그 선수가 들어간 팀을 고른 수의 합(두 경기 모두 고르면 2로 셈) → [{player, n, rank, change}]
  // week 대신 {matches: 고른 경기만} 을 넘기면 그 경기들만 셈. changes: pickChanges 결과(선택)
  function playerPicks(counts, week, changes) {
    var s = sumCounts(counts, week), load = {}, ch = {};
    Object.keys(s.sides).forEach(function (k) {
      var x = s.sides[k];
      matchOf(week, x.match)[x.side].forEach(function (pid) {
        if (!pid) return;
        load[pid] = (load[pid] || 0) + x.n;
        ch[pid] = (ch[pid] || 0) + ((changes && changes[k]) || 0);
      });
    });
    // 선택 비율의 분모: 그 선수가 뛰는 경기들을 고른 수 (상대 팀만 고른 경기도 포함)
    var tot = {};
    (week.matches || []).forEach(function (m) {
      var t = s.totals[m.id] || 0;
      if (t) m.a.concat(m.b).forEach(function (pid) { if (pid) tot[pid] = (tot[pid] || 0) + t; });
    });
    var list = Object.keys(load).map(function (pid) { return { player: pid, n: load[pid], total: tot[pid], share: load[pid] / tot[pid], change: ch[pid] }; })
      .sort(function (a, b) { return b.n - a.n || (a.player < b.player ? -1 : 1); });
    list.forEach(function (r, i) { r.rank = i > 0 && list[i - 1].n === r.n ? list[i - 1].rank : i + 1; });
    return list;
  }
  // 경기별 양 팀 현황(팀별 인기 픽 카드): 그 주 경기 순서대로, 아무도 안 고른 경기도 포함
  // → [{match, pool, index, total, a:{n, share, badge}, b:{…}}]  share 분모는 그 경기를 고른 인원(양 팀 합)
  // badge: 'hot' 인기 픽(hotShare 초과) / 'under' 역배 후보(underShare 미만) / '' — 고른 사람이 badgeMin 미만이면 ''
  // 한 사람은 서로 다른 4경기만 고를 수 있으므로 양 팀 인원의 합 = 그 경기를 예측한 서로 다른 회원 수
  function matchBoard(counts, week) {
    var s = sumCounts(counts, week);
    return (week && week.matches || []).map(function (m, i) {
      var total = s.totals[m.id] || 0;
      var side = function (k) {
        var n = (s.sides[m.id + k] || { n: 0 }).n, share = total ? n / total : 0;
        var badge = total < PREDICT.badgeMin ? '' : share > PREDICT.hotShare ? 'hot' : share < PREDICT.underShare ? 'under' : '';
        return { n: n, share: share, badge: badge };
      };
      return { match: m.id, pool: m.pool, index: i, total: total, a: side('a'), b: side('b') };
    });
  }
  // 조별 슈퍼매치: 조(pool)마다 예측 인원이 가장 많은 경기(공동 1위는 모두, 0명인 조는 없음) → {matchId: 인원}
  function superMatches(counts, week) {
    var best = {}, out = {};
    var board = matchBoard(counts, week).filter(function (x) { return x.total > 0; });
    board.forEach(function (x) { if (!(best[x.pool] >= x.total)) best[x.pool] = x.total; });
    board.forEach(function (x) { if (x.total === best[x.pool]) out[x.match] = x.total; });
    return out;
  }
  // 🔺상한가: 경기 안 70% 이상인 쪽 / 인기 선수(예전 이름 작전주): 고른 인원이 가장 많이 걸린 선수 1명(동률이면 id 순)
  function pickBadges(counts, week) {
    var s = sumCounts(counts, week), upper = {};
    Object.keys(s.sides).forEach(function (k) {
      var x = s.sides[k];
      if (x.n / s.totals[x.match] >= PREDICT.upperShare) upper[k] = 1;
    });
    var top = playerPicks(counts, week)[0];
    return { upper: upper, sneaky: top ? top.player : null };
  }
  // 마감 비율 스냅숏(prediction_close와 같은 모양): 두 방식 합산 → [{match_id, side, n, total}]
  function closeFromPredictions(predictions) {
    var n = {}, total = {};
    (predictions || []).forEach(function (p) {
      (p.picks || []).forEach(function (k) {
        n[k.match + '|' + k.side] = (n[k.match + '|' + k.side] || 0) + 1;
        total[k.match] = (total[k.match] || 0) + 1;
      });
    });
    return Object.keys(n).map(function (k) { var p = k.split('|'); return { match_id: p[0], side: p[1], n: n[k], total: total[p[0]] }; });
  }
  // 장 마감 리포트: 그 주 경기 결과가 모두 들어오면 ready
  function closingReport(week, close, predictions) {
    var ms = (week && week.matches) || [];
    var ready = ms.length > 0 && ms.every(function (m) { return m.win; }) && (predictions || []).length > 0;
    var rows = (close && close.length ? close : closeFromPredictions(predictions)).filter(function (r) { return matchOf(week, r.match_id) && r.total > 0; })
      .map(function (r) { var m = matchOf(week, r.match_id); return { match: r.match_id, side: r.side, n: r.n, total: r.total, share: r.n / r.total, won: m.win === r.side, lost: !!m.win && m.win !== r.side }; });
    var idx = weekMatchIndex(week);
    var most = function (a, b) { return b.n - a.n || b.share - a.share || idx[a.match] - idx[b.match]; };
    var upper = rows.filter(function (r) { return r.won; }).sort(most)[0] || null;
    var crash = rows.filter(function (r) { return r.lost; }).sort(most)[0] || null;
    var contrarian = rows.filter(function (r) { return r.won && r.share < 0.5; })
      .sort(function (a, b) { return a.share - b.share || b.n - a.n || idx[a.match] - idx[b.match]; })[0] || null;
    var scored = (predictions || []).map(function (p) { return { p: p, s: scorePrediction(p, week) }; });
    var hitters = scored.filter(function (x) { return x.s.status === 'hit'; })
      .map(function (x) { return { player: x.p.player_id, mode: x.p.mode, bonus: x.s.bonus }; })
      .sort(function (a, b) { return b.bonus - a.bonus; });
    return {
      ready: ready, participants: scored.length,
      hits: hitters.length, misses: scored.filter(function (x) { return x.s.status === 'miss'; }).length,
      upper: upper, crash: crash, contrarian: contrarian,
      profit: {
        total: hitters.reduce(function (t, h) { return t + h.bonus; }, 0),
        high: hitters.filter(function (h) { return h.mode === 'high'; }).length,
        safe: hitters.filter(function (h) { return h.mode === 'safe'; }).length,
      },
      hitters: hitters,
    };
  }

  // 내 기록 승수 표시. standings 행(bonus 포함) → { has, total, wins, losses, bonus }. total = 공식 승 + 예측 보너스(순위 기준)
  function meRecord(row) {
    var w = row ? row.wins || 0 : 0, l = row ? row.losses || 0 : 0, b = row ? row.bonus || 0 : 0;
    return { has: w + l > 0 || b !== 0, total: w + b, wins: w, losses: l, bonus: b };
  }
  // 경기 중 내 예측 상태(이번 주 탭). 숫자만 돌려주고 문구는 화면에서 → { status, hits, misses, left, bonus, ifAllHit } | null
  function livePrediction(pred, week) {
    if (!pred) return null;
    var s = scorePrediction(pred, week);
    var n = function (k) { return s.picks.filter(function (p) { return p.result === k; }).length; };
    var b = PREDICT.bonus[pred.mode] || { hit: 0, miss: 0 };
    return { status: s.status, hits: n('hit'), misses: n('miss'), left: n('pending'), bonus: s.bonus, ifAllHit: b.hit };
  }
  // ---------- 경기 진행(코트) ----------
  // 돼장 경기 진행 화면·회원 '진행 중/다음 차례'. 코트에 들어간 경기: m.court(1..3)·m.startedAt, 결과 입력 때 m.endedAt.
  // avail: [{player_id, status: 'late'|'away'|'out', until}] (availability 테이블). away는 until이 지나면 자동으로 풀림
  var LIVE = { courts: 3 };
  function liveDayStart(date) { return predictionDeadline(date).getTime(); }   // 수요일 17:30 KST
  function liveBoard(week, avail, now, opts) {
    var n = (opts && opts.courts) || LIVE.courts;
    var ms = (week && week.matches) || [];
    var courts = [], playing = {}, away = {};
    for (var c = 1; c <= n; c++) courts.push(null);
    ms.forEach(function (m) {
      if (m.win || !m.court || m.court < 1 || m.court > n) return;
      courts[m.court - 1] = m;
      playersOf(m).forEach(function (p) { playing[p] = m.court; });
    });
    (avail || []).forEach(function (a) {
      if (!a || !a.player_id || ['late', 'away', 'out'].indexOf(a.status) < 0) return;
      if (a.status === 'away' && a.until && Date.parse(a.until) <= now) return;  // 복귀 시각 지남
      away[a.player_id] = { status: a.status, until: a.until || null };
    });
    var start = liveDayStart(week.date), last = {};
    ms.forEach(function (m) {
      if (!m.win || !m.endedAt) return;
      var t = Date.parse(m.endedAt);
      playersOf(m).forEach(function (p) { if (!(last[p] >= t)) last[p] = t; });
    });
    var waitOf = function (p) { return Math.max(0, Math.round((now - (last[p] || start)) / 60000)); };
    var ready = [], blocked = [], done = [];
    ms.forEach(function (m, i) {
      if (m.win) { done.push(m); return; }
      if (courts.indexOf(m) >= 0) return;
      var why = [];
      playersOf(m).forEach(function (p) {
        if (playing[p]) why.push({ pid: p, kind: 'playing', court: playing[p] });
        else if (away[p]) why.push({ pid: p, kind: away[p].status, until: away[p].until });
      });
      if (why.length) blocked.push({ m: m, why: why });
      else ready.push({ m: m, i: i, wait: playersOf(m).reduce(function (t, p) { return t + waitOf(p); }, 0), longest: Math.max.apply(null, playersOf(m).map(waitOf)) });
    });
    ready.sort(function (x, y) { return y.wait - x.wait || x.i - y.i; });
    ready.forEach(function (r) { delete r.i; });
    done.sort(function (x, y) { return (Date.parse(y.endedAt) || 0) - (Date.parse(x.endedAt) || 0); });
    var free = [];
    courts.forEach(function (m, k) { if (!m) free.push(k + 1); });
    return { courts: courts, freeCourts: free, ready: ready, blocked: blocked, done: done, away: away, playing: playing };
  }
  function liveMatch(week, id) { return ((week && week.matches) || []).filter(function (m) { return m.id === id; })[0] || null; }
  // 코트에 넣기: 빈 코트·결과 없음·선수가 다른 코트에 없을 때만 (자리 비움은 화면에서 막고, 돼장은 먼저 풀면 됨)
  function startMatch(week, id, court, iso) {
    var m = liveMatch(week, id);
    if (!m || m.win || m.court || !(court >= 1 && court <= LIVE.courts)) return false;
    var busy = {};
    week.matches.forEach(function (x) { if (!x.win && x.court) { if (x.court === court) busy.court = 1; playersOf(x).forEach(function (p) { busy[p] = 1; }); } });
    if (busy.court || playersOf(m).some(function (p) { return busy[p]; })) return false;
    m.court = court; m.startedAt = iso;
    return true;
  }
  function finishMatch(week, id, side, iso) {
    var m = liveMatch(week, id);
    if (!m || !m.court || m.win || (side !== 'a' && side !== 'b')) return false;
    m.win = side; m.endedAt = iso; m.court = null;
    return true;
  }
  function cancelMatch(week, id) {
    var m = liveMatch(week, id);
    if (!m || !m.court) return false;
    m.court = null; m.startedAt = null;
    return true;
  }
  // 회원 화면용: 내 경기 상태 → playing(코트) | next(바로 가능 순위 ≤ 코트 수) | waiting | blocked | none
  function myLive(board, pid) {
    var n = board.courts.length;
    for (var c = 0; c < n; c++) if (board.courts[c] && playersOf(board.courts[c]).indexOf(pid) >= 0) return { state: 'playing', match: board.courts[c].id, court: c + 1 };
    for (var i = 0; i < board.ready.length; i++) if (playersOf(board.ready[i].m).indexOf(pid) >= 0) return { state: i < n ? 'next' : 'waiting', match: board.ready[i].m.id, rank: i + 1 };
    for (var j = 0; j < board.blocked.length; j++) if (playersOf(board.blocked[j].m).indexOf(pid) >= 0) return { state: 'blocked', match: board.blocked[j].m.id };
    return { state: 'none' };
  }

  // 한 사람의 돼블스플랜 기록 (공개된 주만, bonusByPlayer와 같은 기준) → { hit, miss, pending, bonus }
  function predictionRecord(state, predictions, pid) {
    var r = { hit: 0, miss: 0, pending: 0, bonus: 0 };
    (predictions || []).forEach(function (p) {
      if (p.player_id !== pid) return;
      var w = state.weeks.filter(function (x) { return x.date === p.week_date; })[0];
      if (!w || w.published === false) return;
      var s = scorePrediction(p, w);
      if (s.status in r) r[s.status]++;
      r.bonus += s.bonus;
    });
    return r;
  }

  return {
    LIVE: LIVE, liveBoard: liveBoard, startMatch: startMatch, finishMatch: finishMatch, cancelMatch: cancelMatch, myLive: myLive,
    meRecord: meRecord, matchStarted: matchStarted, livePrediction: livePrediction, predictionRecord: predictionRecord,
    PREDICT: PREDICT, pickQuota: pickQuota, quotaStatus: quotaStatus, predictionDeadline: predictionDeadline, isPredictionClosed: isPredictionClosed, validatePicks: validatePicks,
    scorePrediction: scorePrediction, bonusByPlayer: bonusByPlayer, popularPicks: popularPicks, pickChanges: pickChanges,
    pickBadges: pickBadges, playerPicks: playerPicks, matchBoard: matchBoard, superMatches: superMatches, closeFromPredictions: closeFromPredictions, closingReport: closingReport,
    encodeSeeds: encodeSeeds, decodeSeeds: decodeSeeds, parseOrder: parseOrder, strengthOf: strengthOf, balanceOf: balanceOf,
    mulberry32: mulberry32, wednesdays: wednesdays, seasonDays: seasonDays, isOfficial: isOfficial, playersOf: playersOf,
    weekTally: weekTally, standings: standings, tierOf: tierOf, skillOf: skillOf, HEAT: HEAT,
    generatePool: generatePool, validateWeek: validateWeek, parseBand: parseBand,
    RULE_ARITY: RULE_ARITY, ruleText: ruleText, ruleViolation: ruleViolation, regenPool: regenPool, applyPlan: applyPlan, tierShift: tierShift, tierCandidates: tierCandidates, shiftTarget: shiftTarget,
  };
})();
if (typeof module !== 'undefined') module.exports = Logic;
