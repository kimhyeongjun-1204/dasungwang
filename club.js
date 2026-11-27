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
    { name: '청백전 & 치킨데이', short: '청백전', date: '2026-11-27', place: '성남오리초', post: 2638,
      live: 'https://chang333787-boop.github.io/cheongbaek-2026/' },   // 다른 회원이 만든 청백전 실시간 점수판 (김형준 요청 2026-11-27)  // 밴드 글엔 '11월 29일(금)' → 김형준 확인: 11/27(금) (2026-11-25)
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
  // 행사 당일이고 따로 페이지(live)가 있으면 그날만 홈 맨 위 큰 카드 (2026-11-27 청백전, 다승왕과 자리 바꿈)
  function heroEvent(today, events) { return (events || EVENTS).filter(function (e) { return e.live && e.date === today; })[0] || null; }

  return { BAND: BAND, NOTICES: NOTICES, SIGNUPS: SIGNUPS, EVENTS: EVENTS, activeNotices: activeNotices, currentSignup: currentSignup, upcoming: upcoming, postUrl: postUrl, heroEvent: heroEvent };
})();
if (typeof module !== 'undefined') module.exports = Club;
