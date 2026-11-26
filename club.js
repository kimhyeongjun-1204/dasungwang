// 클럽 홈에 보여 줄 밴드 정보 (2026-11-25) — 앱 공지·참가 신청 기능을 만들기 전까지 쓰는 임시 데이터
// 원문은 라켓뚱보단 밴드. 새 공지·참가신청서가 올라오면 여기 항목을 추가하고, 기한(until)이 지나면 홈에서 자동으로 빠짐
// 회원 이름·연락처는 넣지 않음 (공지 제목·날짜·장소와 밴드 글 번호만)
var Club = (function () {
  'use strict';
  var BAND = 'https://band.us/band/86304160';

  // kind: 운동 / 행사 / 규칙. until: 이 날까지 보임(null = 늘 보임). from: 이 날부터 보임
  var NOTICES = [
    { kind: '운동', title: '11.23(월)~26(목) 배드민턴위크 참가신청', sub: '수요일 정원 마감 · 대기는 밴드 댓글로', until: '2026-11-26', post: 2658 },
    { kind: '운동', title: '11.30(월)~12.4(금) 배드민턴위크 참가신청', sub: '월~금 참가신청서', from: '2026-11-23', until: '2026-12-04', post: 2664 },
    { kind: '행사', title: '청백전 & 치킨데이', sub: '11.27(금) · 성남오리초 · 끝나고 자담치킨', until: '2026-11-27', post: 2638 },
    { kind: '행사', title: '아듀 2026 뚠뚠배 · 송년 뒤풀이', sub: '12.18(금) · 풍덕초 · 참가 투표 중', until: '2026-12-18', post: 2656 },
    { kind: '규칙', title: '3개월 수요 다승왕전', sub: '10.6~12.23 · 매주 수요일 공식전 2경기', until: '2026-12-23', post: 2614 },
    { kind: '규칙', title: '셔틀콕 제출 안내', sub: '남 3개 · 여 2개 · 수지구장 레슨자 1개', until: null, post: 2626 }
  ];
  // 밴드 '배드민턴위크' 참가신청서 (요일별 신청은 밴드에서)
  var SIGNUPS = [
    { from: '2026-11-23', to: '2026-11-26', post: 2658 },
    { from: '2026-11-30', to: '2026-12-04', post: 2664 }
  ];
  // 다승왕전 말고 따로 열리는 행사. noDow: true면 요일을 붙이지 않음(밴드 글 요일이 날짜와 안 맞아 확인 전일 때)
  var EVENTS = [
    { name: '청백전 & 치킨데이', short: '청백전', date: '2026-11-27', place: '성남오리초', post: 2638 },  // 밴드 글엔 '11월 29일(금)' → 김형준 확인: 11/27(금) (2026-11-25)
    { name: '아듀 2026 뚠뚠배', short: '뚠뚠배', date: '2026-12-18', place: '풍덕초', post: 2656 }
  ];

  function activeNotices(today, list) {
    return (list || NOTICES).filter(function (n) {
      if (n.from && today < n.from) return false;
      return !n.until || today <= n.until;
    });
  }
  function currentSignup(today, list) {
    return (list || SIGNUPS).filter(function (s) { return s.to >= today; })[0] || null;
  }
  // 다승왕전 날짜(dswDates)와 행사를 합쳐 오늘 이후 n개. kind: 'dsw' | 'event'
  function upcoming(today, dswDates, events, n) {
    var all = (dswDates || []).filter(function (d) { return d >= today; }).map(function (d) { return { date: d, kind: 'dsw' }; })
      .concat((events || EVENTS).filter(function (e) { return e.date >= today; }).map(function (e) { return { date: e.date, kind: 'event', ev: e }; }));
    all.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return all.slice(0, n || 4);
  }
  function postUrl(post) { return BAND + '/post/' + post; }

  // ---- 앱 공지 (Supabase notices, 돼장·도우미가 앱에서 씀) ----
  var KINDS = ['운동', '행사', '규칙', '결과·소식'];
  function noticeTitle(body) {
    var line = String(body || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
    if (!line) return '(제목 없음)';
    return line.length > 60 ? line.slice(0, 60) + '…' : line;
  }
  function kstDate(iso) { return new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10); }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  // 홈에 보일 공지: 기한 안 지난 중요 공지(pin) 먼저, 그다음 최근 14일 안에 올린 공지. 각각 최근 순
  function homeNotices(today, list) {
    var from = addDays(today, -13), pins = [], rest = [];
    (list || []).forEach(function (n) {
      var active = n.pinned && (!n.pin_until || n.pin_until >= today);
      if (active) pins.push(Object.assign({}, n, { pin: true }));
      else if (kstDate(n.created_at) >= from) rest.push(Object.assign({}, n, { pin: false }));
    });
    var byNew = function (a, b) { return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0; };
    return pins.sort(byNew).concat(rest.sort(byNew));
  }
  var DOWS = '일월화수목금토';
  function mdw(d) { var x = new Date(d + 'T00:00:00Z'); return (x.getUTCMonth() + 1) + '.' + x.getUTCDate() + '(' + DOWS[x.getUTCDay()] + ')'; }
  // 자주 쓰는 글: 다음 월~금 배드민턴위크 (오늘이 월요일이면 다음 주 월요일부터)
  function weekTemplate(today) {
    var dow = new Date(today + 'T00:00:00Z').getUTCDay();
    var mon = addDays(today, ((8 - dow) % 7) || 7), fri = addDays(mon, 4);
    return {
      kind: '운동', pinned: true, until: fri,
      body: mdw(mon) + '~' + mdw(fri) + ' 배드민턴위크 🏸\n이번 주도 다 같이 즐겁게 운동해요!\n신청은 앱 참가 탭에서 해 주세요. 정원이 차면 대기 순서대로 자동으로 들어가요.'
    };
  }
  var TEMPLATES = {
    event: { kind: '행사', pinned: true, until: null, body: '📅 행사 이름\n날짜: \n장소: \n참가 여부는 밴드 투표로 알려 주세요.' },
    result: { kind: '결과·소식', pinned: false, until: null, body: '🎉 돼블스플랜 적중자 발표 🎉\n하이리스크 적중 +3승: \n안전형 적중 +1승: ' },
    rule: { kind: '규칙', pinned: false, until: null, body: '📌 안내\n' }
  };

  return { BAND: BAND, NOTICES: NOTICES, SIGNUPS: SIGNUPS, EVENTS: EVENTS, activeNotices: activeNotices, currentSignup: currentSignup, upcoming: upcoming, postUrl: postUrl,
    KINDS: KINDS, noticeTitle: noticeTitle, homeNotices: homeNotices, weekTemplate: weekTemplate, TEMPLATES: TEMPLATES, kstDate: kstDate };
})();
if (typeof module !== 'undefined') module.exports = Club;
