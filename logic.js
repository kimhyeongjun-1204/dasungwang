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
  function standings(state) {
    var pm = playerMap(state);
    var mode = state.settings.countBy || 'registered';
    var rows = {};
    state.settings.groups.forEach(function (g) { rows[g.id] = {}; });
    function row(gid, pid) {
      if (!rows[gid]) rows[gid] = {};
      var p = pm[pid];
      return rows[gid][pid] || (rows[gid][pid] = { id: pid, name: p ? p.name : '(삭제된 선수)', wins: 0, losses: 0, pending: 0, weeks: 0 });
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
            if (!seen[gid + pid]) { seen[gid + pid] = 1; r.weeks++; }
            if (!m.win) r.pending++;
            else if (m.win === side) r.wins++;
            else r.losses++;
          });
        });
      });
    });
    var out = {};
    Object.keys(rows).forEach(function (gid) {
      var g = state.settings.groups.filter(function (x) { return x.id === gid; })[0];
      var winners = g ? g.winners : 1;
      var list = Object.keys(rows[gid]).map(function (k) { return rows[gid][k]; });
      list.sort(function (x, y) {
        return y.wins - x.wins || x.losses - y.losses || x.name.localeCompare(y.name, 'ko');
      });
      list.forEach(function (r, i) {
        r.rank = i > 0 && list[i - 1].wins === r.wins ? list[i - 1].rank : i + 1;
      });
      var cutoff = list[winners - 1];
      list.forEach(function (r) {
        r.contender = !!cutoff && cutoff.wins > 0 && r.wins >= cutoff.wins;
        r.lottery = false;
      });
      if (cutoff && cutoff.wins > 0) {
        var tied = list.filter(function (r) { return r.wins === cutoff.wins; });
        var above = list.filter(function (r) { return r.wins > cutoff.wins; }).length;
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

  function evaluate(games, byId) {
    var partner = {}, opp = {}, cost = 0, pairs = [];
    for (var g = 0; g < games.length; g++) {
      var gm = games[g];
      if (gm[0] === gm[1] || gm[0] === gm[2] || gm[0] === gm[3] || gm[1] === gm[2] || gm[1] === gm[3] || gm[2] === gm[3]) {
        cost += 1e6; pairs.push(null); continue;
      }
      var hs = gm.map(function (id) { return byId[id].heat; });
      cost += (Math.max.apply(null, hs) - Math.min.apply(null, hs)) * 30;
      var best = null, bc = Infinity;
      for (var p = 0; p < 3; p++) {
        var P = PAIRINGS[p];
        var A = [gm[P[0]], gm[P[1]]], B = [gm[P[2]], gm[P[3]]];
        var c = 0;
        if (partner[pkey(A[0], A[1])]) c += 1000;
        if (partner[pkey(B[0], B[1])]) c += 1000;
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

  // players: [{id, heat(0~2), skill(0~1)}] → {matches:[{a,b,off}]} 또는 {error}
  function generatePool(players, seed, opts) {
    opts = opts || {};
    var n = players.length;
    if (n < 4) return { error: '4명 이상이어야 편성할 수 있어요 (현재 ' + n + '명)' };
    var rng = mulberry32(seed >>> 0);
    var G = Math.ceil(n / 2);
    var extraCount = 4 * G - 2 * n;
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    var restarts = opts.restarts || 12, iters = opts.iters || (300 + G * 100);
    var best = null;
    for (var r = 0; r < restarts; r++) {
      var slots = [];
      players.forEach(function (p) { slots.push(p.id, p.id); });
      var ids = shuffle(players.map(function (p) { return p.id; }), rng);
      for (var k = 0; k < extraCount; k++) slots.push(ids[k]);
      shuffle(slots, rng);
      var games = [];
      for (var g = 0; g < G; g++) games.push(slots.slice(g * 4, g * 4 + 4));
      var cur = evaluate(games, byId).cost;
      for (var it = 0; it < iters && cur > 0; it++) {
        var g1 = Math.floor(rng() * G), g2 = Math.floor(rng() * G);
        if (g1 === g2) continue;
        var i1 = Math.floor(rng() * 4), i2 = Math.floor(rng() * 4);
        var t = games[g1][i1]; games[g1][i1] = games[g2][i2]; games[g2][i2] = t;
        var c = evaluate(games, byId).cost;
        if (c <= cur) cur = c;
        else { t = games[g1][i1]; games[g1][i1] = games[g2][i2]; games[g2][i2] = t; }
      }
      if (!best || cur < best.cost) best = { cost: cur, games: games.map(function (x) { return x.slice(); }) };
    }
    var ev = evaluate(best.games, byId);
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
    return issues;
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

  return {
    encodeSeeds: encodeSeeds, decodeSeeds: decodeSeeds, parseOrder: parseOrder, strengthOf: strengthOf, balanceOf: balanceOf,
    mulberry32: mulberry32, wednesdays: wednesdays, isOfficial: isOfficial, playersOf: playersOf,
    weekTally: weekTally, standings: standings, tierOf: tierOf, skillOf: skillOf, HEAT: HEAT,
    generatePool: generatePool, validateWeek: validateWeek, parseBand: parseBand,
  };
})();
if (typeof module !== 'undefined') module.exports = Logic;
