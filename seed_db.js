// 초기 데이터 SQL 만들기 (로컬 전용): node seed_db.js → seed.local.sql
// live_state.json(실제 부원 이름 포함)을 app_state에 넣는 SQL. PIN 해시는 빼고 넣는다.
// 만든 파일은 Supabase SQL Editor에 붙여 넣어 실행. seed.local.sql은 .gitignore 대상.
const fs = require('fs');
const src = __dirname + '/live_state.json';
if (!fs.existsSync(src)) { console.error('live_state.json이 없어요. 앱에서 전체 데이터 JSON을 받아 이 폴더에 두세요.'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(src, 'utf8'));
const rev = s.rev || 1, savedAt = s.savedAt || new Date().toISOString();
const state = JSON.parse(JSON.stringify(s));
delete state.rev; delete state.savedAt;
if (state.settings) delete state.settings.pin;
const json = JSON.stringify(state);
let tag = 'seed';
while (json.includes('$' + tag + '$')) tag += 'x';
const sql = '-- node seed_db.js 로 생성. 실제 부원 데이터 포함: 저장소에 올리지 마세요.\n' +
  'insert into public.app_state (id, state, rev, saved_at) values (1, $' + tag + '$' + json + '$' + tag + '$::jsonb, ' + rev + ", '" + savedAt + "')\n" +
  'on conflict (id) do update set state = excluded.state, rev = excluded.rev, saved_at = excluded.saved_at;\n' +
  "select rev, saved_at, state->'settings' ? 'pin' as has_pin, jsonb_array_length(state->'players') as players, jsonb_array_length(state->'weeks') as weeks from public.app_state;\n";
fs.writeFileSync(__dirname + '/seed.local.sql', sql);
console.log('seed.local.sql 생성: rev ' + rev + ', 선수 ' + state.players.length + '명, 주차 ' + state.weeks.length + '개, PIN 제외');
