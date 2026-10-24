(function () {
  'use strict';
  var L = window.Logic, R = window.Remote;
  var KEY = { me: 'ddw-me', draft: 'ddw-draft', tab: 'ddw-tab' };
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
    admin: false,
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
  function dropAdmin() { token = null; R.clearToken(LS); }
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
      ui.busy = null; toast('저장했어요.');
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
      '<nav class="tabs" role="tablist">' + [['week', '이번 주'], ['rank', '순위'], ['me', '내 기록'], ['admin', '관리']].map(function (t) {
        return '<button role="tab" data-act="tab" data-v="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + t[1] + (t[0] === 'admin' && !ui.admin ? ' <span class="lock">PIN</span>' : '') + '</button>';
      }).join('') + '</nav>';
  }

  // 팀 배너: 팀 배경 + 원본 캐릭터 2명 + 팀명/정보 (이벤트 비주얼 영역)
  var TEAM_CHARS = { A: ['cv', 'lb'], B: ['bf', 'lm'], C: ['pk', 'ck'] };
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
    var done = w.matches.filter(function (m) { return m.win; }).length;
    out += '<div class="daybar"><h2 class="day num">' + md(w.date) + '(수) 공식전</h2><dl class="facts"><div><dt>참석</dt><dd class="num">' + Object.keys(w.attendees).length + '명</dd></div><div><dt>경기</dt><dd class="num">' + w.matches.length + '</dd></div><div><dt>결과 입력</dt><dd class="num">' + done + '/' + w.matches.length + '</dd></div></dl></div>';
    if (ui.admin && !w.published) out += '<div class="banner warn">회원에게는 아직 안 보이는 편성이에요. 관리 › 공개에서 공개할 수 있어요.</div>';
    if (ui.admin) out += '<div class="banner info small"><span>이긴 팀을 누르면 승리로 기록돼요. 한 번 더 누르면 취소. 다 입력하고 아래 <b>저장</b>!</span></div>';
    out += legend();
    groups().forEach(function (g) {
      var ms = w.matches.filter(function (m) { return m.pool === g.id; });
      if (!ms.length) return;
      var ppl = {};
      ms.forEach(function (m) { m.a.concat(m.b).forEach(function (p) { if (p) ppl[p] = 1; }); });
      var dn = ms.filter(function (m) { return m.win; }).length;
      out += '<section class="group g' + g.id + '">' + teamBanner(g, [Object.keys(ppl).length + '명', ms.length + '경기', dn === ms.length ? '결과 완료' : '결과 ' + dn + '/' + ms.length]) + '<div class="match-list">';
      ms.forEach(function (m, i) {
        var state = m.win ? '<span class="m-state done">결과 입력됨</span>' : '<span class="m-state">결과 대기</span>';
        out += '<article class="match' + (m.win ? ' decided' : '') + '"><div class="m-head"><span class="m-no num">' + (i + 1) + '경기</span>' + state + '</div><div class="m-teams">';
        ['a', 'b'].forEach(function (side, si) {
          var st = m.win ? (m.win === side ? ' win' : ' lose') : '';
          var names = '<span class="names">' + m[side].map(function (pid) { return plHtml(pid, m, w.date, P); }).join('<span class="sep">·</span>') + '</span>';
          var res = m.win === side ? '<span class="res win-badge">WIN</span>' : m.win ? '<span class="res lose-txt">패</span>' : (ui.admin ? '<span class="res tap">승리 기록</span>' : '');
          var cls = 'team' + st;
          if (ui.admin) out += '<button class="' + cls + '" data-act="win" data-m="' + m.id + '" data-side="' + side + '" aria-label="' + esc(m[side].map(function (p) { return P[p] ? P[p].name : ''; }).join(', ')) + ' 승리 기록">' + names + res + '</button>';
          else out += '<div class="' + cls + '">' + names + res + '</div>';
          if (si === 0) out += '<span class="vs" aria-label="대">vs</span>';
        });
        out += '</div></article>';
      });
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
    var S = L.standings(work), P = pm();
    var meP = P[ui.me];
    var gid = ui.rankGroup || (meP ? meP.group : groups()[0].id);
    var g = groups().filter(function (x) { return x.id === gid; })[0] || groups()[0];
    var list = S[g.id] || [];
    var ds = L.seasonDays(work.settings);
    var remain = ds.filter(function (d) { return weekStatus(getWeek(d)) !== 'done'; }).length;
    var played = list.filter(function (r) { return r.wins + r.losses + r.pending > 0; });
    var idle = list.filter(function (r) { return r.wins + r.losses + r.pending === 0; });
    var out = '<div class="gsel" role="group" aria-label="조 선택">' + groups().map(function (x) {
      return '<button class="g' + x.id + '" data-act="rankg" data-v="' + x.id + '" aria-pressed="' + (x.id === g.id) + '">' + esc(x.name) + '</button>';
    }).join('') + '</div>';
    out += '<div class="team-zone g' + g.id + '">' + teamBanner(g, ['다승왕 ' + g.winners + '명', '남은 수요일 ' + remain + '번']) + '<p class="muted small num">1인 최대 +' + remain * 2 + '승까지 남았어요.</p>';
    if (!played.length) {
      out += '<div class="card empty"><div class="pig" aria-hidden="true"></div><b>아직 입력된 결과가 없어요</b><p class="muted">돼장이 경기 결과를 입력하면 승수와 순위가 바로 계산돼요.</p></div>';
    } else {
      out += '<div class="board"><div class="rrow rhead" aria-hidden="true"><span>순위</span><span>이름</span><span>승</span><span>패</span><span>승률</span></div>' + played.map(function (r) {
        var tag = r.lottery ? ' <span class="chip lot">동률 추첨</span>' : r.contender ? ' <span class="chip king">다승왕권</span>' : '';
        var dec = r.wins + r.losses;
        return '<div class="rrow' + (r.contender ? ' contender' : '') + (r.id === ui.me ? ' me' : '') + '"><span class="medal num' + (r.rank <= 3 && r.wins > 0 ? ' m' + r.rank : '') + '">' + (dec ? r.rank : '–') + '</span>' +
          '<span class="rname"><b>' + esc(r.name) + '</b>' + tag + '<span class="sub num">' + r.weeks + '주 참가' + (r.pending ? ' · 결과 미입력 ' + r.pending + '경기' : '') + '</span></span>' +
          '<span class="rnum strong num">' + r.wins + '</span><span class="rnum num">' + r.losses + '</span><span class="rnum num">' + (dec ? Math.round(r.wins / dec * 100) + '%' : '–') + '</span></div>';
      }).join('') + '</div>';
    }
    out += '</div>';
    if (idle.length) out += '<details><summary>아직 기록 없는 ' + idle.length + '명</summary><p class="small muted">' + idle.map(function (r) { return esc(r.name); }).join(', ') + '</p></details>';
    out += '<p class="small muted">승수만으로 순위를 매기고, 최종 동률이면 추첨해요. 공식 2경기만 집계하고 추가출전·자유게임은 빠져요. 다른 조 경기에 나가도 승수는 원소속 조로 들어가요.</p>';
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
    var myG = groups().filter(function (x) { return x.id === me.group; })[0];
    var wrap = function (body) { return pick + '<div class="team-zone me-zone g' + me.group + '">' + body + '</div>'; };
    var out = myG ? teamBanner(myG, ['내 조', row && row.wins + row.losses ? '조 내 ' + row.rank + '위' : '기록 대기']) : '';
    out += '<div class="card"><div class="me-head"><h2>' + esc(me.name) + '</h2><span class="gdot g' + me.group + '">' + esc(gname(me.group)) + '조</span></div>' +
      '<div class="stat-row"><div class="stat' + (row && row.contender ? ' hl' : '') + '"><b class="num">' + (row && row.wins + row.losses ? row.rank + '위' : '–') + '</b><span>조 내 순위' + (gsize ? ' / ' + gsize + '명' : '') + '</span></div>' +
      '<div class="stat"><b class="num">' + (row ? row.wins : 0) + '승 ' + (row ? row.losses : 0) + '패</b><span>누적 공식전' + (row && row.pending ? ' · 결과 미입력 ' + row.pending : '') + '</span></div></div>' +
      (row && row.lottery ? '<p class="small"><span class="chip lot">동률 추첨</span> 지금 끝나면 다승왕 ' + gw + '자리를 두고 추첨 대상이에요.</p>' : row && row.contender ? '<p class="small"><span class="chip king">다승왕권</span> 지금 순위면 다승왕이에요!</p>' : '') +
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
    if (!ui.admin) return viewLock();
    var out = '<div class="row" style="justify-content:space-between"><div class="seg" role="group" aria-label="관리 메뉴">' +
      [['plan', '참석·편성'], ['seeds', '실력 순위'], ['settings', '설정']].map(function (s) {
        return '<button data-act="sec" data-v="' + s[0] + '" aria-pressed="' + (ui.sec === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div><button class="btn sm" data-act="lock">잠그기</button></div>';
    if (ui.sec === 'seeds') return out + viewSeeds();
    if (ui.sec === 'settings') return out + viewSettings();
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
      case 'tab': ui.tab = v; LS.set(KEY.tab, v); ui.notice = null; render(); window.scrollTo(0, 0); break;
      case 'week': ui.week = v; SS.set(SKEY.week, v); ui.confirm = null; ui.notice = null; ui.ai.res = null; ui.ai.err = ''; ui.shiftSel = { p: '', dir: 'up' }; render(); break;
      case 'rankg': ui.rankGroup = v; render(); break;
      case 'sec': ui.sec = v; SS.set(SKEY.sec, v); render(); break;
      case 'lock': ui.admin = false; forgetAdmin(); render(); break;
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
      case 'me': ui.me = el.value; if (el.value) LS.set(KEY.me, el.value); else LS.del(KEY.me); ui.rankGroup = null; render(); break;
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
        pinBusy = false;
        if (!t) { ui.pinMsg = 'PIN이 맞지 않아요.'; render(); return; }
        rememberAdmin(t); ui.admin = true; render();
      }, function (e) {
        pinBusy = false;
        ui.pinMsg = e.code === 'no_pin' ? '관리 PIN이 아직 설정되지 않았어요. 설치 안내(README)대로 PIN을 먼저 정해 주세요.' :
          e.code === 'network' ? '인터넷 연결을 확인하고 다시 해 주세요.' : '잠금을 해제하지 못했어요 (' + e.code + ').';
        render();
      });
    } else if (f.id === 'pin-change') {
      var o = document.getElementById('pc0').value, a = document.getElementById('pc1').value, b = document.getElementById('pc2').value;
      if (!/^\d{4}$/.test(o)) { toast('지금 PIN 4자리를 입력하세요.'); return; }
      if (!/^\d{4}$/.test(a) || a !== b) { toast('새 PIN 4자리를 두 번 똑같이 입력하세요.'); return; }
      remote.changePin(token, o, a).then(function () {
        toast('PIN을 바꿨어요. 다른 기기에서는 새 PIN을 다시 입력해야 해요.');
      }, function (e) {
        if (e.code === 'bad_pin') toast('지금 PIN이 맞지 않아요.');
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
    token = R.loadToken(LS, Date.now());
    ui.admin = !!token;
    render();
    // 기억한 토큰이 만료·무효(PIN 변경 등)면 PIN 입력 화면으로
    if (token) remote.check(token).then(function (ok) { if (!ok) { dropAdmin(); ui.admin = false; render(); } }, function () { });
  }
  try { remote = R.connect(window.DDW_CONFIG, window.supabase); }
  catch (e) { bootView(e.code === 'config' ? 'config.js에 Supabase 주소와 키를 넣어 주세요.' : '데이터를 불러오지 못했어요.', e.code !== 'config'); return; }
  remote.load().then(start, function (e) { if (window.console) console.error(e); bootView('데이터를 불러오지 못했어요.', true); });
})();
