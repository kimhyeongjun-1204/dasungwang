(function () {
  'use strict';
  var L = window.Logic, R = window.Remote;
  var KEY = { me: 'ddw-me', draft: 'ddw-draft', tab: 'ddw-tab', wview: 'ddw-wview' };
  var SKEY = { week: 'ddw-week', sec: 'ddw-sec' };

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

  var saved = null, work = null; // Supabase에서 읽은 뒤 start()에서 채움
  var remote = null, token = null, pinBusy = false;
  var ui = {
    tab: LS.get(KEY.tab) || 'week',
    week: SS.get(SKEY.week) || null,
    me: LS.get(KEY.me) || '',
    wview: LS.get(KEY.wview) || 'mine',   // 이번 주 탭: 'mine'(내 경기) | 'all'. 기본 내 경기 (사용자 요청 2026-11-20)
    admin: false,
    op: false,      // 진행 도우미(진행 PIN): 이번 주 탭의 경기 진행만
    saveError: null,
    sec: SS.get(SKEY.sec) || 'plan',
    rankGroup: null,
    seedGroup: 'A',
    planGroup: 'A',
    seedText: {},
    paste: '',
    ai: { text: '', busy: false, err: '', res: null }, // 돼장 요청(Claude) 상태
    shiftSel: { p: '', dir: 'up' }, // 지옥도·천국도 조 옮기기 선택
    unknown: [],
    confirm: null,
    draftConflict: null,
    toast: null,
    busy: null,
    pinMsg: '',
    notice: null,
  };

  // 저장 안 된 변경(이 기기) 복원
  function restoreDraft() {
    var raw = LS.get(KEY.draft);
    if (!raw) return;
    var d; try { d = JSON.parse(raw); } catch (e) { LS.del(KEY.draft); return; }
    if (!d || !d.state || same(d.state, saved)) { LS.del(KEY.draft); return; }
    if (d.baseRev === saved.rev) work = d.state;
    else ui.draftConflict = d;
  }

  // 관리자 잠금 해제: 서버가 발급한 30일 토큰을 이 기기에 기억. PIN이 바뀌면 서버에서 무효
  function rememberAdmin(t) { token = t; R.saveToken(LS, t, Date.now()); }
  function dropAdmin() { token = null; ui.op = false; R.clearToken(LS); }
  function forgetAdmin() { if (token && remote) remote.logout(token).catch(function () { }); dropAdmin(); }
  function pm() { var m = {}; work.players.forEach(function (p) { m[p.id] = p; }); return m; }
  function groups() { return work.settings.groups; }
  function gname(id) { var g = groups().filter(function (x) { return x.id === id; })[0]; return g ? g.name : id; }
  function seasonDates() {
    var ds = L.seasonDays(work.settings);
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

  // ---------- 저장 (Supabase save_state RPC, rev가 맞을 때만) ----------
  function save() {
    if (ui.busy) return;
    if (!ui.admin || !token) {
      ui.saveError = '관리 탭에서 PIN으로 잠금을 해제해야 저장할 수 있어요.';
      render(); return;
    }
    ui.saveError = null;
    var base = saved.rev, next = clone(work);
    LS.set(KEY.draft, JSON.stringify({ baseRev: base, state: work, at: Date.now() }));
    ui.busy = '저장 중…'; render();
    remote.save(token, next, base).then(function (rev) {
      next.rev = rev; next.savedAt = new Date().toISOString();
      saved = next; work = clone(next); LS.del(KEY.draft);
      ui.busy = null; live.stateAt = Date.now(); toast('저장했어요.');
    }).catch(function (e) {
      ui.busy = null;
      var code = e && e.code;
      if (code === 'stale_rev') {
        // 다른 곳에서 먼저 저장됨: 최신 버전을 불러오고 내 변경은 기존 충돌 안내(draftConflict)로 남김
        var mine = { baseRev: base, state: work, at: Date.now() };
        remote.load().then(function (s) {
          saved = s; work = clone(s); ui.draftConflict = mine;
          toast('다른 곳에서 먼저 저장됐어요. 새 버전으로 다시 불러와요.');
        }, function () {
          ui.saveError = '다른 곳에서 먼저 저장됐는데 새 버전을 불러오지 못했어요. 새로고침해 주세요. 내 변경은 이 기기에 남아 있어요.'; render();
        });
        return;
      }
      if (code === 'unauthorized') {
        dropAdmin(); ui.admin = false; ui.pinMsg = '관리자 로그인이 만료됐어요. PIN을 다시 입력하세요.';
        ui.saveError = '관리자 로그인이 만료돼서 저장하지 못했어요. 관리 탭에서 PIN을 다시 입력한 뒤 저장해 주세요.';
      } else if (code === 'network') ui.saveError = '인터넷에 연결되지 않아 저장하지 못했어요. 연결을 확인하고 다시 저장해 주세요.';
      else if (code === 'too_large') ui.saveError = '데이터가 너무 커서 저장하지 못했어요.';
      else ui.saveError = '저장하지 못했어요 (' + (code || '알 수 없는 오류') + '). 잠시 후 다시 시도해 주세요.';
      render();
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
    var ds = L.seasonDays(work.settings);
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
      '<span class="hero-side hell" aria-hidden="true">지옥도</span><span class="hero-side heaven" aria-hidden="true">천국도</span></header>' +
      '<div class="season"><span class="season-label">시즌 진행</span><div class="season-bar" aria-label="시즌 진행 ' + done + '/' + ds.length + '주">' + bar + '</div><span class="season-txt num">' + md(ds[0]) + '–' + md(ds[ds.length - 1]) + ' · ' + done + '/' + ds.length + '주 완료</span></div>' +
      '<nav class="tabs" role="tablist">' + [['week', '이번 주'], ['rank', '순위'], ['plan', '예측'], ['me', '내 기록'], ['admin', '관리']].map(function (t) {
        return '<button role="tab" data-act="tab" data-v="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + t[1] + (t[0] === 'admin' && !ui.admin ? ' <span class="lock">PIN</span>' : '') + '</button>';
      }).join('') + '</nav>';
  }

  // 팀 배너: 팀 배경 + 원본 캐릭터 2명 + 팀명/정보 (이벤트 비주얼 영역)
  var TEAM_CHARS = { A: ['cv', 'lb'], B: ['bf', 'lm'], C: ['pk', 'ck'] };
  // 내 예측 카드에서 조를 나타내는 얼굴 아이콘(24px). 6개 모두 images.css에 있어서 여기만 바꾸면 됨 (2026-11-20)
  var GROUP_FACE = { A: 'lb', B: 'bf', C: 'pk' };
  var CHAR_NAME = { cv: '캐비어', lb: '랍스터', bf: '소갈비', lm: '양갈비', pk: '돼지갈비', ck: '닭갈비' };
  function teamBanner(g, metas, tag) {
    var parts = g.name.split('·');
    var name = parts.map(function (p, i) { return '<span>' + esc(p) + (i < parts.length - 1 ? '·' : '조') + '</span>'; }).join('');
    var chars = (TEAM_CHARS[g.id] || []).map(function (c) { return '<i class="ch ch-' + c + '" role="img" aria-label="' + CHAR_NAME[c] + ' 캐릭터"></i>'; }).join('');
    return '<' + (tag || 'div') + ' class="team-banner tb-' + g.id + '"><div class="tb-text"><h2 class="tb-name">' + name + '</h2>' +
      (metas && metas.length ? '<div class="tb-meta">' + metas.map(function (m) { return '<span class="num">' + m + '</span>'; }).join('') + '</div>' : '') +
      '</div><div class="tb-chars" aria-hidden="false">' + chars + '</div></' + (tag || 'div') + '>';
  }

  function weekChips() {
    return '<div class="weeks" role="group" aria-label="주차 선택">' + seasonDates().map(function (d) {
      var s = weekStatus(getWeek(d));
      return '<button data-act="week" data-v="' + d + '" aria-pressed="' + (d === ui.week) + '"><span class="dot st-' + s + '"></span>' + md(d) + '</button>';
    }).join('') + '</div>';
  }

  function legend() {
    return '<p class="legend" aria-label="이름 앞 점 표시"><span class="pl t-hell">지옥도 <span class="muted">지난번 전승</span></span><span class="pl t-heaven">천국도 <span class="muted">지난번 전패</span></span><span class="pl t-mid">중립 <span class="muted">1승 1패</span></span></p>';
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
    if (predWeek()) ensurePredWeek(w.date);
    var sm = predWeek() ? superMap(w) : {};
    var done = w.matches.filter(function (m) { return m.win; }).length;
    out += '<div class="daybar"><h2 class="day num">' + md(w.date) + '(수) 공식전</h2><dl class="facts"><div><dt>참석</dt><dd class="num">' + Object.keys(w.attendees).length + '명</dd></div><div><dt>경기</dt><dd class="num">' + w.matches.length + '</dd></div><div><dt>결과 입력</dt><dd class="num">' + done + '/' + w.matches.length + '</dd></div></dl></div>';
    if (ui.admin && !w.published) out += '<div class="banner warn">회원에게는 아직 안 보이는 편성이에요. 관리 › 공개에서 공개할 수 있어요.</div>';
    if (ui.admin && (ui.awv || (isMatchDay(w.date) ? 'live' : 'table')) === 'table') out += '<div class="banner info small"><span>이긴 팀을 누르면 승리로 기록돼요. 한 번 더 누르면 취소. 다 입력하고 아래 <b>저장</b>!</span></div>';
    var started = L.matchStarted(w.date, Date.now());   // 그 날 17:30 KST 전이면 '경기 전' (결과 대기는 시작 뒤부터)
    var myp = myPredFor(w), lvp = L.livePrediction(myp, w), pickOf = {};
    if (myp) L.scorePrediction(myp, w).picks.forEach(function (p) { pickOf[p.match] = p; });
    // 경기 카드 하나. tag: 내 경기 보기에서 조 이름 붙일 때
    function card(m, i, tag) {
      var state = m.win ? '<span class="m-state done">결과 입력됨</span>' : m.court != null ? '<span class="m-state on">진행 중 · ' + L.courtLabel(m.court) + '</span>' : started ? '<span class="m-state">결과 대기</span>' : '<span class="m-state">경기 전</span>';
      var pk = pickOf[m.id];
      var pkChip = pk ? '<span class="chip mypick ' + pk.result + '">내 픽 ' + PK_ICON[pk.result] + '<span class="sr">' + PK_SR[pk.result] + '</span></span>' : '';
      var o = '<article class="match' + (m.win ? ' decided' : '') + (sm[m.id] ? ' super' : '') + '"><div class="m-head">' + (tag ? gface(m.pool) : '<span class="m-no num">' + (i + 1) + '경기</span>') +
        (sm[m.id] ? '<span class="chip super num">🔥 슈퍼매치 · ' + sm[m.id] + '명 참여</span>' : '') + pkChip + state + '</div><div class="m-teams">';
      ['a', 'b'].forEach(function (side, si) {
        var st = m.win ? (m.win === side ? ' win' : ' lose') : '';
        var names = '<span class="names">' + m[side].map(function (pid) { return plHtml(pid, m, w.date, P); }).join('<span class="sep">·</span>') + '</span>';
        var res = m.win === side ? '<span class="res win-badge">WIN</span>' : m.win ? '<span class="res lose-txt">패</span>' : (ui.admin ? '<span class="res tap">승리 기록</span>' : '');
        var cls = 'team' + st + (pk && pk.side === side ? ' picked' : '');
        if (ui.admin) o += '<button class="' + cls + '" data-act="win" data-m="' + m.id + '" data-side="' + side + '" aria-label="' + esc(m[side].map(function (p) { return P[p] ? P[p].name : ''; }).join(', ')) + ' 승리 기록">' + names + res + '</button>';
        else o += '<div class="' + cls + '">' + names + res + '</div>';
        if (si === 0) o += '<span class="vs" aria-label="대">vs</span>';
      });
      return o + '</div></article>';
    }
    // 오늘 경기날이면 코트 상황·자리 비움을 실시간으로
    var today = isMatchDay(w.date);
    if (today) ensureLive(w.date);
    var board = today ? L.liveBoard(w, liveRows(), Date.now(), { slots: L.courtSlots(work.settings, w) }) : null;
    // 진행 도우미: 경기 진행만
    if (ui.op) return out + (today ? '' : '<p class="banner info small">오늘이 경기날이 아니라 자리 비움은 안 보여요.</p>') + viewLive(w, P);
    // 돼장: 경기 진행 | 결과 표 (경기날은 경기 진행이 먼저)
    if (ui.admin) {
      var av = ui.awv || (today ? 'live' : 'table');
      out += '<div class="seg wview" role="group" aria-label="관리 보기"><button data-act="awv" data-v="live" aria-pressed="' + (av === 'live') + '">경기 진행</button><button data-act="awv" data-v="table" aria-pressed="' + (av === 'table') + '">결과 표</button></div>';
      if (av === 'live') return out + (today ? '' : '<p class="banner info small">오늘이 경기날이 아니라 자리 비움은 안 보여요. 코트 넣기·결과는 그대로 돼요.</p>') + viewLive(w, P);
    }
    // 내 경기 | 전체 (이름을 골라야 보임. 관리 모드는 결과 입력 때문에 항상 전체)
    var mine = ui.me && !ui.admin && ui.wview !== 'all';
    if (!ui.admin) out += ui.me ? '<div class="seg wview" role="group" aria-label="보기"><button data-act="wview" data-v="mine" aria-pressed="' + (ui.wview !== 'all') + '">내 경기</button><button data-act="wview" data-v="all" aria-pressed="' + (ui.wview === 'all') + '">전체</button></div>'
      : '<p class="small muted">내 기록 탭에서 이름을 고르면 <b>내 경기만</b> 모아 볼 수 있어요.</p>';
    if (board && !ui.admin) out += courtsStrip(w, board, P, pickOf) + (ui.me && !mine ? myLiveCard(w, board, P) : '');
    // 내 경기 보기: 지금 코트 → 내 경기 → 늦어요·레슨 → 내 예측 (사용자 요청 2026-11-22·23), 전체 보기: 늦어요·레슨 → 내 예측 → 전체 경기
    if (ui.me && !ui.admin && !mine) out += myPredCard(w, myp, lvp, P);
    if (mine) {
      var my = [];
      groups().concat([{ id: null }]).forEach(function (g) {
        w.matches.filter(function (m) { return g.id ? m.pool === g.id : poolOrder(m.pool) === 99; }).forEach(function (m, i) {
          if (m.a.concat(m.b).indexOf(ui.me) >= 0) my.push(card(m, i, true));
        });
      });
      out += my.length ? '<section class="my-matches"><h3>' + esc((P[ui.me] || {}).name || '') + ' · 내 경기 ' + my.length + '</h3><div class="match-list">' + my.join('') + '</div></section>'
        : '<div class="card empty"><b>' + md(w.date) + '(수)엔 내 경기가 없어요</b><p class="muted">전체를 누르면 모든 경기를 볼 수 있어요.</p></div>';
      return out + (board ? myLiveCard(w, board, P) : '') + myPredCard(w, myp, lvp, P);
    }
    out += legend();
    groups().forEach(function (g) {
      var ms = w.matches.filter(function (m) { return m.pool === g.id; });
      if (!ms.length) return;
      var ppl = {};
      ms.forEach(function (m) { m.a.concat(m.b).forEach(function (p) { if (p) ppl[p] = 1; }); });
      var dn = ms.filter(function (m) { return m.win; }).length;
      out += '<section class="group g' + g.id + '">' + teamBanner(g, [Object.keys(ppl).length + '명', ms.length + '경기', dn === ms.length ? '결과 완료' : !started && !dn ? '경기 전' : '결과 ' + dn + '/' + ms.length]) + '<div class="match-list">';
      ms.forEach(function (m, i) { out += card(m, i); });
      out += '</div></section>';
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
      out += '<div class="allset"><span class="ok-ico" aria-hidden="true">✓</span><div><strong>전원 공식전 2경기씩!</strong><p class="num">' + Object.keys(w.attendees).length + '명 전원 2경기 · 파트너 중복 없음</p>' +
        (extras.length ? '<p class="note">추가출전(기록 제외): ' + esc(extras.join(', ')) + '</p>' : '') + '</div></div>';
    }
    return out;
  }

  function viewRank() {
    var S = L.standings(work, { bonus: bonusMap(), now: Date.now() }), P = pm();
    var meP = P[ui.me];
    var gid = ui.rankGroup || (meP ? meP.group : groups()[0].id);
    var g = groups().filter(function (x) { return x.id === gid; })[0] || groups()[0];
    var list = S[g.id] || [];
    var ds = L.seasonDays(work.settings);
    var remain = ds.filter(function (d) { return weekStatus(getWeek(d)) !== 'done'; }).length;
    var played = list.filter(function (r) { return r.wins + r.losses + r.pending > 0 || r.bonus; });
    var idle = list.filter(function (r) { return r.wins + r.losses + r.pending === 0 && !r.bonus; });
    var out = '<div class="gsel" role="group" aria-label="조 선택">' + groups().map(function (x) {
      return '<button class="g' + x.id + '" data-act="rankg" data-v="' + x.id + '" aria-pressed="' + (x.id === g.id) + '">' + esc(x.name) + '</button>';
    }).join('') + '</div>';
    out += '<div class="team-zone g' + g.id + '">' + teamBanner(g, ['다승왕 ' + g.winners + '명', '남은 수요일 ' + remain + '번']) + '<p class="muted small num">1인 최대 +' + remain * 2 + '승까지 남았어요.</p>';
    if (!played.length) {
      out += '<div class="card empty"><div class="pig" aria-hidden="true"></div><b>아직 입력된 결과가 없어요</b><p class="muted">돼장이 경기 결과를 입력하면 승수와 순위가 바로 계산돼요.</p></div>';
    } else {
      out += '<div class="board"><div class="rrow rhead" aria-hidden="true"><span>순위</span><span>이름</span><span>총합</span><span>승</span><span>보너스</span><span>패</span></div>' + played.map(function (r) {
        var tag = r.lottery ? crown('동률 추첨') : r.contender ? crown('다승왕권') : '';
        var dec = r.wins + r.losses, tot = r.total != null ? r.total : r.wins;
        return '<div class="rrow' + (r.contender ? ' contender' : '') + (r.id === ui.me ? ' me' : '') + '"><span class="medal num' + (r.rank <= 3 && tot > 0 ? ' m' + r.rank : '') + '">' + (dec || r.bonus ? r.rank : '–') + '</span>' +
          '<span class="rname"><b>' + esc(r.name) + '</b>' + tag + '<span class="sub num">' + r.weeks + '주 참가' + (r.pending ? ' · <span class="nw">결과 대기 ' + r.pending + '경기</span>' : '') + '</span></span>' +
          '<span class="rnum strong num total" aria-label="총합 ' + tot + '승">' + tot + '</span><span class="rnum num">' + r.wins + '</span><span class="rnum num bonus' + (r.bonus > 0 ? ' plus' : r.bonus < 0 ? ' minus' : '') + '" aria-label="보너스 ' + r.bonus + '">' + (r.bonus ? signed(r.bonus) : '–') + '</span><span class="rnum num">' + r.losses + '</span></div>';
      }).join('') + '</div><p class="small muted">총합 = 승(공식 경기) + 돼블스플랜 보너스 · 순위는 총합 기준</p>';
    }
    out += '</div>';
    if (idle.length) out += '<details><summary>아직 기록 없는 ' + idle.length + '명</summary><p class="small muted">' + idle.map(function (r) { return esc(r.name); }).join(', ') + '</p></details>';
    out += '<p class="small muted">총합(공식 승 + 예측 보너스)으로 순위를 매기고, 최종 동률이면 추첨해요. 공식 2경기만 집계하고 추가출전·자유게임은 빠져요. 다른 조 경기에 나가도 승수는 원소속 조로 들어가요.</p>';
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
    hell: '치열한 승부, 살벌한 랠리. 지난번 전승의 대가로 강한 상대와 붙어요.',
    heaven: '달콤한 휴식, 잠시 행복회로! 지난번 전패의 선물이에요.',
    mid: '1승 1패, 균형 잡힌 중간 난도로 편성돼요.',
    new: '아직 기록이 없어서 중간 난도로 편성돼요.',
    unknown: '지난 경기 결과가 입력되면 배정이 정해져요.',
  };
  // 공지문 '돼장의 마지막 한마디' 그대로
  var FATE_QUOTE = { hell: '그렇다면 지옥으로 모시겠습니다.', heaven: '천국행 티켓을 발급해 드리겠습니다.' };
  function viewMe() {
    var P = pm(), me = P[ui.me];
    var pick = mePicker();
    if (!me) return pick + '<div class="card empty"><div class="pig" aria-hidden="true"></div><b>이름을 고르면 내 경기만 모아 보여 줘요</b><p class="muted">내 매칭, 누적 승수, 다음 주 지옥도·천국도 배정까지. 이 기기에만 기억돼요.</p></div>';
    var S = L.standings(work, { bonus: bonusMap(), now: Date.now() });
    var gid = work.settings.countBy === 'pool' ? null : me.group;
    var row = null, gsize = 0, gw = 1;
    Object.keys(S).forEach(function (k) {
      if (gid && k !== gid) return;
      var r = S[k].filter(function (x) { return x.id === me.id; })[0];
      if (r && (!row || r.wins > row.wins)) { row = r; gsize = S[k].filter(function (x) { return x.wins + x.losses + x.pending > 0 || x.bonus; }).length; var g = groups().filter(function (x) { return x.id === k; })[0]; gw = g ? g.winners : 1; }
    });
    var nd = nextPlayDate(), tier = L.tierOf(work, me.id, nd);
    var ndLabel = md(nd === '9999-12-31' ? work.settings.seasonEnd : nd);
    var myG = groups().filter(function (x) { return x.id === me.group; })[0];
    var wrap = function (body) { return pick + '<div class="team-zone me-zone g' + me.group + '">' + body + '</div>'; };
    var rec = L.meRecord(row);   // 총합 = 공식 승 + 돼블스플랜 보너스
    var prec = pred.allOk ? L.predictionRecord(work, pred.all, me.id) : null;
    var out = myG ? teamBanner(myG, ['내 조', rec.has ? '조 내 ' + row.rank + '위' : '기록 대기']) : '';
    out += '<div class="card"><div class="me-head"><h2>' + esc(me.name) + '</h2><span class="gdot g' + me.group + '">' + esc(gname(me.group)) + '조</span></div>' +
      '<div class="stat-row"><div class="stat' + (row && row.contender ? ' hl' : '') + '"><b class="num">' + (rec.has ? row.rank + '위' : '–') + '</b><span>조 내 순위' + (gsize ? ' / ' + gsize + '명' : '') + '</span></div>' +
      '<div class="stat total"><b class="num">' + rec.total + '승</b><span>총합 · 순위 기준</span></div></div>' +
      // 총합 내역: 공식 승 + 예측 승 | 패 (예측 승 = 돼블스플랜 보너스, 적중·실패 횟수 함께)
      '<div class="rec-split" role="group" aria-label="총합 내역">' +
        '<div><span>공식 승</span><b class="num">' + rec.wins + '</b></div><i aria-hidden="true">+</i>' +
        '<div class="pwin' + (rec.bonus > 0 ? ' plus' : rec.bonus < 0 ? ' minus' : '') + '"><span>예측 승</span><b class="num">' + signed(rec.bonus) + '</b>' +
          (prec && prec.hit + prec.miss + prec.pending ? '<small class="num">적중 ' + prec.hit + ' · 실패 ' + prec.miss + (prec.pending ? ' · 진행 ' + prec.pending : '') + '</small>' : '') + '</div>' +
        '<div class="loss"><span>패</span><b class="num">' + rec.losses + '</b></div>' +
      '</div>' +
      (row && row.pending ? '<p class="small muted num">결과 대기 ' + row.pending + '경기</p>' : '') +
      (row && row.lottery ? '<p class="small">' + crown('동률 추첨') + ' 지금 끝나면 다승왕 ' + gw + '자리를 두고 추첨 대상이에요.</p>' : row && row.contender ? '<p class="small">' + crown('다승왕권') + ' 지금 순위면 다승왕이에요!</p>' : '') +
      '</div>';
    var fk = tier.tier === 'hell' || tier.tier === 'heaven' ? tier.tier : 'mid';
    var fch = (TEAM_CHARS[me.group] || [])[1];
    out += '<section class="fate fate-' + fk + '" aria-label="다음 경기 배정">' +
      '<div class="fate-top"><span class="fate-eyebrow num">' + ndLabel + '(수) 내 배정</span>' +
      '<span class="fate-basis num">' + (tier.date ? md(tier.date) + ' · ' + tier.wins + '승 ' + tier.losses + '패' : '지난 기록 없음') + '</span></div>' +
      '<strong class="fate-name">' + TIER_LABEL[tier.tier] + '</strong>' +
      '<p class="fate-desc">' + FATE_TEXT[tier.tier] + '</p>' +
      (FATE_QUOTE[tier.tier] ? '<p class="fate-quote">“' + FATE_QUOTE[tier.tier] + '” <span>— 돼장</span></p>' : '') +
      (fch ? '<i class="ch ch-' + fch + ' fate-ch" role="img" aria-label="' + CHAR_NAME[fch] + ' 캐릭터"></i>' : '') + '</section>';
    var hist = work.weeks.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).filter(function (w) {
      return (w.published || ui.admin) && w.matches.some(function (m) { return m.a.concat(m.b).indexOf(me.id) >= 0; });
    });
    if (!hist.length) return wrap(out + '<div class="card empty"><b>아직 편성된 경기가 없어요</b></div>');
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
    return wrap(out);
  }

  // ---------- 돼블스플랜(승부 예측) ----------
  // 마감 전: 집계(인원·비율)와 이름 없는 최근 예측 목록만 서버에서 읽고, 내 제출은 이 기기에도 보관
  // 마감 후: 전원 예측(predictions)을 읽어 경기 결과로 채점. 보너스는 저장하지 않고 매번 계산
  var PRED_KEY = 'ddw-pred';
  var MODE_LABEL = { high: '하이리스크', safe: '안전형' };
  var pred = { week: null, ok: null, counts: [], events: [], close: [], at: 0, sig: '', loading: false, closedAt: {}, watch: null,
    all: [], allOk: null, newEvent: 0, admWeek: null, admList: null, admErr: '' };
  ui.pred = { mode: '', picks: [], filter: '', view: 'team', more: false, edit: false, busy: false, confirm: false, full: false, adm: null, admDel: '' };

  function predWeek() { var w = getWeek(ui.week); return w && w.published !== false && w.matches.length ? w : null; }
  function isClosed(d) { return L.isPredictionClosed(d, Date.now()); }
  function localPreds() { try { var o = JSON.parse(LS.get(PRED_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function localPred(d, pid) { var a = localPreds()[d]; return (a && pid && a[pid]) || null; }
  function setLocalPred(d, pid, v) {
    var a = localPreds();
    a[d] = a[d] || {}; a[d][pid] = v;
    Object.keys(a).sort().slice(0, -8).forEach(function (k) { delete a[k]; }); // 최근 8주만
    LS.set(PRED_KEY, JSON.stringify(a));
  }
  function matchLabel(w, m) {
    var same = w.matches.filter(function (x) { return x.pool === m.pool; });
    return (poolOrder(m.pool) === 99 ? '' : gname(m.pool) + ' ') + (same.indexOf(m) + 1) + '경기';
  }
  // 짧은 이름(성 빼고, 겹치면 성까지, logic.shortNames): 내 예측 카드에서만 씀. 나머지는 성까지 (2026-11-22)
  var SN = null;
  function sname(pid, P) { if (!SN) SN = L.shortNames(work.players); return SN[pid] || (P && P[pid] ? P[pid].name : '?'); }
  // 조 표시: 점·조 이름 대신 조 캐릭터 얼굴 (화면 읽기용 이름은 조 이름)
  function gface(pool) { var k = GROUP_FACE[pool]; return k ? '<i class="face face-' + k + '" role="img" aria-label="' + esc(gname(pool)) + '"></i>' : ''; }
  function teamText(m, side, P) { return m ? m[side].map(function (p) { return P[p] ? P[p].name : '?'; }).join('·') : '(빠진 경기)'; }
  // 내 예측 카드만 이름만 (사용자 요청 2026-11-22: 나머지는 성까지)
  function shortTeam(m, side, P) { return m ? m[side].map(function (p) { return P[p] ? sname(p, P) : '?'; }).join('·') : '(빠진 경기)'; }
  function matchById(w, id) { return w.matches.filter(function (m) { return m.id === id; })[0] || null; }
  function bonusMap() { return pred.allOk ? L.bonusByPlayer(work, pred.all) : {}; }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d ? d + '일 ' + h + '시간' : h + ':' + p2(m) + ':' + p2(x); // 하루 넘게 남으면 초는 생략
  }
  function hhmm(t) { try { return new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }); } catch (e) { return ''; } }
  function pct(x) { return Math.round(x * 100); }
  // 다승왕권·동률 추첨 표시: 글자 없이 왕관 아이콘만 (사용자 요청 2026-11-20). 이름은 화면 읽기용으로만
  function crown(label) { return '<svg class="crown" viewBox="0 0 24 24" role="img" aria-label="' + label + '"><title>' + label + '</title><path d="M3 8.5l4.6 3.9L12 5l4.4 7.4L21 8.5 19.4 18H4.6z"/><rect x="4.6" y="19.2" width="14.8" height="2.3" rx="1"/></svg>'; }
  function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; }
  function resultLabel(s, mode) {
    var b = L.PREDICT.bonus[mode] || { hit: 0, miss: 0 };
    if (s.status === 'hit') return '적중 +' + b.hit + '승';
    if (s.status === 'miss') return '실패 ' + (b.miss ? '−' + Math.abs(b.miss) + '승' : '0');
    if (s.status === 'check') return '확인 필요';
    return '진행 중 ' + s.picks.filter(function (p) { return p.result === 'hit'; }).length + '/' + L.PREDICT.picks;
  }
  var PK_ICON = { hit: '✓', miss: '✕', pending: '', check: '!' }, PK_SR = { hit: '적중', miss: '실패', pending: '대기', check: '확인 필요' };
  // grp: 내 예측 카드에서 픽마다 조 색 테두리로 어느 조 경기인지 구분 (사용자 요청 2026-11-20, 글자 라벨 대신)
  function pickCells(w, s, P, small, grp) {
    var ord = function (p) { var m = matchById(w, p.match); return m ? poolOrder(m.pool) * 100 + w.matches.indexOf(m) : 1e4; };
    return '<div class="pick4' + (small ? ' sm' : '') + (grp ? ' grp' : '') + '">' + s.picks.slice().sort(function (x, y) { return ord(x) - ord(y); }).map(function (p) {
      var m = matchById(w, p.match);
      var face = m ? gface(m.pool) : '';   // 조는 얼굴 아이콘 (점·조 이름 없이)
      // ✓·✕는 이름 오른쪽, 대기는 아이콘 없이 (진행 중 코트는 맨 위 '지금 코트'에 표시, 2026-11-22)
      var icon = PK_ICON[p.result] ? '<i class="pk-res" aria-hidden="true">' + PK_ICON[p.result] + '</i>' : '';
      return '<span class="pk ' + p.result + (grp && m ? ' g' + m.pool : '') + '">' + face + '<span>' + esc(grp ? shortTeam(m, p.side, P) : teamText(m, p.side, P)) + '</span>' + icon + '<span class="sr">' + PK_SR[p.result] + '</span></span>';
    }).join('') + '</div>';
  }

  // 이번 주 내 예측: 마감 뒤엔 서버의 전원 공개 목록, 마감 전엔 이 기기에 저장한 것
  function myPredFor(w) {
    if (!ui.me) return null;
    if (isClosed(w.date)) return pred.allOk ? pred.all.filter(function (p) { return p.week_date === w.date && p.player_id === ui.me; })[0] || null : null;
    return localPred(w.date, ui.me);
  }
  function liveText(lv) {
    if (lv.status === 'hit') return '적중 확정 +' + lv.bonus + '승';
    if (lv.status === 'miss') return '실패 확정 ' + (lv.bonus ? '−' + Math.abs(lv.bonus) + '승' : '· 0승');
    if (lv.status === 'check') return '편성이 바뀐 경기가 있어요 · 돼장 확인 중';
    return '남은 ' + lv.left + '경기 다 맞히면 +' + lv.ifAllHit + '승';
  }
  // 이번 주 탭 맨 위 '내 예측' (돼장이 결과를 저장하면 Realtime으로 바로 바뀜)
  function myPredCard(w, p, lv, P) {
    if (!p) return isClosed(w.date) ? '' : '<div class="card my-pred mini"><p class="small">이번 주 예측을 아직 안 했어요. <button class="link" data-act="tab" data-v="plan">돼블스플랜 하러 가기</button></p></div>';
    return '<div class="card my-pred live ' + lv.status + '"><div class="mp-head"><h3>내 예측</h3><span class="mchip ' + p.mode + '">' + MODE_LABEL[p.mode] + '</span><span class="mp-score num">' + lv.hits + '/' + L.PREDICT.picks + ' 적중</span></div>' +
      pickCells(w, L.scorePrediction(p, w), P, false, true) + '<b class="pred-res ' + lv.status + '">' + liveText(lv) + '</b></div>';
  }
  // ---------- 경기 진행(코트 3칸) ----------
  // 코트·결과는 app_state(돼장 저장), 자리 비움은 availability 테이블. 둘 다 Realtime(안 되면 20초마다 다시 읽기)
  var live = { week: null, rows: [], ok: null, watch: null, at: 0, stateAt: 0 };
  var AWAY_LABEL = { late: '늦음', away: '레슨 중', out: '오늘 못 함' };   // 레슨은 '왔어요'를 누를 때까지 (자동 복귀 없음)
  function isMatchDay(d) { return d === todayKST(); }
  function liveRows() { return live.week === ui.week && live.ok ? live.rows : []; }
  function loadAvail(d) {
    return remote.availability(d).then(function (rows) { if (live.week === d) { live.rows = rows || []; live.ok = true; live.at = Date.now(); } },
      function () { if (live.week === d) { live.ok = false; live.at = Date.now(); } });
  }
  // 돼장 저장을 받아 옴: 내가(돼장) 저장 안 한 변경이 있으면 건드리지 않음(저장할 때 기존 충돌 안내로 처리)
  function reloadState() {
    if (dirty() || ui.busy) return Promise.resolve(false);
    live.stateAt = Date.now();
    return remote.load().then(function (s) {
      if (dirty() || ui.busy || s.rev === saved.rev) return false;
      saved = s; work = clone(s); return true;
    }, function () { return false; });
  }
  function ensureLive(d) {
    if (live.week === d) return;
    if (live.watch) { live.watch.stop(); live.watch = null; }
    live.week = d; live.rows = []; live.ok = null;
    if (!isMatchDay(d)) return;
    loadAvail(d).then(render);
    var t = null;
    live.watch = remote.watchLive(d, function (table) {
      clearTimeout(t);
      t = setTimeout(function () { (table === 'availability' ? loadAvail(d) : reloadState()).then(function () { render(); }); }, 300);
    });
  }
  function liveTick() {
    var d = live.week;
    if (!d || d !== ui.week || ui.tab !== 'week' || !isMatchDay(d) || document.visibilityState === 'hidden') return;
    var polling = !live.watch || !live.watch.live();
    if (polling && Date.now() - live.at > 20000) loadAvail(d).then(render);
    if (polling && Date.now() - live.stateAt > 20000) reloadState().then(function (ch) { if (ch) render(); });
    // 레슨 복귀 시각이 지나면 다시 그림
    if (liveRows().some(function (r) { return r.status === 'away' && r.until && Date.parse(r.until) <= Date.now() && Date.parse(r.until) > Date.now() - 1000; })) render();
  }
  function pname(P, pid) { return P[pid] ? P[pid].name : '?'; }
  function teamNames(m, side, P) { return m[side].map(function (p) { return esc(pname(P, p)); }).join('·'); }
  function untilText(u) { return u ? '~' + hhmm(u) : ''; }
  function mins(iso) { return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); }
  function whyText(x, P) {
    return x.why.map(function (y) { return esc(pname(P, y.pid)) + ' ' + (y.kind === 'playing' ? L.courtLabel(y.court) + ' 경기 중' : AWAY_LABEL[y.kind] + (y.until ? ' ' + untilText(y.until) : '')); }).join(' · ');
  }
  // 돼장: 코트 3칸 + 지금 못 하는 사람 + 바로 가능(오래 기다린 순) + 지금 못 함 + 완료(접힘)
  function viewLive(w, P) {
    var b = L.liveBoard(w, liveRows(), Date.now(), { slots: L.courtSlots(work.settings, w) }), out = '';
    // 코트: 고정 번호(설정, 기본 5·6) + 그날 여는 '추가 코트'(번호 없음). 비어 있는 추가 코트는 닫을 수 있음
    out += '<section class="courts" aria-label="코트">' + b.courts.map(function (c) {
      var m = c.m;
      if (!m) return '<div class="court empty"><b>' + L.courtLabel(c.no) + '</b>' + (c.no === L.LIVE.EXTRA ? '<button class="link small" data-act="lv-extra" data-v="0">닫기</button>' : '<span>비어 있음</span>') + '</div>';
      return '<div class="court on g' + m.pool + '"><div class="c-head"><b>' + L.courtLabel(c.no) + '</b>' + gface(m.pool) + '<span class="num muted">' + (m.startedAt ? mins(m.startedAt) + '분째' : '') + '</span></div>' +
        ['a', 'b'].map(function (side) { return '<button class="c-team" data-act="lv-win" data-m="' + m.id + '" data-side="' + side + '"><span>' + teamNames(m, side, P) + '</span><small>이김</small></button>'; }).join('<span class="vs">vs</span>') +
        '<button class="link small" data-act="lv-cancel" data-m="' + m.id + '">코트에서 빼기</button></div>';
    }).join('') + (w.extraCourt ? '' : '<button class="court add" data-act="lv-extra" data-v="1">+ 추가 코트 열기</button>') + '</section>';
    // 지금 못 하는 사람
    var awayIds = Object.keys(b.away);
    out += '<section class="card away-box"><div class="ab-head"><h3>지금 못 하는 사람 <span class="num muted">' + awayIds.length + '</span></h3><button class="btn sm" data-act="lv-add">' + (ui.lvAdd ? '닫기' : '+ 추가') + '</button></div>' +
      (live.ok === false ? '<p class="small" style="color:var(--hell-text)">자리 비움 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>' : '') +
      (awayIds.length ? '<div class="ab-list">' + awayIds.map(function (pid) {
        var a = b.away[pid], row = liveRows().filter(function (r) { return r.player_id === pid; })[0] || {};
        return '<span class="ab-chip ' + a.status + '"><b>' + esc(pname(P, pid)) + '</b> ' + AWAY_LABEL[a.status] + (a.until ? ' ' + untilText(a.until) : '') + (row.by_admin ? '' : ' <small>본인</small>') +
          '<button data-act="lv-set" data-p="' + pid + '" data-st="here" aria-label="' + esc(pname(P, pid)) + ' 다시 가능">×</button></span>';
      }).join('') + '</div>' : (ui.lvAdd ? '' : '<p class="small muted">모두 있어요. 늦거나 레슨으로 빠지는 사람은 + 추가</p>'));
    if (ui.lvAdd) {
      var att = Object.keys(w.attendees || {}).filter(function (pid) { return !b.away[pid] && P[pid]; }).sort(function (x, y) { return poolOrder(w.attendees[x]) - poolOrder(w.attendees[y]) || pname(P, x).localeCompare(pname(P, y), 'ko'); });
      out += ui.lvPick && P[ui.lvPick] ? '<div class="ab-pick"><p><b>' + esc(pname(P, ui.lvPick)) + '</b>을(를) 어떻게 표시할까요?</p><div class="row">' +
        '<button class="btn sm" data-act="lv-set" data-p="' + ui.lvPick + '" data-st="late">늦음</button><button class="btn sm" data-act="lv-set" data-p="' + ui.lvPick + '" data-st="away">레슨</button>' +
        '<button class="btn sm" data-act="lv-set" data-p="' + ui.lvPick + '" data-st="out">오늘 못 함</button><button class="btn sm" data-act="lv-pick" data-p="">취소</button></div></div>'
        : '<div class="chips ab-att">' + att.map(function (pid) { return '<button data-act="lv-pick" data-p="' + pid + '"><span class="gdot g' + w.attendees[pid] + '">' + esc(pname(P, pid)) + '</span></button>'; }).join('') + '</div>';
    }
    out += '</section>';
    // 바로 가능
    var free = b.freeCourts[0];
    out += '<section class="lv-sec"><h3>바로 가능 <span class="num muted">' + b.ready.length + '</span><small class="muted">오래 기다린 순</small></h3>' +
      (b.ready.length ? b.ready.map(function (r) {
        var m = r.m;
        return '<div class="lv-row g' + m.pool + '"><div class="lv-main">' + gface(m.pool) + '<span class="lv-teams">' + teamNames(m, 'a', P) + ' <i>vs</i> ' + teamNames(m, 'b', P) + '</span><small class="num muted">최대 ' + r.longest + '분 기다림</small></div>' +
          (free != null ? '<button class="btn sm primary" data-act="lv-start" data-m="' + m.id + '" data-c="' + free + '">' + L.courtLabel(free) + '에 넣기</button>' : '<span class="small muted">빈 코트 없음</span>') + '</div>';
      }).join('') : '<p class="small muted">지금 바로 할 수 있는 경기가 없어요.</p>') + '</section>';
    if (b.blocked.length) out += '<section class="lv-sec"><h3>지금 못 함 <span class="num muted">' + b.blocked.length + '</span></h3>' + b.blocked.map(function (x) {
      var m = x.m;
      return '<div class="lv-row blocked"><div class="lv-main">' + gface(m.pool) + '<span class="lv-teams">' + teamNames(m, 'a', P) + ' <i>vs</i> ' + teamNames(m, 'b', P) + '</span><small>' + whyText(x, P) + '</small></div></div>';
    }).join('') + '</section>';
    if (b.done.length) out += '<details class="lv-sec lv-done"' + (ui.lvDone ? ' open' : '') + '><summary data-act="lv-done"><h3>완료 <span class="num muted">' + b.done.length + '</span></h3></summary>' + b.done.map(function (m) {
      return '<div class="lv-row done"><div class="lv-main">' + gface(m.pool) + '<span class="lv-teams"><b>' + teamNames(m, m.win, P) + '</b> 승 · ' + teamNames(m, m.win === 'a' ? 'b' : 'a', P) + '</span></div></div>';
    }).join('') + '<p class="small muted">' + (ui.op ? '결과를 고치려면 돼장에게 말해 주세요.' : '결과를 고치려면 위에서 <b>결과 표</b>로 바꿔 주세요.') + '</p></details>';
    return out;
  }
  // 회원: 오늘 코트 상황(진행 중 3칸)
  // pickOf: 내 예측 {경기 id: {side}} → 내가 예측한 경기가 코트에 있으면 '내 픽'과 고른 팀 강조
  function courtsStrip(w, b, P, pickOf) {
    if (!b.courts.some(function (c) { return c.m; })) return '';
    return '<section class="courts mini" aria-label="지금 코트">' + b.courts.map(function (c) {
      var m = c.m, pk = pickOf && pickOf[m && m.id];
      var tn = function (side) { var t = teamNames(m, side, P); return pk && pk.side === side ? '<b class="c-pick">' + t + '</b>' : t; };
      return m ? '<div class="court on g' + m.pool + (pk ? ' mine-pick' : '') + '"><b>' + L.courtLabel(c.no) + '</b>' + (pk ? '<span class="chip mypick">내 픽</span>' : '') + gface(m.pool) + '<span class="c-names">' + tn('a') + '<i>vs</i>' + tn('b') + '</span></div>'
        : '<div class="court empty"><b>' + L.courtLabel(c.no) + '</b><span>비어 있음</span></div>';
    }).join('') + '</section>';
  }
  // 회원: 본인 늦음/레슨 표시만 (내 차례 문구는 빼기로 함, 사용자 요청 2026-11-22)
  function myLiveCard(w, b, P) {
    var me = ui.me, a = b.away[me], row = liveRows().filter(function (r) { return r.player_id === me; })[0] || {};
    if (!w.attendees || !w.attendees[me]) return '';
    var body = a ? '<p class="small">내 상태: <b>' + AWAY_LABEL[a.status] + (a.until ? ' ' + untilText(a.until) : '') + '</b>' + (row.by_admin ? ' (돼장이 표시)' : '') + '</p>' +
        (a.status === 'out' && row.by_admin ? '' : '<button class="btn sm primary" data-act="my-avail" data-st="here">왔어요 · 다시 가능</button>')
      : '<p class="small muted">늦거나 레슨으로 잠시 빠지면 눌러 주세요.</p><div class="row"><button class="btn sm" data-act="my-avail" data-st="late">늦어요</button><button class="btn sm" data-act="my-avail" data-st="away">레슨</button></div>';
    return '<div class="card my-live' + (a ? ' away' : '') + '">' + body + '</div>';
  }

  // ---- 서버에서 읽기 ----
  function loadAllPreds() {
    return remote.predictions().then(function (rows) { pred.all = rows || []; pred.allOk = true; }, function () { pred.allOk = false; });
  }
  function loadWeekPreds(d) {
    if (pred.loading) return Promise.resolve(false);
    pred.loading = true;
    var closed = isClosed(d);
    var close = !closed ? Promise.resolve([]) :
      (pred.closedAt[d] ? Promise.resolve() : remote.closeSnapshot(d).then(function () { pred.closedAt[d] = 1; }, function () { }))
        .then(function () { return remote.predClose(d); });
    return Promise.all([remote.predCounts(d), remote.predEvents(d), close]).then(function (r) {
      pred.loading = false;
      if (pred.week !== d) return false;
      var prevTop = (pred.events.filter(function (e) { return e.delta > 0; })[0] || {}).id || 0;
      pred.counts = r[0] || []; pred.events = r[1] || []; pred.close = r[2] || []; pred.ok = true; pred.at = Date.now();
      var top = (pred.events.filter(function (e) { return e.delta > 0; })[0] || {}).id || 0;
      if (prevTop && top > prevTop) { pred.newEvent = top; setTimeout(function () { pred.newEvent = 0; }, 1200); }
      var sig = JSON.stringify([pred.counts, pred.events.length && pred.events[0].id, pred.close.length]);
      var changed = sig !== pred.sig; pred.sig = sig;
      return changed;
    }, function () { pred.loading = false; if (pred.week === d) { pred.ok = false; pred.at = Date.now(); } return true; });
  }
  function refreshPred() { var d = pred.week; if (d) loadWeekPreds(d).then(function (ch) { if (ch && pred.week === d) render(); }); }
  // 예측 탭에서 보고 있는 주가 바뀌면 다시 읽고, 마감 전이면 Realtime 구독
  function ensurePredWeek(d) {
    if (pred.week === d) return;
    if (pred.watch) { pred.watch.stop(); pred.watch = null; }
    pred.week = d; pred.ok = null; pred.counts = []; pred.events = []; pred.close = []; pred.sig = ''; pred.at = 0;
    var t = null;
    if (!isClosed(d)) pred.watch = remote.watchPredictions(d, function () { clearTimeout(t); t = setTimeout(refreshPred, 400); });
    setTimeout(function () { loadWeekPreds(d).then(function () { if (pred.week === d) render(); }); }, 0);
  }
  function loadAdminList(d) {
    pred.admWeek = d; pred.admList = null; pred.admErr = '';
    remote.adminListPredictions(token, d).then(function (rows) {
      if (pred.admWeek === d) { pred.admList = rows || []; render(); }
    }, function (e) {
      if (e.code === 'unauthorized') { dropAdmin(); ui.admin = false; ui.pinMsg = '관리자 로그인이 만료됐어요. PIN을 다시 입력하세요.'; }
      else pred.admErr = e.code === 'network' ? '인터넷 연결을 확인해 주세요.' : '예측 목록을 불러오지 못했어요 (' + e.code + ').';
      render();
    });
  }
  // 1초마다: 카운트다운 글자만 바꿈. 마감 순간에는 공개 목록을 다시 읽음. Realtime이 안 되면 20초마다 다시 읽음
  function predTick() {
    if (!work) return;
    liveTick();
    var els = document.querySelectorAll('[data-cd]'), rerender = false;
    for (var i = 0; i < els.length; i++) {
      var left = L.predictionDeadline(els[i].getAttribute('data-cd')).getTime() - Date.now();
      if (left <= 0) rerender = true; else els[i].textContent = (els[i].getAttribute('data-pre') || '마감까지 ') + fmtLeft(left);
    }
    var d = pred.week;
    if (d && pred.watch && isClosed(d)) {
      pred.watch.stop(); pred.watch = null; pred.sig = '';
      Promise.all([loadAllPreds(), loadWeekPreds(d)]).then(function () { render(); });
      return;
    }
    if (rerender) { render(); return; }
    if ((ui.tab === 'plan' || ui.tab === 'week') && d && d === ui.week && !isClosed(d) && (!pred.watch || !pred.watch.live()) && !pred.loading &&
      Date.now() - pred.at > 20000 && document.visibilityState !== 'hidden') refreshPred();
  }

  // ---- 화면 ----
  function planBanner(w, closed, people) {
    var dl = L.predictionDeadline(w.date).getTime();
    return '<section class="plan-banner" aria-label="돼블스플랜 ' + md(w.date) + '(수)">' +
      '<div class="pb-text"><span class="pb-kicker num">' + md(w.date) + '(수) · 승리를 예측하라!</span>' +
      '<h2 class="pb-title">돼블스<em>플랜</em></h2>' +
      '<p class="pb-sub">4경기 모두 맞히면 승수 보너스</p>' +
      '<div class="pb-chips">' + (closed ? '<span class="pb-cd">예측 마감</span>' : '<span class="pb-cd num" data-cd="' + w.date + '">마감까지 ' + fmtLeft(dl - Date.now()) + '</span>') +
      (people != null ? '<span class="pb-n num">참여 ' + people + '명</span>' : '') + '</div></div>' +
      '<i class="pb-pig" role="img" aria-label="후드 쓴 돼지 캐릭터"></i></section>';
  }
  function predNotReady() {
    return pred.ok === false ? '<div class="card"><b>예측 정보를 불러오지 못했어요.</b><p class="small muted">인터넷 연결을 확인하고 다시 시도해 주세요. 계속 안 되면 돼장에게 알려 주세요.</p><div><button class="btn sm" data-act="pred-retry">다시 시도</button></div></div>' : '';
  }
  // 인기 픽 집계 원본: 마감 전에는 실시간 집계(prediction_counts), 마감 후에는 마감 시점 스냅숏(prediction_close)으로 고정
  function popCounts(w) { return isClosed(w.date) && pred.close.length ? pred.close : pred.counts; }
  // 조별 슈퍼매치 {경기 id: 예측 인원}. 아직 못 읽었으면 빈 값
  function superMap(w) { return pred.week === w.date && pred.ok ? L.superMatches(popCounts(w), w) : {}; }
  // 인기 픽: 조 탭(전체·조별) × 보기(팀별·선수별)
  // 팀별 = 경기 하나가 카드 하나(양 팀 %·인원, 100% 막대). 선수별 = 선수가 들어간 팀을 고른 수 순위
  function viewPopular(w, P, closed) {
    var g = ui.pred.filter || '', byPlayer = ui.pred.view === 'player';
    var wf = g ? { date: w.date, matches: w.matches.filter(function (m) { return m.pool === g; }) } : w;
    var cs = popCounts(w), fixed = closed && cs === pred.close;
    var out = '<div class="card pp"><div class="pp-head"><h2><span class="live-dot" aria-hidden="true"></span>' + (closed ? '마감 인기 픽' : '실시간 인기 픽') + '</h2>' +
      (fixed ? '<span class="small muted">마감 시점 집계</span>' : pred.at ? '<span class="small muted num">' + hhmm(pred.at) + ' 기준</span>' : '') + '</div>' +
      '<div class="gsel pp-groups" role="group" aria-label="조">' + [{ id: '', name: '전체' }].concat(groups()).map(function (x) {
        return '<button class="' + (x.id ? 'g' + x.id : 'gall') + '" data-act="pp-filter" data-v="' + x.id + '" aria-pressed="' + (g === x.id) + '">' + esc(x.name).split('·').join('·<br>') + '</button>';
      }).join('') + '</div>' +
      '<div class="seg" role="group" aria-label="보기">' + [['team', '팀별'], ['player', '선수별']].map(function (o) {
        return '<button data-act="pp-view" data-v="' + o[0] + '" aria-pressed="' + ((byPlayer ? 'player' : 'team') === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    if (pred.ok === null) return out + '<p class="small muted">불러오는 중…</p></div>';
    var board = L.matchBoard(cs, wf);
    if (!board.some(function (x) { return x.total > 0; })) {
      return out + '<p class="small muted">' + (g ? gname(g) + '조 경기를 고른 사람이 아직 없어요.' : '아직 제출이 없어요. 첫 예측을 해 보세요!') + '</p></div>';
    }
    if (byPlayer) {
      var list = L.playerPicks(cs, wf); // 지금 보는 탭(전체 또는 그 조) 안에서 1위(공동 1위 모두)가 인기 선수
      var shown = ui.pred.more ? list : list.slice(0, 5);
      out += '<ol class="pp-list">' + shown.map(function (r) {
        var p = P[r.player] || {};
        return '<li class="pp-row"><span class="pp-rank num">' + r.rank + '</span><div class="pp-main"><div class="pp-name"><b>' + esc(p.name || '?') + '</b>' +
          (r.rank === 1 ? '<span class="chip sneaky">인기 선수</span>' : '') + '</div>' +
          (p.group ? '<span class="pp-sub gdot g' + p.group + '">' + esc(gname(p.group)) + '조</span>' : '') +
          '<span class="pp-bar" aria-hidden="true"><i style="width:' + (r.share * 100).toFixed(2) + '%"></i></span></div>' +
          '<div class="pp-nums"><b class="num">' + r.n + '명</b><b class="pp-pct num">' + pct(r.share) + '%</b></div></li>';
      }).join('') + '</ol>';
      if (list.length > 5) out += '<button class="btn sm" data-act="pp-more">' + (ui.pred.more ? '접기' : '전체 보기 (' + list.length + '명)') + '</button>';
      return out + '<p class="small muted">인원 = 그 선수가 들어간 팀을 고른 수(두 경기를 다 고르면 2번 세요) · % = 그 선수 경기를 고른 수 중 그 선수 팀을 고른 비율</p></div>';
    }
    var sm = L.superMatches(cs, w);
    board.sort(function (x, y) { return y.total - x.total || x.index - y.index; });
    var cards = g || ui.pred.more ? board : board.slice(0, 5);
    out += '<ol class="mb-list">' + cards.map(function (x) {
      var m = matchById(w, x.match);
      var team = function (k) {
        var t = x[k];
        return '<div class="mb-team ' + k + '"><span class="mb-name">' + esc(teamText(m, k, P)) + '</span>' +
          '<span class="mb-fig"><b class="num">' + (x.total ? pct(t.share) + '%' : '–') + '</b><span class="num">' + t.n + '명</span></span>' +
          (t.badge === 'hot' ? '<span class="chip hot">인기 픽</span>' : t.badge === 'under' ? '<span class="chip under">역배 후보</span>' : '') + '</div>';
      };
      var wa = x.total ? x.a.n / x.total * 100 : 0;
      return '<li class="mb"><div class="mb-head"><span class="mb-title">' + gface(m.pool) + '</span>' +
        (sm[x.match] ? '<span class="chip super">🔥 슈퍼매치</span>' : '') + '</div>' +
        '<div class="mb-teams">' + team('a') + team('b') + '</div>' +
        '<div class="mb-bar" role="img" aria-label="' + esc(teamText(m, 'a', P)) + ' ' + pct(x.a.share) + '%, ' + esc(teamText(m, 'b', P)) + ' ' + pct(x.b.share) + '%">' +
        (x.total ? '<i class="a" style="width:' + wa.toFixed(2) + '%"></i><i class="b" style="width:' + (100 - wa).toFixed(2) + '%"></i>' : '') + '</div>' +
        '<span class="mb-total num">' + (x.total ? '총 ' + x.total + '명 참여' : '아직 고른 사람이 없어요') + '</span></li>';
    }).join('') + '</ol>';
    if (!g && board.length > 5) out += '<button class="btn sm" data-act="pp-more">' + (ui.pred.more ? '접기' : '전체 보기 (' + board.length + '경기)') + '</button>';
    return out + '<p class="small muted">많이 고른 경기부터 보여요. % = 그 경기를 고른 사람 중 그 팀을 고른 비율 · 인기 픽 70% 초과 · 역배 후보 30% 미만(' + L.PREDICT.badgeMin + '명 이상 고른 경기만) · 🔥 슈퍼매치 = 조에서 가장 많이 고른 경기. 회원들의 선택 분포이고 승리 확률은 아니에요.</p></div>';
  }
  function viewFeed(w, P) {
    var ev = pred.events.filter(function (e) { return e.delta > 0; }).slice(0, 3);
    if (!ev.length) return '';
    return '<div class="card feed" aria-live="polite"><h3><span class="live-dot" aria-hidden="true"></span>방금 들어온 예측</h3>' + ev.map(function (e) {
      var m = matchById(w, e.match_id);
      return '<div class="feed-row' + (e.id === pred.newEvent ? ' new' : '') + '"><span class="num feed-t">' + hhmm(e.at) + '</span><span class="mchip ' + e.mode + '">' + MODE_LABEL[e.mode] + '</span>' +
        '<span class="feed-team">' + esc(teamText(m, e.side, P)) + '</span><b class="buy">선택</b></div>';
    }).join('') + '</div>';
  }
  function viewPredict() {
    var w = predWeek(), P = pm();
    var out = weekChips();
    if (!w) {
      return out + '<div class="card empty"><div class="pig" aria-hidden="true"></div><b>' + md(ui.week) + '(수) 편성이 공개되면 예측할 수 있어요</b>' +
        '<p class="muted">마감은 그 주 수요일 17:30이에요.</p></div>';
    }
    ensurePredWeek(w.date);
    var closed = isClosed(w.date);
    if (!closed && ui.pred.edit) return viewPredEdit(w, P);
    var weekAll = pred.all.filter(function (p) { return p.week_date === w.date; });
    var people = closed ? (pred.allOk ? weekAll.length : null) : (pred.ok ? Math.round(pred.counts.reduce(function (t, c) { return t + c.n; }, 0) / L.PREDICT.picks) : null);
    out += planBanner(w, closed, people) + predNotReady();
    if (closed) return out + viewPredClosed(w, P, weekAll);
    var mine = localPred(w.date, ui.me);
    if (mine) {
      var s = L.scorePrediction(mine, w);
      out += '<div class="card my-pred"><div class="mp-head"><h3>내 예측 · ' + esc((P[ui.me] || {}).name || '') + '</h3><span class="mchip ' + mine.mode + '">' + MODE_LABEL[mine.mode] + '</span></div>' +
        pickCells(w, s, P, false, true) + (s.status === 'check' ? '<p class="small" style="color:var(--hell-text)">편성이 바뀌어서 빠진 경기가 있어요. 다시 골라 제출해 주세요.</p>' : '') +
        '<p class="small muted">' + hhmm(mine.at) + ' 제출 · 마감 전까지 수정할 수 있어요 (이 기기에 보관)</p></div>';
    }
    out += viewPopular(w, P, false) + viewFeed(w, P);
    if (!dirty() && !ui.busy) out += '<div class="plan-cta"><div class="in"><button class="btn primary" data-act="pe-open"><b>' + (mine ? '내 예측 고치기' : '내 예측 하기') + '</b><small>4경기 고르기</small></button></div></div>';
    else out += '<button class="btn primary" data-act="pe-open">' + (mine ? '내 예측 고치기' : '내 예측 하기') + '</button>';
    return out;
  }
  function openPredEdit() {
    var w = predWeek(); if (!w) return;
    var mine = localPred(w.date, ui.me);
    var ids = w.matches.map(function (m) { return m.id; });
    ui.pred.mode = mine ? mine.mode : '';
    ui.pred.picks = mine ? mine.picks.filter(function (p) { return ids.indexOf(p.match) >= 0; }).map(function (p) { return { match: p.match, side: p.side }; }) : [];
    ui.pred.edit = true;
  }
  function viewPredEdit(w, P) {
    var d = ui.pred, n = d.picks.length, max = L.PREDICT.picks, B = L.PREDICT.bonus, qs = L.quotaStatus(d.picks, w);
    var out = '<div class="pe-head"><button class="btn sm" data-act="pe-close" aria-label="예측 화면으로 돌아가기">←</button><h2>예측하기 <span class="muted small num">' + md(w.date) + '(수)</span></h2>' +
      '<span class="pe-cd num" data-cd="' + w.date + '" data-pre="마감 ">마감 ' + fmtLeft(L.predictionDeadline(w.date).getTime() - Date.now()) + '</span></div>';
    out += mePicker();
    out += '<div class="mode-cards" role="radiogroup" aria-label="방식">' + ['high', 'safe'].map(function (k) {
      return '<button class="mode-card" role="radio" aria-checked="' + (d.mode === k) + '" data-act="pe-mode" data-v="' + k + '">' +
        (k === 'high' ? '<span class="mc-tag">HIGH RISK</span>' : '') + '<b class="mc-name">' + (k === 'high' ? '🔥 ' : '🛡️ ') + MODE_LABEL[k] + '</b>' +
        '<span class="mc-line"><span>4경기 모두 적중</span><b class="up num">+' + B[k].hit + '승</b></span>' +
        '<span class="mc-line"><span>하나라도 틀리면</span><b class="' + (B[k].miss ? 'down ' : '') + 'num">' + (B[k].miss ? '−' + Math.abs(B[k].miss) + '승' : '0') + '</b></span></button>';
    }).join('') + '</div>';
    out += '<div class="pe-step"><h3>경기 선택 <span class="num">' + n + '/' + max + '</span></h3><span class="pe-dots" aria-hidden="true">' +
      [0, 1, 2, 3].map(function (i) { return '<i' + (i < n ? ' class="on"' : '') + '></i>'; }).join('') + '</span></div>' +
      '<p class="small muted">' + (qs ? '조마다 정해진 수만큼 이길 팀을 눌러 주세요: ' + groups().filter(function (g) { return qs[g.id]; }).map(function (g) { return esc(g.name) + ' ' + qs[g.id].need; }).join(' · ') + ' (모두 ' + max + '경기). 내 경기도 고를 수 있어요.' :
        '서로 다른 4경기에서 이길 팀을 눌러 주세요. 내 경기도 고를 수 있어요.') + '</p>';
    var tot = {}, sm = superMap(w);
    pred.counts.forEach(function (c) { var k = c.match_id + c.side; tot[k] = (tot[k] || 0) + c.n; });
    // 이번 주 탭처럼 조마다 팀 배너 + 조 색 경기 카드. 조별 고정이 있으면 그 조를 다 고른 뒤 나머지 경기는 흐리게
    var card = function (m, no) {
      var sel = d.picks.filter(function (p) { return p.match === m.id; })[0];
      var full = !sel && (n >= max || (qs && (!qs[m.pool] || qs[m.pool].full)));
      var na = tot[m.id + 'a'] || 0, nb = tot[m.id + 'b'] || 0, t = na + nb;
      return '<article class="pe-match' + (full ? ' dim' : '') + (sm[m.id] ? ' super' : '') + '"><div class="pe-mhead"><span class="pe-no num">' + no + '경기</span>' + (sm[m.id] ? '<span class="chip super">🔥 슈퍼매치</span>' : '') +
        '<span class="num muted small">' + (t ? pct(na / t) + ' : ' + (100 - pct(na / t)) : '아직 0명') + '</span></div><div class="pe-teams">' + ['a', 'b'].map(function (side) {
          var on = !!sel && sel.side === side;
          return '<button class="pe-team" data-act="pe-pick" data-m="' + m.id + '" data-side="' + side + '" aria-pressed="' + on + '"' + (full ? ' disabled' : '') + '>' +
            '<span class="pe-tn">' + esc(teamText(m, side, P)) + '</span><span class="pe-tc num">' + (side === 'a' ? na : nb) + '명</span><i class="pe-ck" aria-hidden="true">✓</i></button>';
        }).join('') + '</div><span class="pe-bar" aria-hidden="true"><i style="width:' + (t ? pct(na / t) : 0) + '%"></i></span></article>';
    };
    groups().forEach(function (g) {
      var ms = w.matches.filter(function (m) { return m.pool === g.id; });
      if (!ms.length) return;
      var q = qs && qs[g.id];
      var metas = q ? [q.need + '경기 고르기', '고름 ' + q.have + '/' + q.need + (q.full ? ' ✓' : '')] : [ms.length + '경기'];
      out += '<section class="group g' + g.id + ' pe-group">' + teamBanner(g, metas) + '<div class="pe-list">' + ms.map(function (m, i) { return card(m, i + 1); }).join('') + '</div></section>';
    });
    var orphan = w.matches.filter(function (m) { return poolOrder(m.pool) === 99; });
    if (orphan.length) out += '<div class="pe-list">' + orphan.map(function (m, i) { return card(m, i + 1); }).join('') + '</div>';
    var md2 = d.mode ? (d.mode === 'high' ? '🔥 ' : '🛡️ ') + MODE_LABEL[d.mode] + ' <span class="up num">+' + B[d.mode].hit + '</span> / <span class="' + (B[d.mode].miss ? 'down ' : '') + 'num">' + (B[d.mode].miss ? '−' + Math.abs(B[d.mode].miss) : '0') + '</span>' : '방식을 골라 주세요';
    out += '<div class="plan-cta pe-bar-fixed"><div class="in"><div class="pe-sum"><span>선택 <b class="num">' + n + '/' + max + '</b></span><span>' + md2 + '</span></div>' +
      '<button class="btn primary" data-act="pe-submit"' + (d.busy ? ' disabled' : '') + '><b>' + (d.busy ? '제출 중…' : '제출하기') + '</b><small>마감 전까지 수정 가능</small></button></div></div>';
    if (d.confirm && P[ui.me]) out += viewPredConfirm(w, P);
    return out;
  }
  // 제출 전 이름 확인 창: 이름을 크게, 방식·고른 4경기를 조 순서로
  function viewPredConfirm(w, P) {
    var d = ui.pred, me = P[ui.me], b = L.PREDICT.bonus[d.mode];
    var ord = function (p) { var m = matchById(w, p.match); return m ? poolOrder(m.pool) : 100; };
    var lines = d.picks.slice().sort(function (x, y) { return ord(x) - ord(y); }).map(function (p) {
      var m = matchById(w, p.match);
      return '<li>' + gface(m.pool) + '<b>' + esc(teamText(m, p.side, P)) + '</b></li>';
    }).join('');
    return '<div class="pc-back" data-act="pc-no" aria-hidden="true"></div>' +
      '<section class="pc-sheet" role="dialog" aria-modal="true" aria-labelledby="pc-title">' +
      '<h3 id="pc-title">이 이름으로 제출할까요?</h3>' +
      '<p class="pc-name"><span class="gdot g' + me.group + '">' + esc(gname(me.group)) + '조</span><b>' + esc(me.name) + '</b></p>' +
      '<p class="pc-warn">다른 사람 이름으로 내면 그 사람의 예측이 바뀌어요. 내 이름이 맞는지 꼭 확인해 주세요.</p>' +
      '<p class="pc-mode">' + (d.mode === 'high' ? '🔥 ' : '🛡️ ') + MODE_LABEL[d.mode] + ' · 4경기 모두 적중 <b class="up num">+' + b.hit + '승</b> · 하나라도 틀리면 <b class="' + (b.miss ? 'down ' : '') + 'num">' + (b.miss ? '−' + Math.abs(b.miss) + '승' : '0') + '</b></p>' +
      '<ul class="pc-picks">' + lines + '</ul>' +
      '<div class="pc-btns"><button class="btn" data-act="pc-no">이름이 달라요</button><button class="btn primary" id="pc-yes" data-act="pc-yes">네, ' + esc(me.name) + '(으)로 제출</button></div></section>';
  }
  function quotaText(w) {
    var q = L.pickQuota(w);
    return q ? '조마다 정해진 수만큼 골라 주세요: ' + groups().filter(function (g) { return q[g.id]; }).map(function (g) { return g.name + ' ' + q[g.id]; }).join(' · ') + '.' : '';
  }
  var SUBMIT_ERR = {
    closed: '마감됐어요(수요일 17:30). 이제는 돼장만 고칠 수 있어요.', bad_player: '명단에서 이름을 찾지 못했어요. 이름을 다시 골라 주세요.',
    no_week: '이번 주 편성이 아직 공개 전이에요.', bad_match: '편성이 바뀌었어요. 새로고침한 뒤 다시 골라 주세요.', dup_match: '같은 경기를 두 번 골랐어요.',
    bad_count: '4경기를 골라 주세요.', bad_side: '팀을 다시 골라 주세요.', bad_mode: '방식을 골라 주세요.', network: '인터넷 연결을 확인하고 다시 제출해 주세요.',
  };
  function submitPred() {
    var w = predWeek(), d = ui.pred;
    if (!w || d.busy) return;
    if (!ui.me) return toast('먼저 내 이름을 골라 주세요.');
    if (!d.mode) return toast('하이리스크와 안전형 중 하나를 골라 주세요.');
    var errs = L.validatePicks(d.picks, w);
    if (errs.length) return toast(errs[0] === 'count' ? '서로 다른 4경기를 골라 주세요 (지금 ' + d.picks.length + '개).' : errs[0] === 'quota' ? quotaText(w) : SUBMIT_ERR.bad_match);
    // 로그인이 없어서 이름을 잘못 고르면 다른 사람 예측을 덮어씀 → 보내기 전에 이름을 한 번 더 확인
    d.confirm = true; render();
    var yes = document.getElementById('pc-yes'); if (yes) try { yes.focus(); } catch (e) { }
  }
  function sendPred() {
    var w = predWeek(), d = ui.pred;
    d.confirm = false;
    if (!w || d.busy || !ui.me) { render(); return; }
    var me = ui.me, picks = d.picks.slice(), mode = d.mode;
    d.busy = true; render();
    remote.submitPrediction(w.date, me, mode, picks).then(function (at) {
      setLocalPred(w.date, me, { mode: mode, picks: picks, at: at || new Date().toISOString() });
      d.busy = false; d.edit = false; window.scrollTo(0, 0);
      toast('제출했어요. 마감 전까지 고칠 수 있어요.');
      refreshPred();
    }, function (e) {
      d.busy = false;
      toast(e.code === 'bad_quota' ? quotaText(w) : SUBMIT_ERR[e.code] || '제출하지 못했어요 (' + (e.code || '알 수 없는 오류') + ').');
    });
  }
  function viewPredClosed(w, P, rows) {
    if (pred.allOk === false) return '<div class="card"><b>예측 결과를 불러오지 못했어요.</b><div><button class="btn sm" data-act="pred-retry">다시 시도</button></div></div>';
    if (pred.allOk === null) return '<div class="card"><p class="small muted">불러오는 중…</p></div>';
    if (!rows.length) return '<div class="card empty"><b>이번 주 예측 제출이 없었어요</b></div>';
    var out = '', rep = L.closingReport(w, pred.close, rows);
    if (rep.ready) out += viewReport(w, rep, P) + '<button class="btn sm" data-act="rp-full">캡처용으로 크게 보기</button>';
    else {
      var done = w.matches.filter(function (m) { return m.win; }).length;
      out += '<div class="card"><h3>예측 마감</h3><p class="small muted num">경기 결과가 모두 들어오면 예측 결과 카드가 떠요 (' + done + '/' + w.matches.length + '경기 입력)</p></div>';
    }
    var order = { hit: 0, pending: 1, check: 2, miss: 3 };
    var scored = rows.map(function (p) { return { p: p, s: L.scorePrediction(p, w), name: (P[p.player_id] || {}).name || '(명단에 없음)' }; })
      .sort(function (a, b) { return order[a.s.status] - order[b.s.status] || a.name.localeCompare(b.name, 'ko'); });
    var mine = scored.filter(function (x) { return x.p.player_id === ui.me; })[0];
    if (mine) out += '<div class="card my-pred"><div class="mp-head"><h3>내 예측 · ' + esc(mine.name) + '</h3><span class="mchip ' + mine.p.mode + '">' + MODE_LABEL[mine.p.mode] + '</span></div>' +
      pickCells(w, mine.s, P, false, true) + '<b class="pred-res ' + mine.s.status + '">' + resultLabel(mine.s, mine.p.mode) + '</b></div>';
    out += '<div class="card"><h3>전원 공개 <span class="small muted num">' + rows.length + '명</span></h3><div class="pub">' + scored.map(function (x) {
      return '<div class="pub-row' + (x.p.player_id === ui.me ? ' me' : '') + '"><div class="pub-who"><b>' + esc(x.name) + '</b><span class="mchip ' + x.p.mode + '">' + MODE_LABEL[x.p.mode] + '</span>' +
        '<span class="pred-res ' + x.s.status + '">' + resultLabel(x.s, x.p.mode) + '</span></div>' + pickCells(w, x.s, P, true) + '</div>';
    }).join('') + '</div></div>';
    out += viewPopular(w, P, true) + viewPredKing(P);
    return out;
  }
  function viewReport(w, r, P) {
    var tn = function (x) { return x ? esc(teamText(matchById(w, x.match), x.side, P)) : '없음'; };
    var cell = function (cls, title, x, big, desc) {
      return '<div class="rp-cell ' + cls + '"><span class="rp-ct">' + title + '</span><b class="rp-team">' + x + '</b><strong class="rp-big num">' + big + '</strong><span class="rp-desc">' + desc + '</span></div>';
    };
    var B = L.PREDICT.bonus;
    var date = w.date.replace(/-/g, '.');
    return '<section class="report" aria-label="돼블스플랜 예측 결과">' +
      '<div class="rp-head"><i class="rp-pig" aria-hidden="true"></i><div><span class="rp-date num">' + md(w.date) + '(수) · 결과 확정</span><h2 class="rp-title">돼블스플랜<br><em>예측 결과</em></h2></div></div>' +
      '<div class="rp-stats"><div><b class="num">' + r.participants + '</b><span>참여</span></div><div class="hit"><b class="num">' + r.hits + '</b><span>적중</span></div><div class="miss"><b class="num">' + r.misses + '</b><span>실패</span></div></div>' +
      '<div class="rp-grid">' +
      cell('rp-up', '👍 인기 팀 승리', tn(r.upper), r.upper ? pct(r.upper.share) + '%' : '–', r.upper ? '가장 많이 골랐고 예상대로 이겼어요' : '이긴 팀을 고른 사람이 없어요') +
      cell('rp-down', '😱 인기 팀 패배', tn(r.crash), r.crash ? pct(r.crash.share) + '%' : '–', r.crash ? r.crash.n + '명이 함께 틀렸어요' : '진 팀을 고른 사람이 없어요') +
      cell('rp-up', '🎯 역배 적중', tn(r.contrarian), r.contrarian ? pct(r.contrarian.share) + '%' : '–', r.contrarian ? r.contrarian.n + '명만 맞힌 오늘의 반전' : '소수 픽 승리가 없었어요') +
      cell('rp-up', '🏅 이번 주 보너스', '적중 보너스 합계', '+' + r.profit.total + '승', '하이리스크 ' + r.profit.high + '명 × ' + B.high.hit + '승<br>안전형 ' + r.profit.safe + '명 × ' + B.safe.hit + '승') +
      '</div><div class="rp-hitters"><b>🏆 적중자</b><div class="rp-chips">' + (r.hitters.length ? r.hitters.map(function (h) {
        return '<span>' + esc((P[h.player] || {}).name || '?') + ' +' + h.bonus + '</span>';
      }).join('') : '<em>이번 주 적중자는 없어요</em>') + '</div></div>' +
      '<div class="rp-foot"><span>라켓뚱보단 돼블스플랜</span><span class="num">' + date + '</span></div></section>';
  }
  function viewPredKing(P) {
    var b = bonusMap(), weeks = {};
    pred.all.forEach(function (p) { weeks[p.player_id] = (weeks[p.player_id] || 0) + 1; });
    var list = Object.keys(b).filter(function (id) { return P[id]; }).map(function (id) { return { id: id, v: b[id] }; })
      .sort(function (x, y) { return y.v - x.v || P[x.id].name.localeCompare(P[y.id].name, 'ko'); });
    if (!list.length) return '';
    return '<div class="card"><h3>예측왕 <span class="small muted">시즌 누적 보너스</span></h3><ol class="king">' + list.slice(0, 10).map(function (x, i) {
      return '<li' + (x.id === ui.me ? ' class="me"' : '') + '><span class="num">' + (i + 1) + '</span><b>' + esc(P[x.id].name) + '</b><span class="small muted num">' + weeks[x.id] + '주 참여</span><b class="bonus num ' + (x.v > 0 ? 'plus' : 'minus') + '">' + signed(x.v) + '</b></li>';
    }).join('') + '</ol></div>';
  }
  function reportOverlay() {
    var w = predWeek();
    if (!ui.pred.full || !w || ui.tab !== 'plan') return '';
    var rows = pred.all.filter(function (p) { return p.week_date === w.date; }), r = L.closingReport(w, pred.close, rows);
    if (!r.ready) return '';
    return '<div class="rp-overlay" role="dialog" aria-label="예측 결과 크게 보기">' + viewReport(w, r, pm()) + '<button class="btn sm" data-act="rp-close">닫기</button></div>';
  }

  // ---- 관리 › 예측 ----
  function viewAdminPred() {
    var w = predWeek(), P = pm();
    if (!w) return weekChips() + '<div class="card empty"><b>' + md(ui.week) + '(수)는 공개된 편성이 없어요</b></div>';
    if (pred.admWeek !== w.date) loadAdminList(w.date);
    var closed = isClosed(w.date);
    var out = weekChips() + '<div class="card"><div class="mp-head"><h2>' + md(w.date) + '(수) 예측' + (pred.admList ? ' <span class="num">' + pred.admList.length + '명</span>' : '') + '</h2>' +
      '<span class="chip lot">' + (closed ? '마감됨' : '마감 전') + '</span></div>' +
      '<p class="small muted">' + (closed ? '마감 후에도 고치거나 지울 수 있어요. 고치면 보너스가 바로 다시 계산돼요.' : '회원에게는 마감 전까지 인원·비율만 보이고, 여기서는 누가 골랐는지 다 보여요.') + '</p>';
    if (pred.admErr) return out + '<p class="small" style="color:var(--hell-text)">' + esc(pred.admErr) + '</p><div><button class="btn sm" data-act="pa-reload">다시 불러오기</button></div></div>';
    if (!pred.admList) return out + '<p class="small muted">불러오는 중…</p></div>';
    var rows = pred.admList.map(function (p) { return { p: p, s: L.scorePrediction(p, w), name: (P[p.player_id] || {}).name || p.player_id }; })
      .sort(function (a, b) { return (a.s.status === 'check' ? 0 : 1) - (b.s.status === 'check' ? 0 : 1) || a.name.localeCompare(b.name, 'ko'); });
    var checks = rows.filter(function (x) { return x.s.status === 'check'; }).length;
    if (checks) out += '<div class="banner warn">확인 필요 ' + checks + '명: 고른 경기가 편성에서 빠졌거나 선수 자리가 비었어요. 다른 경기로 고치거나 삭제하세요.</div>';
    if (ui.pred.adm) out += adminPredEditor(w, P);
    else out += '<div><button class="btn sm" data-act="pa-new">예측 대신 넣기</button></div>';
    out += '<div class="pub">' + (rows.length ? rows.map(function (x) {
      var del = ui.pred.admDel === x.p.player_id;
      return '<div class="pub-row"><div class="pub-who"><b>' + esc(x.name) + '</b><span class="mchip ' + x.p.mode + '">' + MODE_LABEL[x.p.mode] + '</span><span class="pred-res ' + x.s.status + '">' + resultLabel(x.s, x.p.mode) + '</span>' +
        '<span class="small muted num">' + hhmm(x.p.updated_at) + '</span></div>' + pickCells(w, x.s, P, true) +
        (del ? '<div class="banner warn"><span>' + esc(x.name) + ' 예측을 삭제할까요? 되돌릴 수 없어요.</span><span class="row"><button class="btn sm danger" data-act="pa-del-yes" data-p="' + x.p.player_id + '">삭제</button><button class="btn sm" data-act="pa-del-no">취소</button></span></div>' :
          '<div class="row"><button class="btn sm" data-act="pa-edit" data-p="' + x.p.player_id + '">고치기</button><button class="btn sm danger" data-act="pa-del" data-p="' + x.p.player_id + '">삭제</button></div>') + '</div>';
    }).join('') : '<p class="small muted">아직 제출이 없어요.</p>') + '</div></div>';
    return out;
  }
  function adminPredEditor(w, P) {
    var a = ui.pred.adm, opts = '<option value="">경기와 팀 고르기</option>' + w.matches.map(function (m) {
      return ['a', 'b'].map(function (side) { return '<option value="' + m.id + '|' + side + '">' + esc(matchLabel(w, m) + ' · ' + teamText(m, side, P)) + '</option>'; }).join('');
    }).join('');
    var sel = function (v) { return opts.replace('value="' + v + '"', 'value="' + v + '" selected'); };
    var who = a.isNew ? '<label class="f" for="pa-player">선수<select id="pa-player" data-act="pa-player"><option value="">이름을 선택하세요</option>' + groups().map(function (g) {
      return '<optgroup label="' + esc(g.name) + '">' + work.players.filter(function (p) { return p.group === g.id && p.active !== false; }).sort(function (x, y) { return x.name.localeCompare(y.name, 'ko'); })
        .map(function (p) { return '<option value="' + p.id + '"' + (a.player === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('') + '</select></label>' : '<b>' + esc((P[a.player] || {}).name || a.player) + '</b>';
    return '<div class="pa-edit">' + who +
      '<label class="f" for="pa-mode">방식<select id="pa-mode" data-act="pa-mode">' + ['high', 'safe'].map(function (k) { return '<option value="' + k + '"' + (a.mode === k ? ' selected' : '') + '>' + MODE_LABEL[k] + '</option>'; }).join('') + '</select></label>' +
      [0, 1, 2, 3].map(function (i) { return '<label class="f" for="pa-pick-' + i + '">' + (i + 1) + '번째 픽<select id="pa-pick-' + i + '" data-act="pa-pick" data-i="' + i + '">' + sel(a.picks[i] || '') + '</select></label>'; }).join('') +
      '<div class="row"><button class="btn sm primary" data-act="pa-save"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? '저장 중…' : '저장') + '</button><button class="btn sm" data-act="pa-cancel">취소</button></div></div>';
  }
  function adminPredSave() {
    var w = predWeek(), a = ui.pred.adm;
    if (!w || !a || a.busy) return;
    if (!a.player) return toast('선수를 골라 주세요.');
    var picks = a.picks.filter(Boolean).map(function (v) { var x = v.split('|'); return { match: x[0], side: x[1] }; });
    var errs = L.validatePicks(picks, w);
    if (errs.length) return toast(errs[0] === 'count' ? '서로 다른 4경기를 골라 주세요.' : errs[0] === 'dup_match' ? '같은 경기를 두 번 골랐어요.' : errs[0] === 'quota' ? quotaText(w) : '편성에 없는 경기가 있어요.');
    a.busy = true; render();
    remote.adminUpsertPrediction(token, w.date, a.player, a.mode, picks).then(function () {
      ui.pred.adm = null; toast('예측을 저장했어요.'); afterAdminPred(w.date);
    }, function (e) { a.busy = false; adminPredFail(e); });
  }
  function adminPredFail(e) {
    if (e.code === 'unauthorized') { dropAdmin(); ui.admin = false; ui.pinMsg = '관리자 로그인이 만료됐어요. PIN을 다시 입력하세요.'; render(); return; }
    toast(e.code === 'bad_quota' ? quotaText(predWeek()) : SUBMIT_ERR[e.code] || '저장하지 못했어요 (' + (e.code || '알 수 없는 오류') + ').');
  }
  function afterAdminPred(d) {
    loadAdminList(d);
    if (pred.week === d) { pred.sig = ''; refreshPred(); }
    loadAllPreds().then(render);
  }

  // ---------- 관리 ----------
  // PIN은 서버(admin_secret)에만 있음. 처음 PIN은 설치 때 SQL Editor에서 정함(README)
  function viewLock() {
    return '<div class="card lockcard"><div class="pig" aria-hidden="true"></div>' +
      '<h2>관리 화면 잠금 해제</h2>' +
      '<p class="muted small">돼장·운영진용 4자리 PIN을 입력하세요.</p>' +
      '<form id="pin-form" class="row" style="justify-content:center;align-items:flex-end">' +
      '<label class="f pinf" for="pin1">PIN 4자리<input id="pin1" class="pin num" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></label>' +
      '<button class="btn primary" type="submit"' + (pinBusy ? ' disabled' : '') + '>열기</button></form>' +
      (ui.pinMsg ? '<p class="small" style="color:var(--err)">' + esc(ui.pinMsg) + '</p>' : '') +
      '<p class="muted small">PIN은 관리 화면을 여는 열쇠예요. 한 번 열면 이 기기에서는 30일 동안 다시 묻지 않아요.</p></div>';
  }

  function viewAdmin() {
    if (ui.op) return '<div class="card lockcard"><div class="pig" aria-hidden="true"></div><h2>진행 도우미로 들어와 있어요</h2>' +
      '<p class="muted small">이번 주 탭의 <b>경기 진행</b>(코트 넣기·이김·빼기, 지금 못 하는 사람)만 할 수 있어요. 이 기기에서 계속 유지되고, 돼장이 진행 PIN을 바꾸거나 끄면 잠겨요.</p>' +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-act="tab" data-v="week">경기 진행으로</button><button class="btn" data-act="lock">잠그기</button></div>' +
      '<p class="muted small">돼장 PIN으로 들어가려면 잠근 뒤 다시 입력하세요.</p></div>';
    if (!ui.admin) return viewLock();
    var out = '<div class="row" style="justify-content:space-between"><div class="seg" role="group" aria-label="관리 메뉴">' +
      [['plan', '참석·편성'], ['seeds', '실력 순위'], ['pred', '예측'], ['settings', '설정']].map(function (s) {
        return '<button data-act="sec" data-v="' + s[0] + '" aria-pressed="' + (ui.sec === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div><button class="btn sm" data-act="lock">잠그기</button></div>';
    if (ui.sec === 'seeds') return out + viewSeeds();
    if (ui.sec === 'settings') return out + viewSettings();
    if (ui.sec === 'pred') return out + viewAdminPred();
    return out + viewPlan();
  }

  function viewShift(w, att, P) {
    var cands = L.tierCandidates(work, w.date), sel = ui.shiftSel;
    var tierOfP = {}; cands.forEach(function (c) { tierOfP[c.player] = c.tier; });
    var out = '<div class="shift"><p class="shift-title"><b>지옥도·천국도 조 옮기기</b> <span class="muted small">고른 사람만 옮겨져요. 승수는 원래 조로 들어가요.</span></p>';
    out += '<div class="row" style="align-items:flex-end"><label class="f" for="shift-p">참석자<select id="shift-p" data-act="shift-p"><option value="">이름을 선택하세요</option>' +
      groups().map(function (g) {
        var ids = Object.keys(att).filter(function (id) { return P[id] && P[id].group === g.id; }).sort(function (a, b) { return P[a].name.localeCompare(P[b].name, 'ko'); });
        if (!ids.length) return '';
        return '<optgroup label="' + esc(g.name) + '">' + ids.map(function (id) {
          var tag = tierOfP[id] === 'hell' ? ' · 지옥도' : tierOfP[id] === 'heaven' ? ' · 천국도' : '';
          var now = att[id] !== P[id].group ? ' (지금 ' + gname(att[id]) + ')' : '';
          return '<option value="' + id + '"' + (sel.p === id ? ' selected' : '') + '>' + esc(P[id].name + tag + now) + '</option>';
        }).join('') + '</optgroup>';
      }).join('') + '</select></label>' +
      '<label class="f" for="shift-dir">옮기기<select id="shift-dir" data-act="shift-dir">' +
      [['up', '한 조 위로 (승급)'], ['down', '한 조 아래로 (하향)'], ['back', '원래 조로']].map(function (o) { return '<option value="' + o[0] + '"' + (sel.dir === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></label><button class="btn primary" data-act="shift-ok">확인</button></div>';
    var moved = Object.keys(att).filter(function (id) { return P[id] && att[id] !== P[id].group; });
    if (moved.length) out += '<p class="small"><b>지금 다른 조에서 뛰는 사람</b> ' + moved.map(function (id) { return esc(P[id].name) + ' <span class="muted">(' + esc(gname(P[id].group)) + ' → ' + esc(gname(att[id])) + ')</span>'; }).join(', ') + '</p>';
    return out + '</div>';
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
    // 지옥도는 한 조 위, 천국도는 한 조 아래: 참석자와 방향을 골라 확인 (고른 사람만 옮김)
    if (Object.keys(att).length) out += viewShift(w, att, P);
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
      out += '<div class="att-group"><div class="row small" style="margin-bottom:6px"><span class="gdot g' + g.id + '">' + esc(g.name) + '</span><span class="muted num">' + cnt + '/' + ps.length + '</span></div><div class="chips">' +
        ps.map(function (p) {
          var mv = att[p.id] && att[p.id] !== p.group ? (poolOrder(att[p.id]) < poolOrder(p.group) ? '↑' : '↓') : '';
          return '<button data-act="att" data-p="' + p.id + '" aria-pressed="' + !!att[p.id] + '"' + (mv ? ' title="' + esc(gname(att[p.id])) + '조에서 경기"' : '') + '>' + esc(p.name) + (mv ? ' <b class="mv ' + (mv === '↑' ? 'up' : 'down') + '">' + mv + '</b>' : '') + '</button>';
        }).join('') + '</div></div>';
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
    // 조별 메뉴바: 한 번에 한 조만 보여 줌
    var issuesAll = w.matches.length || attIds.length ? L.validateWeek(work, w) : [];
    var issueGroup = function (x) {
      if (x.match) { var mm = w.matches.filter(function (m) { return m.id === x.match; })[0]; return mm ? mm.pool : null; }
      if (x.pid) return att[x.pid] || (P[x.pid] && P[x.pid].group);
      return null;
    };
    var pg = groups().filter(function (x) { return x.id === ui.planGroup; })[0] || groups()[0];
    out += '<div class="gsel plan-tabs" role="tablist" aria-label="편성할 조">' + groups().map(function (g) {
      var n = attIds.filter(function (id) { return att[id] === g.id; }).length;
      var mc = w.matches.filter(function (m) { return m.pool === g.id; }).length;
      var warn = issuesAll.some(function (x) { return issueGroup(x) === g.id; });
      return '<button role="tab" class="g' + g.id + '" data-act="plang" data-v="' + g.id + '" aria-pressed="' + (g.id === pg.id) + '" aria-selected="' + (g.id === pg.id) + '">' + esc(g.name).split('·').join('·<br>') +
        '<span class="tab-sub num">' + n + '명 · ' + mc + '경기' + (warn ? ' <i class="tab-warn" title="점검 필요">!</i>' : '') + '</span></button>';
    }).join('') + '</div>';
    (function (g) {
      var pool = attIds.filter(function (id) { return att[id] === g.id; });
      var ms = w.matches.filter(function (m) { return m.pool === g.id; });
      out += '<div class="editor"><div class="group-head"><h3 class="gdot g' + g.id + '">' + esc(g.name) + ' · ' + pool.length + '명</h3><span class="row"><span class="muted small num">' + (pool.length >= 4 ? '필요 ' + Math.ceil(pool.length / 2) + '경기' : '4명 이상 필요') + '</span>' +
        '<button class="btn sm" data-act="gen" data-g="' + g.id + '"' + (pool.length < 4 ? ' disabled' : '') + '>이 조 자동 편성</button></span></div>';
      if (!pool.length && !ms.length) out += '<p class="small muted">이 조는 이번 주 참석자가 없어요. 위 참석자 목록에서 체크하거나 \'편성 조 옮기기\'로 사람을 옮겨 주세요.</p>';
      if (pool.length) out += '<p class="small"><span class="muted">실력순 </span>' + pool.slice().sort(function (x, y) { return L.strengthOf(work, y, w.date, g.id) - L.strengthOf(work, x, w.date, g.id); }).map(function (id) {
        var t = L.tierOf(work, id, w.date).tier;
        return '<span class="pl ' + (t === 'hell' || t === 'heaven' || t === 'mid' ? 't-' + t : '') + '">' + esc(P[id].name) + '</span>';
      }).join(' ') + '</p>';
      ms.forEach(function (m, i) { out += editMatch(m, i, w, attIds, P); });
      out += '<div><button class="btn sm" data-act="add-match" data-g="' + g.id + '">+ 경기 추가</button></div></div>';
    })(pg);
    var orphan = w.matches.filter(function (m) { return poolOrder(m.pool) === 99; });
    orphan.forEach(function (m, i) { out += editMatch(m, i, w, attIds, P); });
    out += '</div>';

    // 2-1. 돼장 요청 (Claude가 편성 수정)
    out += viewAi(w, attIds);

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

  // ---------- 돼장 요청: 글로 적으면 Claude가 조건·수정 계획을 만들고, 미리 보고 적용 ----------
  function matchLine(m, P) {
    var n = function (t) { return t.map(function (p) { return P[p] ? P[p].name : '빈 자리'; }).join('·'); };
    var off = (m.off || []).map(function (p) { return P[p] ? P[p].name : '?'; });
    return esc(n(m.a)) + ' <span class="muted">vs</span> ' + esc(n(m.b)) + (off.length ? ' <span class="muted small">(추가출전 ' + esc(off.join(', ')) + ')</span>' : '');
  }
  function viewAi(w, attIds) {
    var P = pm(), ai = ui.ai, rules = w.rules || [];
    var out = '<div class="card ai-card"><h2>돼장 요청</h2>' +
      '<p class="small muted">자동 편성을 어떻게 고칠지 글로 적어 보내면 Claude가 고쳐 줘요. 예) "철수·영희 같은 팀 금지", "A조 3경기 민수랑 지훈 바꿔줘", "추가출전은 지훈 말고 다른 사람". 미리 보고 <b>적용</b>을 눌러야 바뀌어요.</p>';
    if (rules.length) {
      out += '<p class="small" style="margin-bottom:4px"><b>이번 주 조건</b> <span class="muted">자동 편성을 다시 눌러도 지켜요</span></p><div class="plist">' + rules.map(function (r) {
        return '<div class="prow"><span class="small">' + esc(L.ruleText(work, r)) + '</span><span></span><button class="btn sm" data-act="rule-del" data-r="' + esc(r.id) + '">지우기</button></div>';
      }).join('') + '</div>';
    }
    out += '<label class="f" for="ai-text">요청<textarea id="ai-text" maxlength="500" placeholder="예) 박강호랑 조영재는 같은 팀 하지 말아 줘">' + esc(ai.text) + '</textarea></label>' +
      '<div class="row"><button class="btn primary" data-act="ai-send"' + (ai.busy || attIds.length < 4 ? ' disabled' : '') + '>보내기</button>' +
      (ai.busy ? '<span class="small">Claude가 편성을 고치는 중이에요… (보통 10~40초)</span>' : '') + '</div>';
    if (ai.err) out += '<div class="banner warn" role="alert"><span>' + esc(ai.err) + '</span></div>';
    var res = ai.res;
    if (res) {
      var nw = res.out.week, before = res.before;
      var kept = function (m) { return before.matches.some(function (b) { return b.id === m.id && same2(b, m); }); };
      out += '<div class="ai-preview"><p class="ai-say">' + esc(res.explanation || '요청을 반영한 편성이에요.') + '</p>';
      var added = (nw.rules || []).filter(function (r) { return !(before.rules || []).some(function (b) { return b.id === r.id; }); });
      if (added.length) out += '<p class="small"><b>추가할 조건</b> ' + added.map(function (r) { return esc(L.ruleText(work, r)); }).join(', ') + '</p>';
      var changed = groups().filter(function (g) {
        var a = nw.matches.filter(function (m) { return m.pool === g.id; }), b = before.matches.filter(function (m) { return m.pool === g.id; });
        return a.length !== b.length || a.some(function (m) { return !kept(m); });
      });
      if (!changed.length && !added.length && !res.out.errors.length) out += '<p class="small muted">바뀌는 경기가 없어요.</p>';
      changed.forEach(function (g) {
        out += '<h3 class="gdot g' + g.id + '">' + esc(g.name) + (res.out.regenerated.indexOf(g.id) >= 0 ? ' <span class="muted small">다시 짬</span>' : '') + '</h3><div class="plist">' +
          nw.matches.filter(function (m) { return m.pool === g.id; }).map(function (m, i) {
            return '<div class="ai-line' + (kept(m) ? '' : ' changed') + '"><span class="num">' + (i + 1) + '경기</span><span>' + matchLine(m, P) + '</span>' + (kept(m) ? '' : '<span class="chip lot">바뀜</span>') + '</div>';
          }).join('') + '</div>';
      });
      var issues = L.validateWeek(work, nw);
      var lost = res.out.regenerated.map(function (gid) {
        var n = before.matches.filter(function (m) { return m.pool === gid && m.win; }).length;
        return n ? '<li class="error">' + esc(gname(gid)) + '조에 입력된 결과 ' + n + '경기가 새 편성으로 바뀌면서 지워져요.</li>' : '';
      }).join('');
      out += '<ul class="issues">' + lost + res.out.errors.map(function (e) { return '<li class="error">반영 못 한 것: ' + esc(e) + '</li>'; }).join('') +
        (res.out.warnings || []).map(function (e) { return '<li class="warn">' + esc(e) + '</li>'; }).join('') +
        (issues.length ? issues.map(function (x) { return '<li class="' + x.level + '">' + esc(x.msg) + '</li>'; }).join('') : '<li class="ok">점검 통과: 전원 공식 2경기, 파트너 중복 없음' + ((nw.rules || []).length ? ', 조건 지킴' : '') + '</li>') + '</ul>' +
        (changed.length || !same(nw.rules || [], before.rules || [])
          ? '<div class="row"><button class="btn primary" data-act="ai-apply">적용</button><button class="btn" data-act="ai-cancel">취소</button></div>'
          : '<div class="row"><button class="btn" data-act="ai-cancel">닫기</button></div>') + '</div>';
    }
    return out + '</div>';
  }
  function same2(a, b) { return same([a.a, a.b, a.off || []], [b.a, b.b, b.off || []]); }
  function aiPayload(w) {
    var P = pm(), att = w.attendees || {}, idx = {};
    return {
      request: ui.ai.text.trim(),
      date: w.date,
      groups: groups().map(function (g) { return { id: g.id, name: g.name }; }),
      players: Object.keys(att).filter(function (id) { return P[id]; }).map(function (id) {
        return { id: id, name: P[id].name, group: P[id].group, pool: att[id], tier: TIER_LABEL[L.tierOf(work, id, w.date).tier] };
      }),
      matches: w.matches.map(function (m) {
        idx[m.pool] = (idx[m.pool] || 0) + 1;
        return { id: m.id, pool: m.pool, label: gname(m.pool) + ' ' + idx[m.pool] + '경기', a: m.a, b: m.b, off: m.off || [], decided: !!m.win };
      }),
      rules: (w.rules || []).map(function (r) { return { id: r.id, type: r.type, players: r.players, text: L.ruleText(work, r) }; }),
    };
  }
  function tmpId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  var AI_ERR = {
    ai_limit: '오늘 보낼 수 있는 요청 횟수를 다 썼어요. 내일 다시 해 주세요.',
    ai_refused: 'Claude가 이 요청은 처리하지 않았어요. 다르게 적어 보세요.',
    bad_request: '요청이 비어 있거나 너무 길어요. 500자 안으로 적어 주세요.',
    network: '인터넷에 연결되지 않았어요. 연결을 확인하고 다시 보내 주세요.',
  };
  function aiSend() {
    var w = ensureWeek(ui.week);
    if (!ui.ai.text.trim()) { ui.ai.err = '요청을 먼저 적어 주세요.'; render(); return; }
    if (!token) { ui.ai.err = '관리자 로그인이 필요해요.'; render(); return; }
    ui.ai.busy = true; ui.ai.err = ''; ui.ai.res = null; render();
    var before = clone(w), base = JSON.stringify(w);
    remote.rematch(token, aiPayload(w)).then(function (r) {
      ui.ai.busy = false;
      var out = L.applyPlan(work, w.date, r.plan, { seed: (Math.random() * 4294967296) >>> 0, newId: tmpId });
      ui.ai.res = { explanation: r.explanation, out: out, before: before, base: base, date: w.date };
      render();
    }, function (e) {
      ui.ai.busy = false;
      var code = e && e.code;
      if (code === 'unauthorized') { dropAdmin(); ui.admin = false; ui.pinMsg = '관리자 로그인이 만료됐어요. PIN을 다시 입력하세요.'; }
      ui.ai.err = AI_ERR[code] || '편성 수정 요청에 실패했어요 (' + (code || '알 수 없는 오류') + '). 잠시 후 다시 해 주세요.';
      render();
    });
  }
  function aiApply() {
    var res = ui.ai.res, w = getWeek(res.date);
    if (!w || JSON.stringify(w) !== res.base) { ui.ai.res = null; toast('그사이 편성이 바뀌었어요. 요청을 다시 보내 주세요.'); return; }
    work.weeks[work.weeks.indexOf(w)] = res.out.week;
    ui.ai.res = null; ui.ai.text = '';
    commit();
    toast('요청을 반영했어요. 점검 결과를 확인하고 저장해 주세요.');
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

  function viewSettings() {
    return '' +
      '<div class="card"><h2>고정 코트 번호</h2><p class="small muted">경기 진행 화면에 늘 보이는 코트예요. 쉼표로 나눠 적어요(예: 5, 6). 추가 코트는 그날 경기 진행 화면에서 번호 없이 열어요.</p>' +
      '<form id="court-form" class="row" style="align-items:flex-end"><label class="f" for="court-nums">코트 번호<input id="court-nums" class="num" inputmode="numeric" value="' + esc(L.courtSlots(work.settings, null).join(', ')) + '"></label><button class="btn primary" type="submit">바꾸기</button></form></div>' +
      '<div class="card"><h2>진행 PIN</h2><p class="small muted">경기 진행(코트 넣기·이김·빼기, 지금 못 하는 사람)만 할 수 있는 PIN이에요. 도우미에게 알려 주면 관리 탭에서 이 PIN으로 들어와요. 이 기기에서 계속 유지되고, 관리 PIN과는 달라야 해요. 바꾸거나 끄면 도우미 로그인은 모두 끊겨요.</p>' +
      '<form id="op-pin-form" class="row" style="align-items:flex-end"><label class="f pinf" for="op-pin">새 진행 PIN<input id="op-pin" class="pin num" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></label>' +
      '<button class="btn primary" type="submit">정하기</button><button class="btn" type="button" data-act="op-pin-off">진행 PIN 끄기</button></form></div>' +
      '<div class="card"><h2>관리 PIN 바꾸기</h2><form id="pin-change" class="row" style="align-items:flex-end"><label class="f pinf" for="pc0">지금 PIN<input id="pc0" class="pin num" type="password" inputmode="numeric" maxlength="4"></label><label class="f pinf" for="pc1">새 PIN<input id="pc1" class="pin num" type="password" inputmode="numeric" maxlength="4"></label><label class="f pinf" for="pc2">한 번 더 입력<input id="pc2" class="pin num" type="password" inputmode="numeric" maxlength="4"></label><button class="btn" type="submit">바꾸기</button></form></div>' +
      '<p class="small muted num">마지막 저장: ' + (saved.savedAt ? new Date(saved.savedAt).toLocaleString('ko-KR') : '-') + ' · 버전 ' + saved.rev + '</p>';
  }

  function saveBar() {
    var b = '';
    if (ui.saveError) b += '<div class="banner warn" role="alert"><span>' + esc(ui.saveError) + '</span><span class="row"><button class="btn sm primary" data-act="save">다시 저장</button><button class="btn sm" data-act="err-close">닫기</button></span></div>';
    if (ui.draftConflict) {
      b += '<div class="banner warn">이 기기에 저장 못 한 변경이 있는데, 그사이 다른 곳에서 새로 저장됐어요.<span class="row"><button class="btn sm" data-act="draft-load">내 변경 불러오기</button><button class="btn sm" data-act="draft-drop">버리기</button></span></div>';
    }
    return b;
  }

  // 경기 진행 동작: 서버(live_action)가 그 경기 하나만 바꿈 → 돼장·도우미 여러 기기가 동시에 눌러도 서로 덮어쓰지 않음.
  // fn은 같은 규칙(logic.js)으로 먼저 확인하고, 돼장 기기에 저장 안 한 변경이 있으면 그 변경 위에도 똑같이 적용
  var LIVE_ERR = { court_busy: '그 코트는 방금 다른 기기에서 찼어요.', player_busy: '그 경기 선수가 방금 다른 코트에 들어갔어요.', already_done: '방금 다른 기기에서 결과가 들어갔어요.', not_on_court: '이미 코트에서 빠진 경기예요.', no_match: '편성이 바뀌어 없는 경기예요.' };
  function liveEdit(fn, action, mid, court, side, msg) {
    var w = getWeek(ui.week), d = ui.week;
    if (!w || !token || ui.liveBusy) return;
    if (!fn(clone(w), new Date().toISOString())) { toast('지금은 할 수 없어요. 화면을 다시 확인해 주세요.'); return; }
    ui.liveBusy = true; render();
    remote.liveAction(token, d, mid, action, court, side).then(function () {
      return remote.load().then(function (s) {
        var wasDirty = dirty();
        saved = s;
        if (!wasDirty) work = clone(s);
        else { var mw = getWeek(d); if (mw) fn(mw, new Date().toISOString()); }
        live.stateAt = Date.now(); ui.liveBusy = false; toast(msg);
      });
    }).catch(function (e) {
      ui.liveBusy = false;
      var code = e && e.code;
      if (code === 'unauthorized') { dropAdmin(); ui.admin = false; ui.pinMsg = '로그인이 만료됐어요. PIN을 다시 입력하세요.'; toast('로그인이 만료됐어요. 관리 탭에서 PIN을 다시 입력해 주세요.'); return; }
      toast(LIVE_ERR[code] || (code === 'network' ? '인터넷 연결을 확인해 주세요.' : '저장하지 못했어요 (' + (code || '오류') + ').'));
      reloadState().then(function () { render(); });
    });
  }
  var AVAIL_ERR = { not_today: '경기날 당일에만 표시할 수 있어요.', not_attending: '이번 주 참석 명단에 없어요.', admin_locked: '돼장이 오늘 못 함으로 표시했어요. 돼장에게 말해 주세요.', bad_minutes: '시간이 잘못됐어요.', unauthorized: '관리자 로그인이 만료됐어요. PIN을 다시 입력해 주세요.', network: '인터넷 연결을 확인해 주세요.' };
  function setAvail(admin, pid, st, minutes) {
    var d = ui.week;
    if (!pid || !d) return;
    var p = admin ? remote.adminSetAvailability(token, d, pid, st, minutes) : remote.setAvailability(d, pid, st, minutes);
    ui.lvPick = ''; if (admin) ui.lvAdd = false;
    p.then(function () { return loadAvail(d); }).then(function () { render(); }, function (e) { toast(AVAIL_ERR[e && e.code] || '저장하지 못했어요 (' + (e && e.code || '오류') + ').'); });
  }
  function render() {
    var app = document.getElementById('app');
    var focusId = document.activeElement && document.activeElement.id;
    SN = null;   // 명단이 바뀌었을 수 있으니 그릴 때마다 다시
    var main = ui.tab === 'rank' ? viewRank() : ui.tab === 'plan' ? viewPredict() : ui.tab === 'me' ? viewMe() : ui.tab === 'admin' ? viewAdmin() : viewWeek();
    var html = header() + '<main>' + saveBar() + main + '</main>';
    if (dirty() || ui.busy && ui.busy.indexOf('편성') !== 0) {
      html += '<div class="savebar" role="region" aria-label="저장"><div class="in"><span>' + esc(ui.busy || '저장 안 된 변경이 있어요') + '</span>' +
        (ui.busy ? '' : '<span class="row"><button class="btn sm" data-act="revert">되돌리기</button><button class="btn sm primary" data-act="save">저장</button></span>') + '</div></div>';
    }
    html += reportOverlay();
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
      var w = ensureWeek(ui.week), errs = [], split = [];
      gids.forEach(function (gid) {
        var ids = Object.keys(w.attendees).filter(function (id) { return w.attendees[id] === gid && pm()[id]; });
        if (!ids.length) return;
        // 이번 주 조건(돼장 요청)까지 지켜서 짬
        var r = L.regenPool(work, w, gid, (Math.random() * 4294967296) >>> 0, newId);
        if (r.error) errs.push(gname(gid) + ': ' + r.error);
        else r.split.forEach(function (id) { if (split.indexOf(id) < 0) split.push(id); });
      });
      if (split.length) errs.push(split.map(function (id) { return pm()[id].name; }).join(', ') + ': 두 조 경기에 나눠 들어가 있어요. 편성 조 옮기기로 한 조를 정해 주세요');
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
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    if (act === 'retry') { location.reload(); return; }
    if (!work) return;
    var w, m, P;
    switch (act) {
      case 'awv': ui.awv = v; render(); break;
      case 'lv-extra': liveEdit(function (w) { return L.setExtraCourt(w, el.getAttribute('data-v') === '1'); }, el.getAttribute('data-v') === '1' ? 'extra_open' : 'extra_close', null, null, null, el.getAttribute('data-v') === '1' ? '추가 코트를 열었어요.' : '추가 코트를 닫았어요.'); break;
      case 'lv-start': liveEdit(function (w, t) { return L.startMatch(w, el.getAttribute('data-m'), +el.getAttribute('data-c'), t, L.courtSlots(work.settings, w)); }, 'start', el.getAttribute('data-m'), +el.getAttribute('data-c'), null, '코트에 넣었어요.'); break;
      case 'lv-win': liveEdit(function (w, t) { return L.finishMatch(w, el.getAttribute('data-m'), el.getAttribute('data-side'), t); }, 'finish', el.getAttribute('data-m'), null, el.getAttribute('data-side'), '결과를 저장했어요.'); break;
      case 'lv-cancel': liveEdit(function (w) { return L.cancelMatch(w, el.getAttribute('data-m')); }, 'cancel', el.getAttribute('data-m'), null, null, '코트에서 뺐어요.'); break;
      case 'op-pin-off': remote.setOperatorPin(token, null).then(function () { toast('진행 PIN을 껐어요. 도우미 로그인도 모두 끊겼어요.'); }, function (e) { toast('진행 PIN을 끄지 못했어요 (' + e.code + ').'); }); break;
      case 'lv-add': ui.lvAdd = !ui.lvAdd; ui.lvPick = ''; render(); break;
      case 'lv-pick': ui.lvPick = el.getAttribute('data-p') || ''; render(); break;
      case 'lv-done': ev.preventDefault(); ui.lvDone = !ui.lvDone; render(); break;
      case 'lv-set': setAvail(true, el.getAttribute('data-p'), el.getAttribute('data-st'), null); break;
      case 'my-avail': setAvail(false, ui.me, el.getAttribute('data-st'), null); break;
      case 'wview': ui.wview = v === 'all' ? 'all' : 'mine'; LS.set(KEY.wview, ui.wview); render(); break;
      case 'tab': ui.tab = v; LS.set(KEY.tab, v); ui.notice = null; ui.pred.edit = false; ui.pred.full = false; ui.pred.confirm = false; render(); window.scrollTo(0, 0); break;
      case 'week': ui.week = v; SS.set(SKEY.week, v); ui.confirm = null; ui.notice = null; ui.ai.res = null; ui.ai.err = ''; ui.shiftSel = { p: '', dir: 'up' }; ui.pred.edit = false; ui.pred.more = false; ui.pred.adm = null; ui.pred.admDel = ''; render(); break;
      case 'rankg': ui.rankGroup = v; render(); break;
      case 'sec': ui.sec = v; SS.set(SKEY.sec, v); render(); break;
      case 'lock': ui.admin = false; ui.op = false; forgetAdmin(); render(); break;
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
      case 'shift-ok':
        var sel = ui.shiftSel;
        if (!sel.p) { toast('옮길 참석자를 먼저 골라 주세요.'); return; }
        w = ensureWeek(ui.week);
        var to = L.shiftTarget(work, sel.p, sel.dir), nm2 = pm()[sel.p].name;
        if (!to) { toast(nm2 + ': ' + (sel.dir === 'up' ? '맨 위 조라 더 올릴 수 없어요.' : '맨 아래 조라 더 내릴 수 없어요.')); return; }
        if (w.attendees[sel.p] === to) { toast(nm2 + ': 이미 ' + gname(to) + '조에서 경기해요.'); return; }
        w.attendees[sel.p] = to;
        ui.shiftSel = { p: '', dir: 'up' };
        commit();
        toast(nm2 + ': ' + gname(to) + '조에서 경기해요.' + (w.matches.length ? ' 자동 편성을 다시 눌러 주세요.' : '')); break;
      case 'ai-send': aiSend(); break;
      case 'ai-apply': aiApply(); break;
      case 'ai-cancel': ui.ai.res = null; render(); break;
      case 'rule-del':
        w = getWeek(ui.week); if (!w) return;
        var rid = el.getAttribute('data-r');
        w.rules = (w.rules || []).filter(function (r) { return r.id !== rid; });
        if (!w.rules.length) delete w.rules;
        commit(); break;
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
      case 'seedg': ui.seedGroup = v; render(); break;
      case 'plang': ui.planGroup = v; render(); break;
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
      // 돼블스플랜
      case 'pp-filter': ui.pred.filter = v; ui.pred.more = false; render(); break;
      case 'pp-view': ui.pred.view = v; ui.pred.more = false; render(); break;
      case 'pp-more': ui.pred.more = !ui.pred.more; render(); break;
      case 'pred-retry': pred.sig = ''; refreshPred(); loadAllPreds().then(render); break;
      case 'pe-open': openPredEdit(); render(); window.scrollTo(0, 0); break;
      case 'pe-close': ui.pred.edit = false; ui.pred.confirm = false; render(); window.scrollTo(0, 0); break;
      case 'pe-mode': ui.pred.mode = v; render(); break;
      case 'pe-pick':
        var pk = ui.pred.picks, pmid = el.getAttribute('data-m'), pside = el.getAttribute('data-side');
        var cur = pk.filter(function (x) { return x.match === pmid; })[0];
        if (cur && cur.side === pside) ui.pred.picks = pk.filter(function (x) { return x !== cur; });
        else if (cur) cur.side = pside;
        else {
          var pw = predWeek(), qst = pw && L.quotaStatus(pk, pw), pm2 = pw && matchById(pw, pmid);
          if (qst && pm2 && (!qst[pm2.pool] || qst[pm2.pool].full)) { toast(gname(pm2.pool) + '조는 ' + (qst[pm2.pool] ? qst[pm2.pool].need + '경기만' : '고를 수 없어요') + '. 고른 경기를 한 번 더 눌러 빼고 골라 주세요.'); return; }
          if (pk.length < L.PREDICT.picks) pk.push({ match: pmid, side: pside });
        }
        render(); break;
      case 'pe-submit': submitPred(); break;
      case 'pc-yes': sendPred(); break;
      case 'pc-no':
        ui.pred.confirm = false; render();
        var ms = document.getElementById('me-select'); if (ms) { window.scrollTo(0, ms.getBoundingClientRect().top + window.scrollY - 120); try { ms.focus(); } catch (e) { } }
        break;
      case 'rp-full': ui.pred.full = true; render(); break;
      case 'rp-close': ui.pred.full = false; render(); break;
      case 'pa-reload': pred.admWeek = null; render(); break;
      case 'pa-new': ui.pred.adm = { isNew: true, player: '', mode: 'high', picks: ['', '', '', ''] }; ui.pred.admDel = ''; render(); break;
      case 'pa-edit':
        var ep = (pred.admList || []).filter(function (x) { return x.player_id === el.getAttribute('data-p'); })[0]; if (!ep) return;
        ui.pred.adm = { isNew: false, player: ep.player_id, mode: ep.mode, picks: ep.picks.map(function (x) { return x.match + '|' + x.side; }).concat(['', '', '', '']).slice(0, 4) };
        ui.pred.admDel = ''; render(); window.scrollTo(0, 0); break;
      case 'pa-cancel': ui.pred.adm = null; render(); break;
      case 'pa-save': adminPredSave(); break;
      case 'pa-del': ui.pred.admDel = el.getAttribute('data-p'); render(); break;
      case 'pa-del-no': ui.pred.admDel = ''; render(); break;
      case 'pa-del-yes':
        var dp = el.getAttribute('data-p'), dw = predWeek(); ui.pred.admDel = ''; if (!dw) return;
        remote.adminDeletePrediction(token, dw.date, dp).then(function () { toast('예측을 삭제했어요.'); afterAdminPred(dw.date); }, adminPredFail);
        break;
      case 'err-close': ui.saveError = null; render(); break;
      case 'revert': work = clone(saved); LS.del(KEY.draft); ui.unknown = []; ui.confirm = null; render(); toast('저장된 상태로 되돌렸어요.'); break;
      case 'draft-load': work = ui.draftConflict.state; ui.draftConflict = null; work.rev = saved.rev; commit(); toast('내 변경을 불러왔어요. 저장하면 최신 버전을 덮어써요.'); break;
      case 'draft-drop': ui.draftConflict = null; LS.del(KEY.draft); render(); break;
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target, act = el.getAttribute('data-act');
    if (!act || !work) return;
    var m, P = pm();
    switch (act) {
      case 'me': ui.pred.confirm = false; ui.me = el.value; if (el.value) LS.set(KEY.me, el.value); else LS.del(KEY.me); ui.rankGroup = null; if (ui.pred.edit && localPred(ui.week, ui.me)) openPredEdit(); render(); break;
      case 'pa-player': if (ui.pred.adm) ui.pred.adm.player = el.value; break;
      case 'pa-mode': if (ui.pred.adm) ui.pred.adm.mode = el.value; break;
      case 'pa-pick': if (ui.pred.adm) ui.pred.adm.picks[+el.getAttribute('data-i')] = el.value; break;
      case 'slot':
        m = findMatch(el.getAttribute('data-m')); if (!m) return;
        m[el.getAttribute('data-side')][+el.getAttribute('data-k')] = el.value;
        m.off = (m.off || []).filter(function (p) { return m.a.concat(m.b).indexOf(p) >= 0; });
        commit(); break;
      case 'pool':
        var pw = ensureWeek(ui.week), pp2 = el.getAttribute('data-p');
        pw.attendees[pp2] = el.value; commit();
        if (pw.matches.some(function (m) { return m.pool !== el.value && m.a.concat(m.b).indexOf(pp2) >= 0; })) toast('아직 다른 조 경기에 들어가 있어요. 두 조를 자동 편성으로 다시 짜 주세요.');
        break;
      case 'pname':
        var nm = el.value.trim();
        if (!nm) { render(); return; }
        if (work.players.some(function (p) { return p.name === nm && p.id !== el.getAttribute('data-p'); })) { toast('같은 이름이 이미 있어요. 동명이인이면 "김민수B"처럼 구분해 주세요.'); render(); return; }
        P[el.getAttribute('data-p')].name = nm; commit(); break;
      case 'pgroup': P[el.getAttribute('data-p')].group = el.value; commit(); break;
      case 'shift-p':
        // 지옥도면 승급, 천국도면 하향, 이미 옮긴 사람이면 원래 조로를 기본으로
        var c2 = L.tierCandidates(work, ui.week).filter(function (c) { return c.player === el.value; })[0], aw = getWeek(ui.week);
        ui.shiftSel = { p: el.value, dir: aw && el.value && aw.attendees[el.value] !== P[el.value].group ? 'back' : c2 ? (c2.tier === 'hell' ? 'up' : 'down') : 'up' };
        render(); break;
      case 'shift-dir': ui.shiftSel.dir = el.value; break;
    }
  });
  document.addEventListener('input', function (ev) { if (ev.target.id === 'paste') ui.paste = ev.target.value; if (ev.target.id === 'seed-text') ui.seedText[ui.seedGroup] = ev.target.value; if (ev.target.id === 'ai-text') ui.ai.text = ev.target.value; });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (!work) return;
    if (f.id === 'pin-form') {
      var p1 = document.getElementById('pin1').value;
      if (!/^\d{4}$/.test(p1)) { ui.pinMsg = '숫자 4자리를 입력하세요.'; render(); return; }
      if (pinBusy) return;
      pinBusy = true; ui.pinMsg = ''; render();
      remote.login(p1).then(function (t) {
        if (t) { pinBusy = false; rememberAdmin(t); ui.admin = true; ui.op = false; render(); return; }
        // 관리 PIN이 아니면 진행 PIN인지 (진행 도우미: 계속 유지, 경기 진행만)
        return remote.operatorLogin(p1).catch(function (e) { if (e && e.code === 'no_op_pin') return null; throw e; }).then(function (ot) {
          pinBusy = false;
          if (!ot) { ui.pinMsg = 'PIN이 맞지 않아요.'; render(); return; }
          token = ot; R.saveToken(LS, ot, Date.now(), 'operator', Date.now() + R.OP_DAYS * 864e5);
          ui.op = true; ui.admin = false; ui.tab = 'week'; LS.set(KEY.tab, 'week'); toast('진행 도우미로 들어왔어요. 이 기기에서 계속 유지돼요.');
        });
      }).catch(function (e) {
        pinBusy = false;
        ui.pinMsg = e.code === 'no_pin' ? '관리 PIN이 아직 설정되지 않았어요. 설치 안내(README)대로 PIN을 먼저 정해 주세요.' :
          e.code === 'network' ? '인터넷 연결을 확인하고 다시 해 주세요.' : '잠금을 해제하지 못했어요 (' + e.code + ').';
        render();
      });
    } else if (f.id === 'court-form') {
      var nums = document.getElementById('court-nums').value.split(/[,\s]+/).filter(Boolean).map(Number);
      if (!nums.length || nums.some(function (n) { return !(n >= 1 && n <= 99 && n === Math.floor(n)); }) || new Set(nums).size !== nums.length) { toast('1~99 숫자를 쉼표로 나눠 적어 주세요 (예: 5, 6).'); return; }
      work.settings.courts = nums; save();
    } else if (f.id === 'op-pin-form') {
      var np = document.getElementById('op-pin').value;
      if (!/^\d{4}$/.test(np)) { toast('숫자 4자리를 입력하세요.'); return; }
      remote.setOperatorPin(token, np).then(function () { document.getElementById('op-pin').value = ''; toast('진행 PIN을 정했어요. 도우미에게 알려 주세요.'); }, function (e) {
        toast(e.code === 'same_as_admin' ? '관리 PIN과 다른 번호로 정해 주세요.' : e.code === 'unauthorized' ? '관리자 로그인이 만료됐어요. PIN을 다시 입력해 주세요.' : '진행 PIN을 정하지 못했어요 (' + e.code + ').');
      });
    } else if (f.id === 'pin-change') {
      var o = document.getElementById('pc0').value, a = document.getElementById('pc1').value, b = document.getElementById('pc2').value;
      if (!/^\d{4}$/.test(o)) { toast('지금 PIN 4자리를 입력하세요.'); return; }
      if (!/^\d{4}$/.test(a) || a !== b) { toast('새 PIN 4자리를 두 번 똑같이 입력하세요.'); return; }
      remote.changePin(token, o, a).then(function () {
        toast('PIN을 바꿨어요. 다른 기기에서는 새 PIN을 다시 입력해야 해요.');
      }, function (e) {
        if (e.code === 'bad_pin') toast('지금 PIN이 맞지 않아요.');
        else if (e.code === 'same_as_operator') toast('진행 PIN과 다른 번호로 정해 주세요.');
        else if (e.code === 'unauthorized') { dropAdmin(); ui.admin = false; ui.pinMsg = '관리자 로그인이 만료됐어요. PIN을 다시 입력하세요.'; render(); }
        else toast('PIN을 바꾸지 못했어요 (' + e.code + ').');
      });
    } else if (f.id === 'add-player') {
      var nm = document.getElementById('np-name').value.trim(), g = document.getElementById('np-group').value;
      if (!nm) return;
      if (work.players.some(function (p) { return p.name === nm; })) { toast('같은 이름이 이미 있어요.'); return; }
      work.players.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: nm, group: g });
      commit(); toast(nm + ' 선수를 추가했어요.');
    }
  });

  // ---------- 시작: Supabase에서 state 읽기 ----------
  function bootView(msg, retry) {
    document.getElementById('app').innerHTML = '<main><div class="card empty"><div class="pig" aria-hidden="true"></div><b>' + esc(msg) + '</b>' +
      (retry ? '<p class="muted">인터넷 연결을 확인하고 다시 시도해 주세요.</p><button class="btn primary" data-act="retry">다시 시도</button>' : '') + '</div></main>';
  }
  function start(state) {
    saved = state; work = clone(saved);
    restoreDraft();
    if (!ui.week || seasonDates().indexOf(ui.week) < 0) ui.week = defaultWeek();
    var sess = R.loadSession(LS, Date.now());
    token = sess ? sess.token : null;
    ui.admin = !!sess && sess.role === 'admin'; ui.op = !!sess && sess.role === 'operator';
    render();
    // 돼블스플랜: 마감된 주의 예측(보너스 계산용), 카운트다운·다시 읽기 타이머
    loadAllPreds().then(render);
    setInterval(predTick, 1000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && pred.week) { refreshPred(); loadAllPreds().then(render); } });
    // 기억한 토큰이 만료·무효(PIN 변경 등)면 PIN 입력 화면으로
    if (token) remote.liveCheck(token).then(function (role) {
      if (!role) { dropAdmin(); ui.admin = false; render(); return; }
      if ((role === 'admin') !== ui.admin) { ui.admin = role === 'admin'; ui.op = role === 'operator'; render(); }
    }, function () { });
  }
  try { remote = R.connect(window.DDW_CONFIG, window.supabase); }
  catch (e) { bootView(e.code === 'config' ? 'config.js에 Supabase 주소와 키를 넣어 주세요.' : '데이터를 불러오지 못했어요.', e.code !== 'config'); return; }
  remote.load().then(start, function (e) { if (window.console) console.error(e); bootView('데이터를 불러오지 못했어요.', true); });
})();
