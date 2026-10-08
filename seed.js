// 초기 데이터: 그룹 편성표(박강호 중복 1명으로), 10/7 편성표, 10/14 참가신청(20명 확인분)
const roster = {
  A: ['유성준', '이제영', '최신웅', '김건율', '김성곤', '김형준', '박강호', '주성모', '박지섭', '조영재'],
  B: ['양회욱', '김예슬', '임현수', '권영순', '김진호', '박복균', '박희수', '전철민', '서주영', '김혜선', '황규연', '여원미',
      '차승운', '이민석', '용현정', '염청섭', '이우성', '이정찬', '이태훈', '조동균', '최서연', '최원정', '황용담'],
  // 2번 이름은 이미지에서 가려져 있어 제외 (관리 화면에서 추가)
  C: ['김다영', '김민정', '김용숙', '박기옥', '서민희', '양연욱', '여현서', '육민주', '이선미', '이영승', '이은미', '조인규', '한지윤'],
};
const players = [];
let n = 1;
for (const g of ['A', 'B', 'C']) for (const name of roster[g]) players.push({ id: 'p' + String(n++).padStart(3, '0'), name, group: g });
const id = name => { const p = players.find(x => x.name === name); if (!p) throw new Error('없는 이름 ' + name); return p.id; };
const pair = s => s.split('·').map(id);

let mid = 1;
const M = (pool, a, b, off = []) => ({ id: 'm' + String(mid++).padStart(4, '0'), pool, a: pair(a), b: pair(b), off: off.map(id), win: null, score: '' });

const w1007 = [
  M('A', '조영재·김성곤', '최신웅·주성모'),
  M('A', '조영재·박지섭', '김성곤·유성준'),
  M('A', '최신웅·유성준', '박지섭·주성모'),
  M('B', '박희수·서주영', '여원미·권영순'),
  M('B', '박희수·여원미', '서주영·용현정'),
  M('B', '박희수·용현정', '서주영·권영순', ['박희수', '서주영']),
  M('B', '박복균·이민석', '양회욱·전철민'),
  M('B', '박복균·양회욱', '이민석·전철민'),
  M('C', '조인규·김용숙', '한지윤·여현서'),
  M('C', '서민희·이태훈', '이선미·육민주'),
  M('C', '이영승·한지윤', '조인규·육민주'),
  M('C', '김용숙·이태훈', '여현서·이선미'),
  M('C', '서민희·한지윤', '이영승·이태훈', ['한지윤', '이태훈']),
];
const att1007 = {};
w1007.forEach(m => m.a.concat(m.b).forEach(p => { att1007[p] = m.pool; }));

const band1014 = '박강호(랍스터), 서민희(닭갈비), 조인규(닭갈비), 조영재(캐비어), 권영순(소갈비), 이태훈(양갈비), 김용숙(닭갈비), 박복균(소갈비), 김성곤(캐비어), 박희수(소갈비), 이민석(소갈비), 여원미(소갈비), 용현정(양갈비), 주성모(랍스터), 박지섭(랍스터), 유성준(랍스터), 육민주(닭갈비), 이영승(닭갈비), 이선미(돼지갈비), 전철민(소갈비)';
const att1014 = {};
band1014.split(', ').forEach(t => { const nm = t.replace(/\(.*/, ''); att1014[id(nm)] = players.find(p => p.name === nm).group; });

const state = {
  v: 1,
  rev: 1,
  savedAt: '2026-10-08T17:30:00+09:00',
  settings: {
    club: '라켓뚱보단',
    seasonStart: '2026-10-07',
    seasonEnd: '2026-12-23',
    countBy: 'registered',
    pin: null,
    groups: [
      { id: 'A', name: '캐비어·랍스터', winners: 1 },
      { id: 'B', name: '소갈비·양갈비', winners: 2 },
      { id: 'C', name: '돼지갈비·닭갈비', winners: 1 },
    ],
  },
  players,
  weeks: [
    { date: '2026-10-07', published: true, attendees: att1007, matches: w1007 },
    { date: '2026-10-14', published: false, attendees: att1014, matches: [], note: '밴드 참가신청 22명 중 화면에 보인 20명만 입력됨' },
  ],
  nextId: mid,
};
module.exports = state;
if (require.main === module) {
  const L = require('./logic.js');
  console.log('players', players.length, roster.A.length, roster.B.length, roster.C.length);
  console.log('10/7 attendees', Object.keys(att1007).length, '10/14 attendees', Object.keys(att1014).length);
  console.log('10/7 validate', JSON.stringify(L.validateWeek(state, state.weeks[0])));
}
