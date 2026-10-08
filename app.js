(function () {
  'use strict';
  var L = window.Logic;
  var KEY = { me: 'ddw-me', draft: 'ddw-draft', tab: 'ddw-tab' };
  var SKEY = { admin: 'ddw-admin', week: 'ddw-week', sec: 'ddw-sec' };
  var FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@500;700;900&display=swap">';
  var TITLE = '라켓뚱보단 다승왕전';

  function store(kind) {
    return {
      get: function (k) { try { return window[kind].getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { window[kind].setItem(k, v); } catch (e) { } },
      del: function (k) { try { window[kind].removeItem(k); } catch (e) { } },
    };
  }
  var LS = store('localStorage'), SS = store('sessionStorage');
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function md(d) { var p = d.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function todayKST() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }

  var saved = JSON.parse(document.getElementById('state').textContent);
  var work = clone(saved);
  var api = { artifact: null, downloads: null };
  var readOnly = false;
  var ui = {
    tab: LS.get(KEY.tab) || 'week',
    week: SS.get(SKEY.week) || null,
    me: LS.get(KEY.me) || '',
    admin: SS.get(SKEY.admin) === '1',
    sec: SS.get(SKEY.sec) || 'plan',
    rankGroup: null,
    seedGroup: 'A',
    seedText: {},
    paste: '',
    unknown: [],
    confirm: null,
    draftConflict: null,
    toast: null,
    busy: null,
    pinMsg: '',
    notice: null,
  };

  // 저장 안 된 변경(이 기기) 복원
  (function () {
    var raw = LS.get(KEY.draft);
    if (!raw) return;
    var d; try { d = JSON.parse(raw); } catch (e) { LS.del(KEY.draft); return; }
    if (!d || !d.state || same(d.state, saved)) { LS.del(KEY.draft); return; }
    if (d.baseRev === saved.rev) work = d.state;
    else ui.draftConflict = d;
  })();

  function pm() { var m = {}; work.players.forEach(function (p) { m[p.id] = p; }); return m; }
  function groups() { return work.settings.groups; }
  function gname(id) { var g = groups().filter(function (x) { return x.id === id; })[0]; return g ? g.name : id; }
  function seasonDates() {
    var ds = L.wednesdays(work.settings.seasonStart, work.settings.seasonEnd);
    work.weeks.forEach(function (w) { if (ds.indexOf(w.date) < 0) ds.push(w.date); });
    return ds.sort();
  }
  function getWeek(date) { return work.weeks.filter(function (w) { return w.date === date; })[0] || null; }
  function ensureWeek(date) {
    var w = getWeek(date);
    if (!w) { w = { date: date, published: false, attendees: {}, matches: [] }; work.weeks.push(w); work.weeks.sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }
    return w;
  }
  function weekStatus(w) {
    if (!w || !w.matches.length) return w && Object.keys(w.attendees || {}).length ? 'plan' : 'none';
    var done = w.matches.filter(function (m) { return m.win; }).length;
    return done === w.matches.length ? 'done' : done ? 'part' : 'plan';
  }
  function defaultWeek() {
    var ds = seasonDates(), t = todayKST();
    var up = ds.filter(function (d) { return d >= t; })[0];
    var upW = up && getWeek(up);
    if (upW && upW.published) return up;
    var pub = work.weeks.filter(function (w) { return w.published && w.date <= t; });
    if (pub.length) return pub[pub.length - 1].date;
    return up || ds[ds.length - 1];
  }
  if (!ui.week || seasonDates().indexOf(ui.week) < 0) ui.week = defaultWeek();
  function nextPlayDate() { var t = todayKST(); return seasonDates().filter(function (d) { return d >= t; })[0] || '9999-12-31'; }
  function poolOrder(p) { var i = groups().map(function (g) { return g.id; }).indexOf(p); return i < 0 ? 99 : i; }
  function sortMatches(w) {
    w.matches = w.matches.map(function (m, i) { return { m: m, i: i }; })
      .sort(function (x, y) { return poolOrder(x.m.pool) - poolOrder(y.m.pool) || x.i - y.i; })
      .map(function (x) { return x.m; });
  }
  function newId() { work.nextId = (work.nextId || 1) + 1; return 'm' + String(work.nextId).padStart(4, '0') + Math.random().toString(36).slice(2, 5); }

  function dirty() { return !same(work, saved); }
  function commit() {
    if (dirty()) LS.set(KEY.draft, JSON.stringify({ baseRev: saved.rev, state: work, at: Date.now() }));
    else LS.del(KEY.draft);
    render();
  }
  var toastTimer;
  function toast(msg) { ui.toast = msg; render(); clearTimeout(toastTimer); toastTimer = setTimeout(function () { ui.toast = null; render(); }, 3200); }

  // PIN: 관리 화면 잠금용 (강한 보안 아님 — 실제 저장 권한은 편집 권한이 결정)
  function pinHash(pin, salt) {
    var s = salt + ':' + pin, h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var r = 0; r < 3; r++) for (var i = 0; i < s.length; i++) {
      h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619);
      h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) ^ (h1 >>> 7);
    }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }

  // ---------- 자체 저장 (문서 재생성) ----------
  function buildDoc(state) {
    var reset = '';
    try { var st = document.head.querySelector('style'); reset = st ? st.textContent : ''; } catch (e) { }
    var json = JSON.stringify(state).replace(/</g, '\\u003c');
    var content = '<title>' + TITLE + '</title>' + FONT_LINK +
      '<style id="app-css">' + document.getElementById('app-css').textContent + '<\/style>' +
      '<div id="app"></div>' +
      '<script id="state" type="application/json">' + json + '<\/script>' +
      '<script id="app-logic">' + document.getElementById('app-logic').textContent + '<\/script>' +
      '<script id="app-js">' + document.getElementById('app-js').textContent + '<\/script>';
    return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' +
      reset + '<\/style></head><body>' + content + '</body></html>';
  }
  function save() {
    if (ui.busy) return;
    if (!api.artifact || readOnly) {
      toast(readOnly ? '편집 권한이 없는 계정이라 저장할 수 없어요.' : '이 화면에서는 저장할 수 없어요. 앱 주인이 공유한 편집 권한으로 열어 주세요.');
      return;
    }
    var next = clone(work);
    next.rev = (saved.rev || 0) + 1;
    next.savedAt = new Date().toISOString();
    LS.set(KEY.draft, JSON.stringify({ baseRev: saved.rev, state: next, at: Date.now() }));
    ui.busy = '저장 중…'; render();
    api.artifact.publish(buildDoc(next)).then(function () {
      ui.busy = '저장됨. 새로고침 중…'; render();
    }).catch(function (e) {
      ui.busy = null;
      var code = e && e.code;
      if (code === 'conflict') { toast('다른 곳에서 먼저 저장됐어요. 새 버전으로 다시 불러와요.'); return; }
      LS.set(KEY.draft, JSON.stringify({ baseRev: saved.rev, state: work, at: Date.now() }));
      if (code === 'not_writer' || code === 'not_granted' || code === 'consent_required' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') {
        readOnly = true; toast('이 계정은 보기 전용이라 저장할 수 없어요. 변경 내용은 이 기기에 임시로 남아 있어요.');
      } else if (code === 'rate_limited') toast('저장이 너무 잦아요. 잠시 후 다시 저장해 주세요.');
      else if (code === 'too_large') toast('데이터가 너무 커서 저장하지 못했어요.');
      else toast('저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
  }

  // ---------- 렌더 ----------
  var TIER_LABEL = { hell: '지옥도', heaven: '천국도', mid: '중립', new: '첫 참가', unknown: '결과 대기' };
  function tierClass(pid, date) { var t = L.tierOf(work, pid, date).tier; return t === 'hell' || t === 'heaven' || t === 'mid' ? 't-' + t : ''; }
  function plHtml(pid, m, date, P) {
    var p = P[pid];
    var nm = p ? p.name : '빈 자리';
    var cls = 'pl ' + (pid ? tierClass(pid, date) : '') + (pid && pid === ui.me ? ' me' : '');
    var x = pid && !L.isOfficial(m, pid) ? '<i class="x">추가출전</i>' : '';
    return '<span class="' + cls + '">' + esc(nm) + x + '</span>';
  }

  function header() {
    var ds = L.wednesdays(work.settings.seasonStart, work.settings.seasonEnd);
    var done = 0;
    var bar = ds.map(function (d) {
      var s = weekStatus(getWeek(d));
      if (s === 'done') done++;
      return '<i class="' + (s === 'done' ? 'done' : s === 'part' ? 'part' : '') + (d === ui.week ? ' sel' : '') + '" title="' + md(d) + '"></i>';
    }).join('');
    return '<header class="hero"><div class="pig" role="img" aria-label="모임장 돼장"></div>' +
      '<div class="hero-txt"><span class="kicker">' + esc(work.settings.club) + ' · 수요 다승왕전</span>' +
      '<h1 class="title">돼지지옥<small>다승왕</small></h1>' +
      '<span class="tagline">이기면 <b>지옥도</b>, 지면 천국도!</span></div>' +
      '<div class="season"><div class="season-bar" aria-label="시즌 진행">' + bar + '</div><small class="num">' + md(ds[0]) + '–' + md(ds[ds.length - 1]) + ' · ' + done + '/' + ds.length + '주 완료</small></div></header>' +
      '<nav class="tabs" role="tablist">' + [['week', '이번 주'], ['rank', '순위'], ['me', '내 기록'], ['admin', '관리']].map(function (t) {
        return '<button role="tab" data-act="tab" data-v="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + t[1] + (t[0] === 'admin' && !ui.admin ? ' <span class="lock">PIN</span>' : '') + '</button>';
      }).join('') + '</nav>';
  }

  function weekChips() {
    return '<div class="weeks" role="group" aria-label="주차 선택">' + seasonDates().map(function (d) {
      var s = weekStatus(getWeek(d));
      return '<button data-act="week" data-v="' + d + '" aria-pressed="' + (d === ui.week) + '"><span class="dot st-' + s + '"></span>' + md(d) + '</button>';
    }).join('') + '</div>';
  }

  function legend() {
    return '<div class="legend" aria-label="이름 앞 점 표시"><span class="lg hell"><i>지옥도</i>지난번 전승</span><span class="lg heaven"><i>천국도</i>지난번 전패</span><span class="lg mid"><i>중립</i>1승 1패</span></div>';
  }

  function viewWeek() {
    var w = getWeek(ui.week), P = pm();
    var out = weekChips();
    if (!w || (!w.published && !ui.admin) || !w.matches.length) {
      var n = w ? Object.keys(w.attendees || {}).length : 0;
      var msg = !w || !w.matches.length ? '아직 편성이 없어요' : '돼장이 편성 중이에요';
      out += '<div class="card empty"><div class="pig" aria-hidden="true"></div><b>' + md(ui.week) + '(수) ' + msg + '</b>' +
        (n ? '<p class="muted">참석 신청 ' + n + '명 · 편성이 공개되면 여기에 경기가 떠요.</p>' : '<p class="muted">참석 인원이 정해지면 조별로 1인 2경기씩 편성해요.</p>') +
        (ui.admin ? '<button class="btn primary" data-act="tab" data-v="admin">편성하러 가기</button>' : '') + '</div>';
      return out;
    }
    var done = w.matches.filter(function (m) { return m.win; }).length;
    out += '<div class="daybar"><span class="day num">' + md(w.date) + '(수)</span><span class="pills"><span class="pill-s">참석 <b class="num">' + Object.keys(w.attendees).length + '</b>명</span><span class="pill-s">공식전 <b class="num">' + w.matches.length + '</b>경기</span><span class="pill-s">결과 <b class="num">' + done + '/' + w.matches.length + '</b></span></span></div>';
    if (ui.admin && !w.published) out += '<div class="banner warn">회원에게는 아직 안 보이는 편성이에요. 관리 › 공개에서 공개할 수 있어요.</div>';
    if (ui.admin) out += '<div class="banner info small"><span>이긴 팀을 누르면 승리로 기록돼요. 한 번 더 누르면 취소. 다 입력하고 아래 <b>저장</b>!</span></div>';
    out += legend();
    groups().forEach(function (g) {
      var ms = w.matches.filter(function (m) { return m.pool === g.id; });
      if (!ms.length) return;
      var ppl = {};
      ms.forEach(function (m) { m.a.concat(m.b).forEach(function (p) { if (p) ppl[p] = 1; }); });
      out += '<section class="group g' + g.id + '"><div class="ribbon"><h2>' + esc(g.name) + '조</h2><span class="num">' + Object.keys(ppl).length + '명 · ' + ms.length + '경기</span></div>';
      ms.forEach(function (m, i) {
        out += '<article class="match c' + (i % 5) + '"><div class="mbadge"><b class="num">' + (i + 1) + '</b>경기</div><div class="vsrow">';
        ['a', 'b'].forEach(function (side, si) {
          var st = m.win ? (m.win === side ? ' win' : ' lose') : '';
          var names = m[side].map(function (pid) { return plHtml(pid, m, w.date, P); }).join('<span class="sep">·</span>');
          var stamp = m.win === side ? '<span class="stamp">WIN</span>' : '';
          var tap = !m.win && ui.admin ? '<span class="tap">눌러서 승리</span>' : '';
          var cls = 'tpill ' + (side === 'a' ? 'pa' : 'pb') + st;
          if (ui.admin) out += '<button class="' + cls + '" data-act="win" data-m="' + m.id + '" data-side="' + side + '" aria-label="' + esc(m[side].map(function (p) { return P[p] ? P[p].name : ''; }).join(', ')) + ' 승리 기록">' + names + stamp + tap + '</button>';
          else out += '<div class="' + cls + '">' + names + stamp + '</div>';
          if (si === 0) out += '<span class="vs" aria-label="대">VS</span>';
        });
        out += '</div></article>';
      });
      out += '</section>';
    });
    var other = w.matches.filter(function (m) { return poolOrder(m.pool) === 99; });
    if (other.length) out += '<p class="muted small">조가 지정되지 않은 경기 ' + other.length + '개는 관리 화면에서 확인해 주세요.</p>';
    var issues = L.validateWeek(work, w);
    if (!issues.length) {
      var extras = [];
      groups().forEach(function (g) {
        w.matches.filter(function (m) { return m.pool === g.id; }).forEach(function (m, i) {
          (m.off || []).forEach(function (p) { extras.push((P[p] ? P[p].name : '?') + ' ' + (i + 1) + '경기'); });
        });
      });
      out += '<div class="allset"><strong>전원 공식전 <em>2경기</em>씩!</strong><p class="num">' + Object.keys(w.attendees).length + '명 전원 2경기 · 파트너 중복 없음</p>' +
        (extras.length ? '<p class="note">추가출전(기록 제외): ' + esc(extras.join(', ')) + '</p>' : '') + '</div>';
    }
    return out;
  }

  function viewRank() {
    var S = L.standings(work), P = pm();
    var meP = P[ui.me];
    var gid = ui.rankGroup || (meP ? meP.group : groups()[0].id);
    var g = groups().filter(function (x) { return x.id === gid; })[0] || groups()[0];
    var list = S[g.id] || [];
    var ds = L.wednesdays(work.settings.seasonStart, work.settings.seasonEnd);
    var remain = ds.filter(function (d) { return weekStatus(getWeek(d)) !== 'done'; }).length;
    var played = list.filter(function (r) { return r.wins + r.losses + r.pending > 0; });
    var idle = list.filter(function (r) { return r.wins + r.losses + r.pending === 0; });
    var out = '<div class="gsel" role="group" aria-label="조 선택">' + groups().map(function (x) {
      return '<button class="g' + x.id + '" data-act="rankg" data-v="' + x.id + '" aria-pressed="' + (x.id === g.id) + '">' + esc(x.name) + '</button>';
    }).join('') + '</div>';
    out += '<div class="rank-head"><h2>다승왕 <em class="num">' + g.winners + '</em>자리</h2><span class="muted small num">남은 수요일 ' + remain + '번 · 1인 최대 +' + remain * 2 + '승</span></div>';
    if (!played.length) {
      out += '<div class="card empty"><div class="pig" aria-hidden="true"></div><b>아직 입력된 결과가 없어요</b><p class="muted">돼장이 경기 결과를 입력하면 승수와 순위가 바로 계산돼요.</p></div>';
    } else {
      out += '<div class="board">' + played.map(function (r) {
        var tag = r.lottery ? ' <span class="chip lot">동률 추첨</span>' : r.contender ? ' <span class="chip king">다승왕권</span>' : '';
        var dec = r.wins + r.losses;
        return '<div class="rrow' + (r.contender ? ' contender' : '') + (r.id === ui.me ? ' me' : '') + '"><span class="medal num' + (r.rank <= 3 && r.wins > 0 ? ' m' + r.rank : '') + '">' + (dec ? r.rank : '–') + '</span>' +
          '<span class="rname"><b>' + esc(r.name) + tag + '</b><span class="num">' + r.wins + '승 ' + r.losses + '패' + (r.pending ? ' · 결과 미입력 ' + r.pending + '경기' : '') + ' · ' + r.weeks + '주 참가' + (dec ? ' · 승률 ' + Math.round(r.wins / dec * 100) + '%' : '') + '</span></span>' +
          '<span class="rwins"><b class="num">' + r.wins + '</b><span>승</span></span></div>';
      }).join('') + '</div>';
    }
    if (idle.length) out += '<details><summary>아직 기록 없는 ' + idle.length + '명</summary><p class="small muted">' + idle.map(function (r) { return esc(r.name); }).join(', ') + '</p></details>';
    out += '<p class="small muted">승수만으로 순위를 매기고, 최종 동률이면 추첨해요. 공식 2경기만 집계하고 추가출전·자유게임은 빠져요. 집계 기준: ' + (work.settings.countBy === 'pool' ? '경기한 조' : '등록된 조') + '.</p>';
    return out;
  }

  function mePicker() {
    return '<label class="f" for="me-select">내 이름<select id="me-select" data-act="me"><option value="">이름을 선택하세요</option>' +
      groups().map(function (g) {
        return '<optgroup label="' + esc(g.name) + '">' + work.players.filter(function (p) { return p.group === g.id && p.active !== false; })
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); })
          .map(function (p) { return '<option value="' + p.id + '"' + (p.id === ui.me ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</optgroup>';
      }).join('') + '</select></label>';
  }

  var FATE_TEXT = {
    hell: '치열한 승부, 살벌한 랠리. 지난번 전승의 대가예요.',
    heaven: '잠시 행복회로! 지난번 전패의 선물이에요.',
    mid: '1승 1패, 중간 난도로 편성돼요.',
    new: '아직 기록이 없어서 중간 난도로 편성돼요.',
    unknown: '지난 경기 결과가 입력되면 정해져요.',
  };
  function viewMe() {
    var P = pm(), me = P[ui.me];
    var out = mePicker();
    if (!me) return out + '<div class="card empty"><div class="pig" aria-hidden="true"></div><b>이름을 고르면 내 경기만 모아 보여 줘요</b><p class="muted">내 매칭, 누적 승수, 다음 주 지옥도·천국도 배정까지. 이 기기에만 기억돼요.</p></div>';
    var S = L.standings(work);
    var gid = work.settings.countBy === 'pool' ? null : me.group;
    var row = null, gsize = 0, gw = 1;
    Object.keys(S).forEach(function (k) {
      if (gid && k !== gid) return;
      var r = S[k].filter(function (x) { return x.id === me.id; })[0];
      if (r && (!row || r.wins > row.wins)) { row = r; gsize = S[k].filter(function (x) { return x.wins + x.losses + x.pending > 0; }).length; var g = groups().filter(function (x) { return x.id === k; })[0]; gw = g ? g.winners : 1; }
    });
    var nd = nextPlayDate(), tier = L.tierOf(work, me.id, nd);
    var ndLabel = md(nd === '9999-12-31' ? work.settings.seasonEnd : nd);
    out += '<div class="card"><div class="me-head"><h2>' + esc(me.name) + '</h2><span class="gdot g' + me.group + '">' + esc(gname(me.group)) + '조</span></div>' +
      '<div class="stat-row"><div class="stat' + (row && row.contender ? ' hl' : '') + '"><b class="num">' + (row && row.wins + row.losses ? row.rank + '위' : '–') + '</b><span>조 내 순위' + (gsize ? ' / ' + gsize + '명' : '') + '</span></div>' +
      '<div class="stat"><b class="num">' + (row ? row.wins : 0) + '승 ' + (row ? row.losses : 0) + '패</b><span>누적 공식전' + (row && row.pending ? ' · 결과 미입력 ' + row.pending : '') + '</span></div></div>' +
      (row && row.lottery ? '<p class="small"><span class="chip lot">동률 추첨</span> 지금 끝나면 다승왕 ' + gw + '자리를 두고 추첨 대상이에요.</p>' : row && row.contender ? '<p class="small"><span class="chip king">다승왕권</span> 지금 순위면 다승왕이에요!</p>' : '') +
      '</div>';
    out += '<div class="fate ' + tier.tier + '"><div class="sign" role="img" aria-label="' + TIER_LABEL[tier.tier] + '">' + '' + '</div>' +
      '<div class="ft"><small class="num">' + ndLabel + '(수) 내 배정' + (tier.date ? ' · ' + md(tier.date) + ' ' + tier.wins + '승 ' + tier.losses + '패' : '') + '</small><strong>' + TIER_LABEL[tier.tier] + '</strong><p>' + FATE_TEXT[tier.tier] + '</p></div></div>';
    var hist = work.weeks.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).filter(function (w) {
      return (w.published || ui.admin) && w.matches.some(function (m) { return m.a.concat(m.b).indexOf(me.id) >= 0; });
    });
    if (!hist.length) return out + '<div class="card empty"><b>아직 편성된 경기가 없어요</b></div>';
    out += '<div class="card"><h3>경기 기록</h3><div class="hist">' + hist.map(function (w) {
      var lines = '';
      groups().concat([{ id: null }]).forEach(function (g) {
        var ms = w.matches.filter(function (m) { return g.id ? m.pool === g.id : poolOrder(m.pool) === 99; });
        ms.forEach(function (m, i) {
          var side = m.a.indexOf(me.id) >= 0 ? 'a' : m.b.indexOf(me.id) >= 0 ? 'b' : null;
          if (!side) return;
          var mate = m[side].filter(function (p) { return p !== me.id; }).map(function (p) { return P[p] ? P[p].name : '?'; }).join('');
          var opp = m[side === 'a' ? 'b' : 'a'].map(function (p) { return P[p] ? P[p].name : '?'; }).join('·');
          var r = !L.isOfficial(m, me.id) ? '<span class="r p">추가출전</span>' : !m.win ? '<span class="r p">대기</span>' : m.win === side ? '<span class="r w">승</span>' : '<span class="r l">패</span>';
          lines += '<div class="hist-line"><span class="no num">' + (g.id ? i + 1 + '경기' : '경기') + '</span><span>' + esc(mate) + '와 · vs ' + esc(opp) + '</span>' + r + '</div>';
        });
      });
      return '<div class="hist-week"><b class="num">' + md(w.date) + '(수)</b>' + lines + '</div>';
    }).join('') + '</div></div>';
    return out;
  }

  // ---------- 관리 ----------
  function viewLock() {
    var hasPin = !!work.settings.pin;
    return '<div class="card lockcard"><div class="pig" aria-hidden="true"></div>' +
      '<h2>' + (hasPin ? '관리 화면 잠금 해제' : '관리 PIN 만들기') + '</h2>' +
      '<p class="muted small">' + (hasPin ? '돼장·운영진용 4자리 PIN을 입력하세요.' : '처음 한 번만 정해요. 오타 방지를 위해 같은 PIN을 두 번 입력해 주세요. 만든 뒤 저장해야 다른 기기에서도 열려요.') + '</p>' +
      '<form id="pin-form" class="row" style="justify-content:center;align-items:flex-end">' +
      '<label class="f pinf" for="pin1">' + (hasPin ? 'PIN 4자리' : '새 PIN 4자리') + '<input id="pin1" class="pin num" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></label>' +
      (hasPin ? '' : '<label class="f pinf" for="pin2">한 번 더 입력<input id="pin2" class="pin num" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></label>') +
      '<button class="btn primary" type="submit">' + (hasPin ? '열기' : 'PIN 만들기') + '</button></form>' +
      (ui.pinMsg ? '<p class="small" style="color:var(--err)">' + esc(ui.pinMsg) + '</p>' : '') +
      '<p class="muted small">PIN은 관리 화면을 여는 열쇠예요. 실제 저장은 이 앱의 편집 권한이 있는 계정에서만 돼요.</p></div>';
  }

  function viewAdmin() {
    if (!ui.admin) return viewLock();
    var out = '<div class="row" style="justify-content:space-between"><div class="seg" role="group" aria-label="관리 메뉴">' +
      [['plan', '참석·편성'], ['seeds', '실력 순위'], ['players', '선수'], ['settings', '설정']].map(function (s) {
        return '<button data-act="sec" data-v="' + s[0] + '" aria-pressed="' + (ui.sec === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div><button class="btn sm" data-act="lock">잠그기</button></div>';
    if (ui.sec === 'players') return out + viewPlayers();
    if (ui.sec === 'seeds') return out + viewSeeds();
    if (ui.sec === 'settings') return out + viewSettings();
    return out + viewPlan();
  }

  function viewPlan() {
    var w = getWeek(ui.week) || { date: ui.week, attendees: {}, matches: [], published: false };
    var P = pm(), att = w.attendees || {};
    var out = weekChips();
    // 1. 참석자
    out += '<div class="card"><div class="row" style="justify-content:space-between"><h2>' + md(w.date) + '(수) 참석자</h2><span class="muted num">' + Object.keys(att).length + '명</span></div>' +
      '<label class="f" for="paste">밴드 참가신청 명단 붙여넣기<textarea id="paste" placeholder="박강호(랍스터), 서민희(닭갈비), 조인규(닭갈비) …">' + esc(ui.paste) + '</textarea></label>' +
      '<div class="row"><button class="btn" data-act="paste-replace">명단으로 바꾸기</button><button class="btn" data-act="paste-add">명단 추가</button>' +
      (Object.keys(att).length ? '<button class="btn danger sm" data-act="att-clear">참석 비우기</button>' : '') + '</div>';
    if (w.note) out += '<p class="small muted">메모: ' + esc(w.note) + ' <button class="btn sm" data-act="note-clear">메모 지우기</button></p>';
    if (ui.unknown.length) {
      out += '<div class="banner warn" style="display:grid"><b>명단에 없는 이름 ' + ui.unknown.length + '명</b>' + ui.unknown.map(function (u, i) {
        return '<div class="row"><span>' + esc(u.name) + '</span><select id="unk-' + i + '" aria-label="' + esc(u.name) + ' 조">' + groups().map(function (g) {
          return '<option value="' + g.id + '"' + (u.group === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }).join('') + '</select><button class="btn sm primary" data-act="unk-add" data-i="' + i + '">선수로 추가하고 참석</button><button class="btn sm" data-act="unk-skip" data-i="' + i + '">무시</button></div>';
      }).join('') + '</div>';
    }
    groups().forEach(function (g) {
      var ps = work.players.filter(function (p) { return p.group === g.id && p.active !== false; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      var cnt = ps.filter(function (p) { return att[p.id]; }).length;
      out += '<div><div class="row small" style="margin-bottom:6px"><span class="gdot g' + g.id + '">' + esc(g.name) + '</span><span class="muted num">' + cnt + '/' + ps.length + '</span></div><div class="chips">' +
        ps.map(function (p) { return '<button data-act="att" data-p="' + p.id + '" aria-pressed="' + !!att[p.id] + '">' + esc(p.name) + '</button>'; }).join('') + '</div></div>';
    });
    var attIds = Object.keys(att).filter(function (id) { return P[id]; });
    if (attIds.length) {
      out += '<details><summary>편성 조 옮기기 (인원 맞출 때)</summary><div class="plist">' + attIds.sort(function (a, b) { return poolOrder(P[a].group) - poolOrder(P[b].group) || P[a].name.localeCompare(P[b].name, 'ko'); }).map(function (id) {
        return '<div class="prow"><span>' + esc(P[id].name) + ' <span class="muted small">(' + esc(gname(P[id].group)) + ')</span></span><select id="pool-' + id + '" data-act="pool" data-p="' + id + '" aria-label="' + esc(P[id].name) + ' 편성 조">' +
          groups().map(function (g) { return '<option value="' + g.id + '"' + (att[id] === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') + '</select><span></span></div>';
      }).join('') + '</div></details>';
    }
    out += '</div>';

    // 2. 편성
    out += '<div class="card"><div class="row" style="justify-content:space-between"><h2>편성</h2><button class="btn primary" data-act="gen-all"' + (attIds.length < 4 ? ' disabled' : '') + '>전체 자동 편성</button></div>' +
      '<p class="small muted">조마다 직전 참가 주 성적이 같은 사람끼리 묶어요(전승은 지옥도, 전패는 천국도). 전원 공식 2경기에 파트너가 겹치지 않게 짜고, 홀수 인원이면 2명이 추가출전(기록 제외)해요. 누를 때마다 새 편성이 나와요.</p>';
    if (ui.confirm) {
      out += '<div class="banner warn"><span>' + esc(ui.confirm.msg) + '</span><span class="row"><button class="btn sm primary" data-act="confirm-yes">바꾸기</button><button class="btn sm" data-act="confirm-no">취소</button></span></div>';
    }
    if (ui.busy && ui.busy.indexOf('편성') === 0) out += '<p class="small">' + esc(ui.busy) + '</p>';
    groups().forEach(function (g) {
      var pool = attIds.filter(function (id) { return att[id] === g.id; });
      var ms = w.matches.filter(function (m) { return m.pool === g.id; });
      if (!pool.length && !ms.length) return;
      out += '<div class="editor"><div class="group-head"><h3 class="gdot g' + g.id + '">' + esc(g.name) + ' · ' + pool.length + '명</h3><span class="row"><span class="muted small num">' + (pool.length >= 4 ? '필요 ' + Math.ceil(pool.length / 2) + '경기' : '4명 이상 필요') + '</span>' +
        '<button class="btn sm" data-act="gen" data-g="' + g.id + '"' + (pool.length < 4 ? ' disabled' : '') + '>자동 편성</button></span></div>';
      if (pool.length) out += '<p class="small"><span class="muted">실력순 </span>' + pool.slice().sort(function (x, y) { return L.strengthOf(work, y, w.date, g.id) - L.strengthOf(work, x, w.date, g.id); }).map(function (id) {
        var t = L.tierOf(work, id, w.date).tier;
        return '<span class="pl ' + (t === 'hell' || t === 'heaven' || t === 'mid' ? 't-' + t : '') + '">' + esc(P[id].name) + '</span>';
      }).join(' ') + '</p>';
      ms.forEach(function (m, i) { out += editMatch(m, i, w, attIds, P); });
      out += '<div><button class="btn sm" data-act="add-match" data-g="' + g.id + '">+ 경기 추가</button></div></div>';
    });
    var orphan = w.matches.filter(function (m) { return poolOrder(m.pool) === 99; });
    orphan.forEach(function (m, i) { out += editMatch(m, i, w, attIds, P); });
    out += '</div>';

    // 3. 검증
    var issues = w.matches.length || attIds.length ? L.validateWeek(work, w) : [];
    out += '<div class="card"><h2>점검</h2><ul class="issues">' + (issues.length ? issues.map(function (x) { return '<li class="' + x.level + '">' + esc(x.msg) + '</li>'; }).join('') :
      w.matches.length ? '<li class="ok">참석자 전원 공식 2경기, 파트너 중복 없음</li>' : '<li class="warn">아직 경기가 없어요</li>') + '</ul></div>';

    // 4. 공개
    out += '<div class="card"><h2>공개 · 공지</h2><div class="row"><button class="btn ' + (w.published ? '' : 'primary') + '" data-act="publish"' + (w.matches.length ? '' : ' disabled') + '>' + (w.published ? '공개 취소' : '회원에게 편성 공개') + '</button>' +
      '<button class="btn" data-act="notice"' + (w.matches.length ? '' : ' disabled') + '>밴드 공지 글 복사</button></div>' +
      '<p class="small muted">' + (w.published ? '공개 중이에요. 저장해야 회원 화면에 반영돼요.' : '공개 전에는 관리 모드에서만 보여요.') + '</p>' +
      (ui.notice ? '<label class="f" for="notice-box">공지 글 (길게 눌러 전체 선택 후 복사)<textarea id="notice-box" class="copybox" readonly>' + esc(ui.notice) + '</textarea></label>' : '') + '</div>';
    return out;
  }

  function seedsObj() { return L.decodeSeeds(work.settings.seeds); }
  function setSeeds(o) { work.settings.seeds = L.encodeSeeds(o); }
  function seedList(gid) {
    var P = pm();
    return (seedsObj()[gid] || []).filter(function (id) { return P[id] && P[id].group === gid && P[id].active !== false; });
  }
  function viewSeeds() {
    var gid = ui.seedGroup, g = groups().filter(function (x) { return x.id === gid; })[0] || groups()[0];
    gid = g.id;
    var P = pm(), list = seedList(gid);
    var all = work.players.filter(function (p) { return p.group === gid && p.active !== false; });
    var rest = all.filter(function (p) { return list.indexOf(p.id) < 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    var out = '<div class="gsel" role="group" aria-label="조 선택">' + groups().map(function (x) {
      return '<button class="g' + x.id + '" data-act="seedg" data-v="' + x.id + '" aria-pressed="' + (x.id === gid) + '">' + esc(x.name) + '</button>';
    }).join('') + '</div>';
    out += '<div class="card"><div class="row" style="justify-content:space-between"><h2>' + esc(g.name) + ' 실력 순위</h2><span class="muted num">' + list.length + '/' + all.length + '명</span></div>' +
      '<p class="small muted">잘하는 순서예요. 자동 편성 때 두 팀 실력 합을 맞추는 데 쓰고, 경기가 쌓이면 실제 승률 비중이 점점 커져요(6경기쯤 반반). 회원 화면에는 나오지 않아요.</p>' +
      '<label class="f" for="seed-text">한 번에 입력 (한 줄에 한 명, 잘하는 순서대로)<textarea id="seed-text" placeholder="1. 유성준&#10;2. 김성곤&#10;3. 조영재">' + esc(ui.seedText[gid] || '') + '</textarea></label>' +
      '<div class="row"><button class="btn primary" data-act="seed-apply">이 순서로 덮어쓰기</button>' + (list.length ? '<button class="btn sm danger" data-act="seed-clear">순위 비우기</button>' : '') + '</div>';
    if (list.length) {
      out += '<ol class="seedlist">' + list.map(function (id, i) {
        return '<li><span class="medal num' + (i < 3 ? ' m' + (i + 1) : '') + '">' + (i + 1) + '</span><b>' + esc(P[id].name) + '</b>' +
          '<span class="row"><button class="btn sm" data-act="seed-up" data-p="' + id + '"' + (i ? '' : ' disabled') + ' aria-label="' + esc(P[id].name) + ' 위로">▲</button>' +
          '<button class="btn sm" data-act="seed-down" data-p="' + id + '"' + (i < list.length - 1 ? '' : ' disabled') + ' aria-label="' + esc(P[id].name) + ' 아래로">▼</button>' +
          '<button class="btn sm" data-act="seed-out" data-p="' + id + '" aria-label="' + esc(P[id].name) + ' 순위에서 빼기">빼기</button></span></li>';
      }).join('') + '</ol>';
    }
    if (rest.length) out += '<div><p class="small muted" style="margin-bottom:6px">순위 미정 ' + rest.length + '명 · 누르면 맨 아래에 추가돼요 (미정은 중간 실력으로 계산)</p><div class="chips">' +
      rest.map(function (p) { return '<button data-act="seed-add" data-p="' + p.id + '">' + esc(p.name) + '</button>'; }).join('') + '</div></div>';
    out += '</div><p class="small muted">시드는 페이지 데이터에 화면에 안 보이게 담겨요. 다만 개발자 도구까지 열어 보는 사람에게 완전히 숨겨지지는 않아요.</p>';
    return out;
  }

  function editMatch(m, i, w, attIds, P) {
    var opts = function (cur) {
      var ids = attIds.slice();
      if (cur && ids.indexOf(cur) < 0) ids.push(cur);
      return '<option value="">— 빈 자리 —</option>' + groups().map(function (g) {
        var inG = ids.filter(function (id) { return (w.attendees[id] || (P[id] && P[id].group)) === g.id; });
        if (!inG.length) return '';
        return '<optgroup label="' + esc(g.name) + '">' + inG.sort(function (a, b) { return (P[a] ? P[a].name : '').localeCompare(P[b] ? P[b].name : '', 'ko'); }).map(function (id) {
          return '<option value="' + id + '"' + (id === cur ? ' selected' : '') + '>' + esc(P[id] ? P[id].name : id) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
    };
    var team = function (side) {
      return '<div class="ed-team">' + [0, 1].map(function (k) {
        var pid = m[side][k] || '';
        var off = pid && !L.isOfficial(m, pid);
        return '<div class="slot"><select id="s-' + m.id + '-' + side + k + '" data-act="slot" data-m="' + m.id + '" data-side="' + side + '" data-k="' + k + '" aria-label="' + (i + 1) + '경기 ' + (side === 'a' ? '왼쪽' : '오른쪽') + ' 팀 ' + (k + 1) + '번">' + opts(pid) + '</select>' +
          '<button data-act="off" data-m="' + m.id + '" data-p="' + pid + '" aria-pressed="' + !!off + '"' + (pid ? '' : ' disabled') + ' title="추가출전이면 기록 제외">' + (off ? '제외' : '공식') + '</button></div>';
      }).join('') + '</div>';
    };
    var res = m.win ? '<span class="chip king">' + (m.win === 'a' ? '왼쪽' : '오른쪽') + ' 승</span>' : '';
    var full = m.a.concat(m.b).every(Boolean);
    if (full) {
      var st = function (t) { return L.strengthOf(work, t[0], w.date, m.pool) + L.strengthOf(work, t[1], w.date, m.pool); };
      var bal = L.balanceOf(st(m.a), st(m.b));
      res = '<span class="chip bal-' + bal + '">' + { even: '밸런스 좋음', ok: '밸런스 보통', lopsided: '한쪽 우세' }[bal] + '</span>' + res;
    }
    return '<div class="ed-match"><div class="ed-head"><b class="num">' + (i + 1) + '경기</b><span class="row">' + res + '<button class="btn sm danger" data-act="del-match" data-m="' + m.id + '">삭제</button></span></div>' +
      '<div class="ed-teams">' + team('a') + '<span class="ed-vs">vs</span>' + team('b') + '</div></div>';
  }

  function viewPlayers() {
    var out = '<div class="card"><h2>선수 추가</h2><form id="add-player" class="row"><input id="np-name" type="text" placeholder="이름" maxlength="10" aria-label="이름" style="flex:1 1 140px">' +
      '<select id="np-group" aria-label="조">' + groups().map(function (g) { return '<option value="' + g.id + '">' + esc(g.name) + '</option>'; }).join('') + '</select>' +
      '<button class="btn primary" type="submit">추가</button></form></div>';
    groups().forEach(function (g) {
      var ps = work.players.filter(function (p) { return p.group === g.id; });
      out += '<div class="card"><div class="row" style="justify-content:space-between"><h2 class="gdot g' + g.id + '">' + esc(g.name) + '</h2><span class="muted num">' + ps.filter(function (p) { return p.active !== false; }).length + '명</span></div><div class="plist">' +
        ps.map(function (p) {
          return '<div class="prow' + (p.active === false ? ' off' : '') + '"><input id="pn-' + p.id + '" type="text" value="' + esc(p.name) + '" data-act="pname" data-p="' + p.id + '" aria-label="이름">' +
            '<select id="pg-' + p.id + '" data-act="pgroup" data-p="' + p.id + '" aria-label="' + esc(p.name) + ' 조">' + groups().map(function (x) { return '<option value="' + x.id + '"' + (x.id === p.group ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
            '<button class="btn sm" data-act="pactive" data-p="' + p.id + '">' + (p.active === false ? '복귀' : '휴면') + '</button></div>';
        }).join('') + '</div></div>';
    });
    out += '<p class="small muted">조를 옮기면 등록 조 기준 집계에서 지난 승수도 새 조로 따라가요. 휴면 선수는 명단과 순위에서 숨겨지고 기록은 남아요.</p>';
    return out;
  }

  function viewSettings() {
    var s = work.settings;
    return '<div class="card"><h2>승수 집계 기준</h2>' +
      '<p class="small muted">다른 조 경기에 나간 승수를 어느 조 다승왕 경쟁에 넣을지 정해요. (예: 소갈비·양갈비 이태훈이 10/7 돼지갈비·닭갈비 경기 출전)</p>' +
      '<div class="seg" role="group" aria-label="집계 기준"><button data-act="countby" data-v="registered" aria-pressed="' + (s.countBy !== 'pool') + '">등록된 조</button><button data-act="countby" data-v="pool" aria-pressed="' + (s.countBy === 'pool') + '">경기한 조</button></div></div>' +
      '<div class="card"><h2>조별 다승왕 수</h2><div class="plist">' + s.groups.map(function (g) {
        return '<div class="prow"><span class="gdot g' + g.id + '">' + esc(g.name) + '</span><input id="gw-' + g.id + '" type="number" min="1" max="5" value="' + g.winners + '" data-act="winners" data-g="' + g.id + '" style="width:72px" aria-label="' + esc(g.name) + ' 다승왕 수"><span>명</span></div>';
      }).join('') + '</div></div>' +
      '<div class="card"><h2>관리 PIN 바꾸기</h2><form id="pin-change" class="row" style="align-items:flex-end"><label class="f pinf" for="pc1">새 PIN<input id="pc1" class="pin num" type="password" inputmode="numeric" maxlength="4"></label><label class="f pinf" for="pc2">한 번 더 입력<input id="pc2" class="pin num" type="password" inputmode="numeric" maxlength="4"></label><button class="btn" type="submit">바꾸기</button></form></div>' +
      '<div class="card"><h2>내보내기</h2><p class="small muted">엑셀에서 열 수 있는 CSV와, 나중에 서버로 옮길 때 쓸 전체 데이터(JSON)를 받을 수 있어요.</p><div class="row">' +
      (api.downloads ? '<button class="btn" data-act="dl-standings">순위 CSV</button><button class="btn" data-act="dl-matches">경기 기록 CSV</button><button class="btn" data-act="dl-json">전체 데이터 JSON</button>' : '<span class="small muted">이 화면에서는 파일 내려받기를 쓸 수 없어요.</span>') +
      '</div><p class="small muted num">마지막 저장: ' + (saved.savedAt ? new Date(saved.savedAt).toLocaleString('ko-KR') : '-') + ' · 버전 ' + saved.rev + '</p></div>';
  }

  function saveBar() {
    var b = '';
    if (ui.draftConflict) {
      b += '<div class="banner warn">이 기기에 저장 못 한 변경이 있는데, 그사이 다른 곳에서 새로 저장됐어요.<span class="row"><button class="btn sm" data-act="draft-load">내 변경 불러오기</button><button class="btn sm" data-act="draft-drop">버리기</button></span></div>';
    }
    return b;
  }

  function render() {
    var app = document.getElementById('app');
    var focusId = document.activeElement && document.activeElement.id;
    var main = ui.tab === 'rank' ? viewRank() : ui.tab === 'me' ? viewMe() : ui.tab === 'admin' ? viewAdmin() : viewWeek();
    var html = header() + '<main>' + saveBar() + main + '</main>';
    if (dirty() || ui.busy && ui.busy.indexOf('편성') !== 0) {
      html += '<div class="savebar" role="region" aria-label="저장"><div class="in"><span>' + esc(ui.busy || '저장 안 된 변경이 있어요') + '</span>' +
        (ui.busy ? '' : '<span class="row"><button class="btn sm" data-act="revert">되돌리기</button><button class="btn sm primary" data-act="save">저장</button></span>') + '</div></div>';
    }
    if (ui.toast) html += '<div class="toast" role="status">' + esc(ui.toast) + '</div>';
    app.innerHTML = html;
    if (focusId) { var f = document.getElementById(focusId); if (f && f.focus) try { f.focus({ preventScroll: true }); } catch (e) { } }
  }

  // ---------- 동작 ----------
  function findMatch(id) {
    var w = getWeek(ui.week);
    return w ? w.matches.filter(function (m) { return m.id === id; })[0] : null;
  }
  function applyAttendees(ids, replace) {
    var w = ensureWeek(ui.week), P = pm();
    if (replace) w.attendees = {};
    ids.forEach(function (id) { if (!w.attendees[id]) w.attendees[id] = P[id].group; });
  }
  function runGen(gids) {
    ui.busy = '편성 중…'; render();
    setTimeout(function () {
      var w = ensureWeek(ui.week), errs = [];
      gids.forEach(function (gid) {
        var ids = Object.keys(w.attendees).filter(function (id) { return w.attendees[id] === gid && pm()[id]; });
        if (!ids.length) return;
        var ps = ids.map(function (id) { return { id: id, heat: L.HEAT[L.tierOf(work, id, w.date).tier], skill: L.strengthOf(work, id, w.date, gid) }; });
        var r = L.generatePool(ps, (Math.random() * 4294967296) >>> 0);
        if (r.error) { errs.push(gname(gid) + ': ' + r.error); return; }
        w.matches = w.matches.filter(function (m) { return m.pool !== gid; }).concat(r.matches.map(function (m) {
          return { id: newId(), pool: gid, a: m.a, b: m.b, off: m.off, win: null, score: '' };
        }));
      });
      sortMatches(w);
      ui.busy = null;
      commit();
      if (errs.length) toast(errs.join(' / '));
      else toast('편성했어요. 점검 결과를 확인하고 저장해 주세요.');
    }, 30);
  }
  function askGen(gids) {
    var w = getWeek(ui.week);
    var exist = w ? w.matches.filter(function (m) { return gids.indexOf(m.pool) >= 0; }) : [];
    if (exist.length) {
      var hasRes = exist.some(function (m) { return m.win; });
      ui.confirm = { msg: '기존 ' + exist.length + '경기' + (hasRes ? '(결과 포함)' : '') + '를 새 편성으로 바꿀까요?', gids: gids };
      render();
    } else runGen(gids);
  }
  function noticeText(w) {
    var P = pm(), lines = ['[' + work.settings.club + ' 수요 다승왕전 ' + md(w.date) + '(수) 공식전 편성]', ''];
    groups().forEach(function (g) {
      var ms = w.matches.filter(function (m) { return m.pool === g.id; });
      if (!ms.length) return;
      lines.push('■ ' + g.name + '조');
      var extra = [];
      ms.forEach(function (m, i) {
        var n = function (t) { return t.map(function (p) { return P[p] ? P[p].name : '?'; }).join('·'); };
        lines.push((i + 1) + '경기  ' + n(m.a) + ' vs ' + n(m.b));
        (m.off || []).forEach(function (p) { extra.push((P[p] ? P[p].name : '?') + ' ' + (i + 1) + '경기'); });
      });
      if (extra.length) lines.push('※ 추가출전(기록 제외): ' + extra.join(', '));
      lines.push('');
    });
    lines.push('전원 공식 2경기씩! 부상 없이 즐겁게 🏸');
    return lines.join('\n');
  }
  function csv(rows) { return '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); }
  function download(name, data) {
    if (!api.downloads) { toast('이 화면에서는 내려받기를 쓸 수 없어요.'); return; }
    api.downloads.save({ filename: name, data: data }).then(function () { toast('내려받았어요.'); }).catch(function (e) {
      if (e && e.code === 'declined') return;
      toast('내려받지 못했어요.');
    });
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    var w, m, P;
    switch (act) {
      case 'tab': ui.tab = v; LS.set(KEY.tab, v); ui.notice = null; render(); window.scrollTo(0, 0); break;
      case 'week': ui.week = v; SS.set(SKEY.week, v); ui.confirm = null; ui.notice = null; render(); break;
      case 'rankg': ui.rankGroup = v; render(); break;
      case 'sec': ui.sec = v; SS.set(SKEY.sec, v); render(); break;
      case 'lock': ui.admin = false; SS.del(SKEY.admin); render(); break;
      case 'win':
        m = findMatch(el.getAttribute('data-m')); if (!m) return;
        m.win = m.win === el.getAttribute('data-side') ? null : el.getAttribute('data-side');
        commit(); break;
      case 'att':
        w = ensureWeek(ui.week); var pid = el.getAttribute('data-p');
        if (w.attendees[pid]) delete w.attendees[pid]; else w.attendees[pid] = pm()[pid].group;
        commit(); break;
      case 'att-clear': w = ensureWeek(ui.week); w.attendees = {}; commit(); break;
      case 'note-clear': w = getWeek(ui.week); if (w) delete w.note; commit(); break;
      case 'paste-replace': case 'paste-add':
        var r = L.parseBand(ui.paste, work.players);
        if (!r.matched.length && !r.unknown.length) { toast('명단에서 이름을 찾지 못했어요. "이름(조)" 형식인지 확인해 주세요.'); return; }
        applyAttendees(r.matched, act === 'paste-replace');
        ui.unknown = r.unknown;
        toast(r.matched.length + '명 반영' + (r.unknown.length ? ', 명단에 없는 이름 ' + r.unknown.length + '명' : ''));
        commit(); break;
      case 'unk-add':
        var i = +el.getAttribute('data-i'), u = ui.unknown[i];
        var sel = document.getElementById('unk-' + i);
        var np = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: u.name, group: sel ? sel.value : (u.group || groups()[0].id) };
        work.players.push(np);
        applyAttendees([np.id], false);
        ui.unknown.splice(i, 1);
        commit(); break;
      case 'unk-skip': ui.unknown.splice(+el.getAttribute('data-i'), 1); render(); break;
      case 'gen': askGen([el.getAttribute('data-g')]); break;
      case 'gen-all': askGen(groups().map(function (g) { return g.id; })); break;
      case 'confirm-yes': var c = ui.confirm; ui.confirm = null; runGen(c.gids); break;
      case 'confirm-no': ui.confirm = null; render(); break;
      case 'add-match':
        w = ensureWeek(ui.week);
        w.matches.push({ id: newId(), pool: el.getAttribute('data-g'), a: ['', ''], b: ['', ''], off: [], win: null, score: '' });
        sortMatches(w); commit(); break;
      case 'del-match':
        w = getWeek(ui.week); var mid = el.getAttribute('data-m');
        w.matches = w.matches.filter(function (x) { return x.id !== mid; }); commit(); break;
      case 'off':
        m = findMatch(el.getAttribute('data-m')); var p2 = el.getAttribute('data-p'); if (!m || !p2) return;
        m.off = m.off || [];
        if (m.off.indexOf(p2) >= 0) m.off = m.off.filter(function (x) { return x !== p2; }); else m.off.push(p2);
        commit(); break;
      case 'publish': w = getWeek(ui.week); if (!w) return; w.published = !w.published; commit(); break;
      case 'notice':
        w = getWeek(ui.week); if (!w) return;
        var text = noticeText(w); ui.notice = text;
        var done = function (ok) { render(); if (ok) toast('공지 글을 복사했어요. 밴드에 붙여 넣으세요.'); else { toast('아래 글을 길게 눌러 복사해 주세요.'); var b = document.getElementById('notice-box'); if (b) b.select(); } };
        try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
        break;
      case 'pactive': P = pm(); var pp = P[el.getAttribute('data-p')]; pp.active = pp.active === false ? true : false; if (pp.active) delete pp.active; commit(); break;
      case 'countby': work.settings.countBy = v; commit(); break;
      case 'seedg': ui.seedGroup = v; render(); break;
      case 'seed-apply':
        var sg = ui.seedGroup, ord = L.parseOrder(ui.seedText[sg] || '', work.players.filter(function (p) { return p.group === sg && p.active !== false; }));
        if (!ord.ids.length) { toast('이 조 명단에서 이름을 찾지 못했어요.'); return; }
        var so = seedsObj(); so[sg] = ord.ids; setSeeds(so); ui.seedText[sg] = '';
        commit(); toast(ord.ids.length + '명 순위 적용' + (ord.unknown.length ? ' · 이 조에 없는 이름: ' + ord.unknown.join(', ') : '')); break;
      case 'seed-clear': var sc = seedsObj(); delete sc[ui.seedGroup]; setSeeds(sc); commit(); break;
      case 'seed-up': case 'seed-down': case 'seed-out': case 'seed-add':
        var so2 = seedsObj(), lst = seedList(ui.seedGroup), sp = el.getAttribute('data-p'), ix = lst.indexOf(sp);
        if (act === 'seed-add') { if (ix < 0) lst.push(sp); }
        else if (act === 'seed-out') { lst.splice(ix, 1); }
        else { var j = act === 'seed-up' ? ix - 1 : ix + 1; if (ix < 0 || j < 0 || j >= lst.length) return; var tmp = lst[ix]; lst[ix] = lst[j]; lst[j] = tmp; }
        so2[ui.seedGroup] = lst; setSeeds(so2); commit(); break;
      case 'save': save(); break;
      case 'revert': work = clone(saved); LS.del(KEY.draft); ui.unknown = []; ui.confirm = null; render(); toast('저장된 상태로 되돌렸어요.'); break;
      case 'draft-load': work = ui.draftConflict.state; ui.draftConflict = null; work.rev = saved.rev; commit(); toast('내 변경을 불러왔어요. 저장하면 최신 버전을 덮어써요.'); break;
      case 'draft-drop': ui.draftConflict = null; LS.del(KEY.draft); render(); break;
      case 'dl-standings':
        var S = L.standings(work), rows = [['조', '순위', '이름', '승', '패', '결과대기', '참가주', '다승왕권', '추첨대상']];
        groups().forEach(function (g) { (S[g.id] || []).forEach(function (r) { rows.push([g.name, r.rank, r.name, r.wins, r.losses, r.pending, r.weeks, r.contender ? 'O' : '', r.lottery ? 'O' : '']); }); });
        download('다승왕전_순위_' + todayKST() + '.csv', csv(rows)); break;
      case 'dl-matches':
        P = pm(); var mr = [['날짜', '조', '경기', '왼쪽1', '왼쪽2', '오른쪽1', '오른쪽2', '승리', '기록제외']];
        work.weeks.forEach(function (wk) {
          groups().forEach(function (g) {
            wk.matches.filter(function (x) { return x.pool === g.id; }).forEach(function (x, k) {
              var nm = function (id) { return P[id] ? P[id].name : ''; };
              mr.push([wk.date, g.name, k + 1, nm(x.a[0]), nm(x.a[1]), nm(x.b[0]), nm(x.b[1]), x.win === 'a' ? '왼쪽' : x.win === 'b' ? '오른쪽' : '', (x.off || []).map(nm).join(' ')]);
            });
          });
        });
        download('다승왕전_경기기록_' + todayKST() + '.csv', csv(mr)); break;
      case 'dl-json': download('다승왕전_데이터_' + todayKST() + '.json', JSON.stringify(work, null, 2)); break;
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target, act = el.getAttribute('data-act');
    if (!act) return;
    var m, P = pm();
    switch (act) {
      case 'me': ui.me = el.value; if (el.value) LS.set(KEY.me, el.value); else LS.del(KEY.me); ui.rankGroup = null; render(); break;
      case 'slot':
        m = findMatch(el.getAttribute('data-m')); if (!m) return;
        m[el.getAttribute('data-side')][+el.getAttribute('data-k')] = el.value;
        m.off = (m.off || []).filter(function (p) { return m.a.concat(m.b).indexOf(p) >= 0; });
        commit(); break;
      case 'pool': ensureWeek(ui.week).attendees[el.getAttribute('data-p')] = el.value; commit(); break;
      case 'pname':
        var nm = el.value.trim();
        if (!nm) { render(); return; }
        if (work.players.some(function (p) { return p.name === nm && p.id !== el.getAttribute('data-p'); })) { toast('같은 이름이 이미 있어요. 동명이인이면 "김민수B"처럼 구분해 주세요.'); render(); return; }
        P[el.getAttribute('data-p')].name = nm; commit(); break;
      case 'pgroup': P[el.getAttribute('data-p')].group = el.value; commit(); break;
      case 'winners': var g = work.settings.groups.filter(function (x) { return x.id === el.getAttribute('data-g'); })[0]; g.winners = Math.max(1, Math.min(5, +el.value || 1)); commit(); break;
    }
  });
  document.addEventListener('input', function (ev) { if (ev.target.id === 'paste') ui.paste = ev.target.value; if (ev.target.id === 'seed-text') ui.seedText[ui.seedGroup] = ev.target.value; });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (f.id === 'pin-form') {
      var p1 = document.getElementById('pin1').value, p2el = document.getElementById('pin2');
      if (!/^\d{4}$/.test(p1)) { ui.pinMsg = '숫자 4자리를 입력하세요.'; render(); return; }
      if (work.settings.pin) {
        if (pinHash(p1, work.settings.pin.salt) === work.settings.pin.hash) { ui.admin = true; ui.pinMsg = ''; SS.set(SKEY.admin, '1'); render(); }
        else { ui.pinMsg = 'PIN이 맞지 않아요.'; render(); }
      } else {
        if (!p2el || p2el.value !== p1) { ui.pinMsg = '두 PIN이 달라요.'; render(); return; }
        var salt = Math.random().toString(36).slice(2, 10);
        work.settings.pin = { salt: salt, hash: pinHash(p1, salt) };
        ui.admin = true; ui.pinMsg = ''; SS.set(SKEY.admin, '1');
        commit(); toast('PIN을 만들었어요. 저장해야 다른 기기에서도 적용돼요.');
      }
    } else if (f.id === 'pin-change') {
      var a = document.getElementById('pc1').value, b = document.getElementById('pc2').value;
      if (!/^\d{4}$/.test(a) || a !== b) { toast('새 PIN 4자리를 두 번 똑같이 입력하세요.'); return; }
      var s2 = Math.random().toString(36).slice(2, 10);
      work.settings.pin = { salt: s2, hash: pinHash(a, s2) };
      commit(); toast('PIN을 바꿨어요. 저장해야 적용돼요.');
    } else if (f.id === 'add-player') {
      var nm = document.getElementById('np-name').value.trim(), g = document.getElementById('np-group').value;
      if (!nm) return;
      if (work.players.some(function (p) { return p.name === nm; })) { toast('같은 이름이 이미 있어요.'); return; }
      work.players.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: nm, group: g });
      commit(); toast(nm + ' 선수를 추가했어요.');
    }
  });

  render();
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('artifact').then(function (a) { api.artifact = a; }, function () { });
    window.claude.use('downloads').then(function (d) { api.downloads = d; render(); }, function () { });
  }
})();
