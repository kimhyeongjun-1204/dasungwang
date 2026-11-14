// 돼블스플랜 화면 확인용 가짜 데이터 (개발 전용, 실제 DB와 무관)
// seed.js 명단으로 10/7~11/11 결과가 다 들어간 주 + 11/18 공개된 주를 만들고, 11/11·11/18 예측을 채움
const L = require('../logic.js');

function build(base, nowMs) {
  const rng = L.mulberry32(20261118);
  const st = JSON.parse(JSON.stringify(base));
  const groups = st.settings.groups.map(g => g.id);
  const dates = ['2026-10-07', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18'];
  st.settings.skipDates = ['2026-10-14'];
  st.weeks = dates.map((date, wi) => {
    const attendees = {};
    st.players.forEach(p => { if (rng() < 0.62) attendees[p.id] = p.group; });
    let matches = [];
    groups.forEach(g => {
      const ids = Object.keys(attendees).filter(id => attendees[id] === g);
      if (ids.length < 4) return;
      const res = L.generatePool(ids.map(id => ({ id, heat: 1, skill: 0.5 })), 1000 + wi * 10 + groups.indexOf(g), { restarts: 2 });
      res.matches.forEach((m, i) => matches.push({ id: 'd' + date.slice(5).replace('-', '') + g + (i + 1), pool: g, a: m.a, b: m.b, off: m.off, win: null, score: '' }));
    });
    const past = date < '2026-11-18';
    if (past) matches.forEach(m => { m.win = rng() < 0.5 ? 'a' : 'b'; });
    return { date, published: true, attendees, matches };
  });
  st.nextId = 500;

  // 경기마다 한쪽으로 쏠린 정도를 정해서 그럴듯한 인기 픽을 만듦
  function predictFor(week, n) {
    const bias = {};
    week.matches.forEach(m => { bias[m.id] = 0.15 + rng() * 0.7; });
    const hot = week.matches.slice().sort(() => rng() - 0.5).slice(0, 8);
    const people = st.players.slice().sort(() => rng() - 0.5).slice(0, n);
    return people.map(p => {
      const ms = hot.slice().sort(() => rng() - 0.5).slice(0, 4);
      return { week_date: week.date, player_id: p.id, mode: rng() < 0.6 ? 'high' : 'safe', picks: ms.map(m => ({ match: m.id, side: rng() < bias[m.id] ? 'a' : 'b' })) };
    });
  }
  const w11 = st.weeks.find(w => w.date === '2026-11-11'), w18 = st.weeks.find(w => w.date === '2026-11-18');
  const p11 = predictFor(w11, 18);
  // 11/11 결과: 많이 고른 쪽이 대체로 이김 (적중자가 몇 명 나오게)
  w11.matches.forEach(m => {
    let a = 0, b = 0;
    p11.forEach(p => p.picks.forEach(k => { if (k.match === m.id) { if (k.side === 'a') a++; else b++; } }));
    const fav = a >= b ? 'a' : 'b';
    m.win = !(a + b) ? m.win : rng() < 0.85 ? fav : (fav === 'a' ? 'b' : 'a');
  });
  const predictions = p11.concat(predictFor(w18, 14));
  // 11/18 제출 시각: 지금부터 90분 전 사이에 흩어 놓음 (체결 피드·▲▼용)
  const times = {};
  predictions.forEach(p => {
    times[p.week_date + p.player_id] = p.week_date === '2026-11-18' ? nowMs - Math.floor(rng() * 90 * 60e3) : Date.parse('2026-11-11T07:00:00Z') + Math.floor(rng() * 80 * 60e3);
  });
  predictions.sort((a, b) => times[a.week_date + a.player_id] - times[b.week_date + b.player_id]);
  predictions.forEach(p => { p.updated_at = new Date(times[p.week_date + p.player_id]).toISOString(); });
  return { state: st, predictions };
}

module.exports = { build };
