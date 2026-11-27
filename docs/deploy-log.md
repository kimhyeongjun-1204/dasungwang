# 배포 작업 기록

실제로 실행한 명령과 출력만 적어요. 추정한 값은 넣지 않았어요. 날짜: 2026-10-19, Windows 11, Node v22.14.0.

## 1. 구현 전: 새 테스트가 실패하는지 확인
```
$ node deploy.test.js
remote.js
app.js
build
  FAIL publicState: settings.pin·rev·savedAt을 빼고 원본은 그대로
       remote.js 없음
  FAIL fromRow: DB 행을 앱 state로 (rev, savedAt 채우고 pin 제거)
       remote.js 없음
  FAIL errorCode: 서버 에러를 구분
       remote.js 없음
  FAIL 토큰: 30일 보관, 만료되면 없음, 지우기
       remote.js 없음
  FAIL 토큰: 저장소가 깨져 있어도 예외 없이 null
       remote.js 없음
  FAIL app.js: 아티팩트 자기 재게시·브라우저 PIN 해시·내장 state를 쓰지 않음
       publish/buildDoc 남아 있음
  ok  app.js: 기존 충돌 UI·저장 실패 배너·임시저장 유지
  FAIL build.js: dist/index.html 완전한 문서 + PWA 파일
       ENOENT: no such file or directory, open 'C:\dev\badmintion\dist\index.html'
  FAIL service worker: index.html network-first, supabase는 캐시 안 함
       ENOENT: no such file or directory, open 'C:\dev\badmintion\dist\sw.js'
  FAIL api.load: app_state 1행을 읽어 앱 state로
       remote.js 없음
  FAIL api.save: pin 뺀 state와 expected_rev를 보내고 새 rev를 돌려받음
       remote.js 없음
  FAIL api.save: stale_rev는 code로 구분돼 reject
       remote.js 없음
  FAIL api.login: 맞으면 토큰, 틀리면 null, 잠금이면 locked
       remote.js 없음
  FAIL api.check / changePin / logout: RPC 이름과 인자
       remote.js 없음

1 passed
exit=1
```
(통과한 1개는 기존 기능이 남아 있는지 보는 회귀 테스트예요.)

## 2. 구현 후 테스트·빌드
```
$ node logic.test.js (마지막 3줄)
  ok  balanceOf: 팀 실력 차이 등급

43 passed
exit=0

$ node deploy.test.js
remote.js
app.js
build
  ok  publicState: settings.pin·rev·savedAt을 빼고 원본은 그대로
  ok  fromRow: DB 행을 앱 state로 (rev, savedAt 채우고 pin 제거)
  ok  errorCode: 서버 에러를 구분
  ok  토큰: 30일 보관, 만료되면 없음, 지우기
  ok  토큰: 저장소가 깨져 있어도 예외 없이 null
  ok  app.js: 아티팩트 자기 재게시·브라우저 PIN 해시·내장 state를 쓰지 않음
  ok  app.js: 기존 충돌 UI·저장 실패 배너·임시저장 유지
  ok  build.js: dist/index.html 완전한 문서 + PWA 파일
  ok  api.save: pin 뺀 state와 expected_rev를 보내고 새 rev를 돌려받음
  ok  api.load: app_state 1행을 읽어 앱 state로
  ok  api.save: stale_rev는 code로 구분돼 reject
  ok  service worker: index.html network-first, supabase는 캐시 안 함
  ok  api.check / changePin / logout: RPC 이름과 인자
  ok  api.login: 맞으면 토큰, 틀리면 null, 잠금이면 locked

14 passed
exit=0

$ node build.js
built dist/index.html 207.6KB

$ node seed_db.js
seed.local.sql 생성: rev 7, 선수 46명, 주차 2개, PIN 제외

$ node verify_db.js  (config.js가 아직 예시 값일 때)
config.js에 Supabase URL과 anon key를 먼저 넣어 주세요.
exit=1
```

## 3. 외부 버전 확인
```
$ curl -sI https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js | head -1
HTTP/1.1 200 OK
$ (같은 파일) | openssl dgst -sha384 -binary | openssl base64 -A
xPW3QHswsICVC2mW6BFNwMbhpLkbZ133fKOhxNx3QGGgAOJfL3O9t8r2aWn1aez6
$ npm registry 게시일: 2.117.0 2026-09-22T12:57:17.653Z  (latest는 2.118.0, 2026-10-15: 2주가 안 돼서 안 씀)

$ gh api repos/actions/<name>/git/ref/tags/<tag> --jq .ref
checkout@v7: refs/tags/v7
setup-node@v7: refs/tags/v7
configure-pages@v6: refs/tags/v6
upload-pages-artifact@v5: refs/tags/v5
deploy-pages@v5: refs/tags/v5
```

## 4. 아이콘 생성
```
$ py tools/make_icons.py
apple-touch-icon.png 180
icon-192.png 192
icon-512.png 512
```

## 5. 브라우저 확인: 로컬 가짜 Supabase (`node tools/mock_supabase.js`, 앱 내장 브라우저)
**주의: 진짜 Supabase가 아니라 같은 API 모양을 흉내 낸 로컬 서버에서 확인한 결과예요.** 실제 DB 확인은 6번에서 해요.

| 확인 | 실행한 것 | 결과 (페이지에서 읽은 값) |
|---|---|---|
| 360px 이번 주 | 폭 360×780, 첫 화면 | 화면 정상, `scrollWidth 360 / clientWidth 360` (가로 스크롤 없음), 콘솔 오류 없음 |
| 360px 순위·내 기록·관리 | 각 탭 클릭 | 세 화면 모두 `scrollWidth 360 / innerWidth 360` |
| 틀린 PIN | `0000` 입력 | `PIN이 맞지 않아요.` |
| 맞는 PIN | `1234` 입력 | 관리 화면 열림, localStorage `ddw-admin-token` = `{"token":"6149c795-…","until":1794971023947}` |
| 저장 | 10/7 m0012 경기 A팀 승리 → 저장 | 토스트 `저장했어요.`, 저장 바 사라짐, draft `null` |
| 새로고침 후 유지 | 페이지 다시 열기 | m0012 A팀 `win` 유지, 결과 입력 `13/13`, 관리자 상태 유지(PIN 표시 없음) |
| 두 탭 동시 저장 | 탭1, 탭2를 연 뒤 탭1 저장 → 탭2 저장 | 탭1 `저장했어요.` / 탭2 토스트 `다른 곳에서 먼저 저장됐어요. 새 버전으로 다시 불러와요.` + 배너 `이 기기에 저장 못 한 변경이 있는데, 그사이 다른 곳에서 새로 저장됐어요. [내 변경 불러오기] [버리기]`, 탭1의 변경(m0012 B팀 승) 반영됨 |
| 충돌 후 내 변경 저장 | 탭2 `내 변경 불러오기` → 저장 | `저장했어요.`, 배너 0개 |
| PIN 변경 | 지금 PIN `9999`(틀림) → `1234`(맞음), 새 PIN `5678` | `지금 PIN이 맞지 않아요.` → `PIN을 바꿨어요. 다른 기기에서는 새 PIN을 다시 입력해야 해요.` |
| 무효 토큰 | localStorage 토큰을 임의 uuid로 바꾸고 새로고침 | PIN 표시 다시 나타남, 토큰 삭제됨(`null`), 관리 버튼 0개 |
| 서버 꺼진 상태에서 저장 | 서버 종료 후 변경 → 저장 | 배너 `인터넷에 연결되지 않아 저장하지 못했어요. 연결을 확인하고 다시 저장해 주세요. [다시 저장] [닫기]`, draft 남음 |
| 서버 꺼진 상태에서 새로고침 | 서버 종료 확인(`Failed to fetch`) 후 새로고침 | 처음 `불러오는 중…` → 약 16.7초 뒤 `데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요. [다시 시도]` (supabase-js가 몇 번 재시도한 뒤 실패) |
| service worker 캐시 | 수정 후 캐시 목록 | `/`, `/config.js` (+ 확인용으로 받은 `/sw.js`)만 있고 `/rest/v1/…` 없음 |

## 6. GitHub 저장소·Pages
```
$ gh repo create dasungwang --public --description "라켓뚱보단 수요 다승왕전 웹앱" --source . --remote origin
https://github.com/kimhyeongjun-1204/dasungwang

$ gh api -X POST repos/kimhyeongjun-1204/dasungwang/pages -f build_type=workflow --jq '{build_type, html_url, source}'
{"build_type":"workflow","html_url":"https://kimhyeongjun-1204.github.io/dasungwang/","source":{"branch":"main","path":"/"}}

$ git push -u origin main
 * [new branch]      main -> main

$ gh run watch 39194051201 --exit-status
✓ build in 7s   (로직 테스트 ✓, 배포 테스트 ✓, 빌드 ✓, configure-pages ✓, upload-pages-artifact ✓)
✓ deploy in 9s  (deploy-pages ✓)

$ curl -s -o /dev/null -w '%{http_code} %{content_type}' https://kimhyeongjun-1204.github.io/dasungwang/<파일>
(index): 200 text/html; charset=utf-8
manifest.webmanifest: 200 application/manifest+json; charset=utf-8
sw.js: 200 application/javascript; charset=utf-8
config.js: 200 application/javascript; charset=utf-8
icons/icon-512.png: 200 image/png
```
이 시점의 config.js는 아직 예시 값이라 배포 화면은 'config.js에 Supabase 주소와 키를 넣어 주세요.'가 정상.

## 7. 실제 Supabase 연결
```
$ curl -s "$U/rest/v1/app_state?select=rev" -H "apikey: sb_publishable_…"      (schema.sql 실행 전)
{"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table 'public.app_state' in the schema cache"}
HTTP 404
(apikey + Authorization: Bearer 같은 publishable 키로 보내도 같은 응답 → 키는 받아들여짐)

$ (schema.sql 실행 후) 각 테이블 GET, admin_login(pin=null)
[app_state] [] HTTP 200
[admin_secret] {"code":"42501",…,"message":"permission denied for table admin_secret"} HTTP 401
[admin_session] {"code":"42501",…,"message":"permission denied for table admin_session"} HTTP 401
[admin_login_guard] {"code":"42501",…,"message":"permission denied for table admin_login_guard"} HTTP 401
[admin_login 함수] {"code":"P0001","details":null,"hint":null,"message":"no_pin"} HTTP 400

$ (seed.local.sql 실행 후) app_state 읽기
rev 7 saved_at 2026-10-17T16:34:24.102+00:00 players 46 weeks 2 has settings.pin false club 라켓뚱보단
```

config.js 커밋 1ce3d23 푸시 → Actions run 39195088550: `{"conclusion":"success","jobs":[{"conclusion":"success","name":"build"},{"conclusion":"success","name":"deploy"}]}`

배포 주소(https://kimhyeongjun-1204.github.io/dasungwang/)를 앱 내장 브라우저 360×780으로 열어 확인:
```
{ "loaded": true, "facts": "참석\n24명\n경기\n13\n결과 입력\n12/13", "sw": 360, "iw": 360,
  "manifest": "https://kimhyeongjun-1204.github.io/dasungwang/manifest.webmanifest", "swReg": true }
콘솔 오류: 없음
페이지 안에서 supabase-js로: rpc('admin_check', 임의 uuid) → data false, error null
                            from('app_state').update({rev:999}) → "42501 permission denied for table app_state"
```

## 8. `node verify_db.js` (1차, 사용자가 터미널에서 PIN 입력)
```
대상: https://ovnagheqsygclposiemh.supabase.co

읽기·권한
  ok  anon이 app_state를 읽을 수 있음  (rev 7, 선수 46명)
  ok  공개 state에 settings.pin이 없음
  ok  anon이 app_state를 직접 UPDATE하면 거부  (401 42501 permission denied for table app_state)
  ok  anon이 app_state에 직접 INSERT하면 거부  (401 42501 permission denied for table app_state)
  ok  anon이 app_state를 DELETE하면 거부  (401 42501 permission denied for table app_state)
  ok  anon이 admin_secret를 읽으면 거부  (401 42501 permission denied for table admin_secret)
  ok  anon이 admin_session를 읽으면 거부  (401 42501 permission denied for table admin_session)
  ok  anon이 admin_login_guard를 읽으면 거부  (401 42501 permission denied for table admin_login_guard)
  ok  anon이 set_admin_pin을 호출하면 거부  (401 42501 permission denied for function set_admin_pin)

로그인·저장
  ok  맞는 PIN으로 로그인하면 토큰 발급
  ok  admin_check: 발급 토큰은 유효, 임의 토큰은 무효
  ok  틀린 PIN 로그인은 실패 (토큰 없음)  (실패 1회 기록됨)
  ok  무효 토큰으로 저장하면 unauthorized  (400 P0001 unauthorized)
  ok  오래된 rev로 저장하면 stale_rev  (400 P0001 stale_rev)
  FAIL 유효한 토큰 + 최신 rev로 저장하면 성공하고 rev +1 (보낸 settings.pin은 서버가 버림)
       400 42725 operator is not unique: unknown - unknown
  ok  change_pin: 지금 PIN이 틀리면 bad_pin  (400 P0001 bad_pin)
  ok  로그아웃하면 토큰 무효

무차별 대입 잠금 (위의 틀린 PIN 1회 + 아래 4회 = 연속 5회)
  ok  틀린 PIN을 연속 5회 넣으면 잠금, 잠긴 동안은 맞는 PIN 도 거부  (잠금 남은 시간 600초)
```
→ 정상 저장 실패: `save_state`의 연산자 우선순위 버그 (docs/wrong-answers.md 7번). schema.sql을 고쳐서 다시 실행하기로 함.

## 9. 운영 결정: 로그인 실패 잠금 제거
사용자 요청으로 연속 5회 실패 잠금을 없앰(4자리 PIN이라 무차별 대입에 약하다는 점은 안내함). `schema.sql`에서 `admin_login_guard` 테이블과 잠금 로직을 지우고 `drop table if exists public.admin_login_guard;` 추가, `verify_db.js` 잠금 시험은 "틀린 PIN 5번 뒤에도 맞는 PIN으로 로그인됨"으로 바꿈. 같은 수정본에 `save_state` 괄호 수정도 들어 있음.
```
$ node deploy.test.js | tail -1
14 passed
$ node logic.test.js | tail -1
43 passed
$ node --check verify_db.js
(출력 없음, 통과)
```

## 10. `node verify_db.js` (2차, 수정한 schema.sql 실행 후, 사용자가 터미널에서 PIN 입력)
```
$ (schema.sql 재실행 후) admin_login_guard GET, app_state rev
[admin_login_guard] {"code":"PGRST205",…,"message":"Could not find the table 'public.admin_login_guard' in the schema cache"} HTTP 404
[app_state rev] [{"rev":7}]

$ node verify_db.js
대상: https://ovnagheqsygclposiemh.supabase.co

읽기·권한
  ok  anon이 app_state를 읽을 수 있음  (rev 7, 선수 46명)
  ok  공개 state에 settings.pin이 없음
  ok  anon이 app_state를 직접 UPDATE하면 거부  (401 42501 permission denied for table app_state)
  ok  anon이 app_state에 직접 INSERT하면 거부  (401 42501 permission denied for table app_state)
  ok  anon이 app_state를 DELETE하면 거부  (401 42501 permission denied for table app_state)
  ok  anon이 admin_secret를 읽으면 거부  (401 42501 permission denied for table admin_secret)
  ok  anon이 admin_session를 읽으면 거부  (401 42501 permission denied for table admin_session)
  ok  anon이 set_admin_pin을 호출하면 거부  (401 42501 permission denied for function set_admin_pin)

로그인·저장
  ok  맞는 PIN으로 로그인하면 토큰 발급
  ok  admin_check: 발급 토큰은 유효, 임의 토큰은 무효
  ok  틀린 PIN 로그인은 실패 (토큰 없음)  (실패 1회 기록됨)
  ok  무효 토큰으로 저장하면 unauthorized  (400 P0001 unauthorized)
  ok  오래된 rev로 저장하면 stale_rev  (400 P0001 stale_rev)
  ok  유효한 토큰 + 최신 rev로 저장하면 성공하고 rev +1 (보 낸 settings.pin은 서버가 버림)  (rev 7 → 8)
  ok  change_pin: 지금 PIN이 틀리면 bad_pin  (400 P0001 bad_pin)
  ok  로그아웃하면 토큰 무효

잠금 없음 (운영 판단)
  ok  틀린 PIN을 5번 넣은 뒤에도 맞는 PIN으로 로그인됨

17 passed, 0 failed
```
("실패 1회 기록됨" 문구는 잠금을 없앤 뒤 맞지 않아 이 실행 뒤에 "null 반환"으로 고침.)

아직 안 한 것: 배포 주소에서 실제 PIN으로 잠금 해제 → 저장 → 새로고침, 두 기기 동시 저장. (같은 흐름은 로컬 가짜 서버에서만 확인함, 5번 참고)

## 11. 돼장 요청(Claude) 기능: 테스트 먼저
```
$ node logic.test.js   (조건·applyPlan 테스트 21개를 먼저 추가한 상태)
  FAIL 8명: 같은 팀 금지(no_partner) 조건이면 두 사람은 절대 한 팀이 안 됨
  FAIL 10명: 같은 팀 금지(no_partner) 조건이면 두 사람은 절대 한 팀이 안 됨
  FAIL 12명: 같은 팀 금지(no_partner) 조건이면 두 사람은 절대 한 팀이 안 됨
  FAIL 같은 경기 금지(no_same_game): 두 사람이 한 경기에 같이 안 들어감
  FAIL 같은 팀 희망(want_partner): 두 사람이 한 번은 파트너가 됨
  FAIL 추가출전 지정(extra_prefer): 홀수 인원이면 지정한 사람이 추가출전
  FAIL 추가출전 제외(extra_avoid): 지정한 사람은 추가출전이 안 됨
  FAIL applyPlan: … (13개)
  FAIL validateWeek: 저장된 조건을 어기면 rule 경고
  FAIL ruleText: 조건을 사람이 읽는 문장으로
44 passed        (기존 43개 + "조건이 있어도 전원 공식 2경기" 1개는 처음부터 통과)

$ node deploy.test.js  (rematch 클라이언트 테스트 2개 추가 직후)
  FAIL api.rematch: 토큰과 요청을 rematch 함수로 보내고 plan·설명을 돌려받음
  FAIL api.rematch: 함수가 ok:false면 code로 reject (unauthorized, ai_limit …)
14 passed
```
구현 후:
```
$ node logic.test.js | tail -1
64 passed
$ node deploy.test.js | tail -1
17 passed
$ (23명 자동 편성 시간, 같은 무작위 입력)
수정 전 코드: 1126ms / 수정 후 조건 없음: 1296ms / 수정 후 조건 4개: 1440ms
```

## 12. 돼장 요청 화면 확인 (로컬 가짜 서버, 가짜 Claude는 낱말로 흉내)
360×780, 10/7 주, PIN 1234로 관리 화면에서 확인. 페이지에서 읽은 값:
| 확인 | 결과 |
|---|---|
| 카드 표시 | "돼장 요청" 카드, 보내기 활성, scrollWidth 360 |
| "조영재랑 김성곤 같은 팀 금지" | 보내는 동안 "고치는 중" 표시 → 미리보기: 조건 추가, 캐비어·랍스터만 "다시 짬", 3경기 모두 "바뀜", "캐비어·랍스터조에 입력된 결과 3경기가 새 편성으로 바뀌면서 지워져요.", "점검 통과: 전원 공식 2경기, 파트너 중복 없음, 조건 지킴" |
| 적용 | 토스트 "요청을 반영했어요. 점검 결과를 확인하고 저장해 주세요.", 저장 바 나타남, 조건 목록 "조영재·김성곤 같은 팀 금지 [지우기]", 입력칸 비워짐 |
| "돼지갈비·닭갈비 2경기 서민희랑 이선미 바꿔줘" | 2경기만 "바뀜"(이선미·이태훈 vs 서민희·육민주), 나머지 그대로, 점검 통과 |
| 미리보기 중 편성을 바꾸고 적용 | "그사이 편성이 바뀌었어요. 요청을 다시 보내 주세요.", 미리보기 닫힘 |
| 조건 있는 상태에서 A조 자동 편성 5번 | 조영재·김성곤 한 팀 0번 |
| 저장 → 새로고침 | 조건 유지 |
| 조건 지우기 → 되돌리기 | 0개 → 1개 |
| 빈 요청 | "요청을 먼저 적어 주세요." |
| 알 수 없는 요청 | "바뀌는 경기가 없어요." + (수정 후) 닫기 버튼만 |

아직 안 한 것: 실제 Claude 호출(`supabase/functions/rematch`) — API 키와 함수 배포 뒤 `node verify_ai.js`로 확인 예정.

## 13. Edge Function rematch 실제 배포 확인
```
$ curl -X OPTIONS .../functions/v1/rematch (Origin: github.io)      → HTTP 200
$ curl -X POST .../functions/v1/rematch (apikey만, 가짜 토큰)        → {"ok":false,"code":"unauthorized"} HTTP 200
$ curl -X POST .../functions/v1/rematch (apikey+Bearer, 가짜 토큰)   → {"ok":false,"code":"unauthorized"} HTTP 200
```

## 14. `node verify_ai.js @req1.txt 2026-10-28` (사용자가 PIN 입력, 저장 안 함)
요청 파일 내용: "김성곤이랑 유성준은 같은 팀 하지 말아 줘"
```
주: 2026-10-28, 참석 26명, 경기 15개
요청: 김성곤이랑 유성준은 같은 팀 하지 말아 줘

Claude 설명: 김성곤·유성준 같은 팀 금지 조건을 걸었어요. 지금 캐비어·랍스터(A조) 1경기와 3경기에서 두 분이 같은 팀이라 A조만 다시 짜요. 결과가 입력된 경기는 없어서 기록에는 영향이 없 어요.
계획: {"rules_add":[{"type":"no_partner","players":["p005","p001"]}],"rules_remove":[],"pool_moves":[],"regenerate":[],"edits":[]}
다시 짠 조: A
반영 못 한 것: 없음
점검: 이영승·육민주 파트너가 12경기와 14경기에서 겹쳐요 / 박 희수: 공식 0경기 (2경기여야 해요) / 이태훈: 공식 1경기 (2경기여야 해요)
시간 7.5초, 모델 claude-opus-5-5, 입력 4866 / 출력 332 토큰, 약 $0.0261
```
점검 경고 원인 확인 (지금 저장된 10/28 편성, 위 계획 적용 전):
```
지금 편성 점검: 유성준·김성곤 파트너가 1경기와 3경기에서 겹쳐요 / 유성준·주성모 파트너가 2경기와 4경기에서 겹쳐요 / 이영승·육민주 파트너가 13경기와 15경기에서 겹쳐요
박희수 등록조 B 이번주 편성조 B 출전 경기 조 A,A,B(추가)
이태훈 등록조 B 이번주 편성조 B 출전 경기 조 A,B
```
→ 이영승·육민주 겹침은 원래 C조 편성에 있던 것. 박희수·이태훈은 편성 조는 B인데 A조 경기에 직접 넣어 둔 상태라, A조를 참석자 편성 조 기준으로 다시 짜면서 A조에서 빠짐(앱의 regenPool이 "빌려 온 사람"을 모름).

## 15. 지옥도↑·천국도↓ 조 옮기기 + 다른 조 경기에 직접 넣어 둔 사람 처리
돼장 요청(밴드 대화): 지옥도를 다음 주에 한 조 위(예: 소갈비 → 랍스터)에서 경기하게. 사용자 결정: 천국도도 한 조 아래로, 버튼 방식.
```
$ node logic.test.js   (tierShift·borrowed 테스트 6개 먼저 추가)
  FAIL tierShift: 지옥도는 한 조 위로, 천국도는 한 조 아래로   — L.tierShift is not a function
  FAIL tierShift: … (2개 더)
  FAIL regenPool: 편성 조는 B인데 공식 경기가 전부 A조에 있는 사람은 A조를 다시 짤 때 함께 짬 — b3가 빠짐
  FAIL regenPool: 두 조에 나눠 들어간 사람은 split으로 알려 줌
  FAIL applyPlan: 다시 짠 조에 나눠 들어간 사람이 있으면 warnings
64 passed
```
첫 구현에서 "공식 경기가 한 조에만 있으면 그 조 사람"으로 보게 했더니 기존 테스트 `applyPlan pool_moves`가 깨짐(조를 옮긴 사람을 옛 경기 위치로 되돌림) → 편성 조를 따로 옮긴 사람(편성 조 ≠ 등록 조)과 이번에 옮긴 사람은 편성 조를 그대로 믿도록 고침. "원래 조로 되돌리기" 테스트 추가.
```
$ node logic.test.js | tail -1
71 passed
$ node deploy.test.js | tail -1
17 passed
```
실제 데이터(rev 56)로 14번의 Claude 계획을 다시 적용 (읽기만):
```
rev 56 | 다시 짠 조: A | 경고: 이태훈: 두 조 경기에 나눠 들어가 있어서 A조를 다시 짜면 경기 수가 맞지 않아요. 한 조로 옮겨 주세요.
점검: 이영승·육민주 파트너가 12경기와 14경기에서 겹쳐요 / 이태훈: 공식 1경기 (2경기여야 해요)
10/28 지옥도·천국도 이동 후보: 김성곤 A→B(heaven), 양회욱 B→A(hell), 김예슬 B→C(heaven), 용현정 B→C(heaven), 이정찬 B→A(hell), 육민주 C→B(hell), 이영승 C→B(hell)
```
(박희수 "공식 0경기" 경고는 사라짐. 이태훈은 이름을 짚어 경고.)

화면 확인: 로컬 가짜 서버에 실제 데이터 사본(rev 56)을 넣고 360×780, 10/28 주:
| 확인 | 결과 |
|---|---|
| 버튼 | "지옥도↑ · 천국도↓ 조 옮기기" |
| 누름 | "이렇게 옮길까요?" + 위 7명 목록(조 → 조, 등급) + 옮기기/취소 |
| 옮기기 | "지옥도 4명은 한 조 위로, 천국도 3명은 한 조 아래로 옮겼어요. 자동 편성을 다시 눌러 주세요.", 칩에 ↑/↓ 표시와 "○○조에서 경기" 설명 |
| 전체 자동 편성 | 캐비어·랍스터 7명·4경기 / 소갈비·양갈비 10명·5경기 / 돼지갈비·닭갈비 9명·5경기, 점검 "참석자 전원 공식 2경기, 파트너 중복 없음", scrollWidth 360 |

## 16. rematch 함수 다시 배포 후 `node verify_ai.js @req2.txt 2026-10-28` (사용자가 PIN 입력, 저장 안 함)
요청 파일 내용: "지옥도는 다 한 조 위에서, 천국도는 한 조 아래에서 뛰게 해 줘"
```
주: 2026-10-28, 참석 26명, 경기 15개
요청: 지옥도는 다 한 조 위에서, 천국도는 한 조 아래에서 뛰게 해 줘

Claude 설명: 천국도 김성곤(A→B), 김예슬·용현정(B→C)은 한 조  아래로, 지옥도 양회욱·이정찬(B→A), 육민주·이영승(C→B)은 한 조 위로 옮겼어요. 김형준·조영재는 이미 맨 위 조(캐비어·랍스터) 의 지옥도이고, 김용숙·조인규는 이미 맨 아래 조(돼지갈비·닭갈 비)의 천국도라서 그대로 두었어요. 세 조 모두 다시 짜지지만,  결과가 입력된 경기는 없어서 기록에는 영향이 없어요.
계획: {"rules_add":[],"rules_remove":[],"pool_moves":[{"player":"p005","pool":"B"},{"player":"p011","pool":"A"},{"player":"p028","pool":"A"},{"player":"p012","pool":"C"},{"player":"p025","pool":"C"},{"player":"p041","pool":"B"},{"player":"p043","pool":"B"}],"regenerate":[],"edits":[]}
다시 짠 조: A, B, C
반영 못 한 것: 없음
점검: 통과
시간 11.3초, 모델 claude-opus-5-5, 입력 5235 / 출력 619 토큰, 약 $0.0333
```
→ 버튼(tierShift)이 고른 7명과 같음.

## 17. 지옥도·천국도: "전부 옮길까요?" 대신 후보 이름 버튼으로 한 명씩
사용자 요청: 후보를 지옥도(…)/천국도(…)로 나눠 보여 주고, 누른 사람만 옮기기.
```
$ node logic.test.js   (tierCandidates 테스트 2개 먼저 추가)
  FAIL tierCandidates: 지옥도·천국도 후보 전부 (이미 옮긴 사람은 moved:true, 위·아래 조 없으면 빠짐) — L.tierCandidates is not a function
  FAIL tierCandidates: 참석 안 한 사람은 후보 아님 — L.tierCandidates is not a function
71 passed
(구현 후)
73 passed
$ node deploy.test.js | tail -1
17 passed
```
화면 확인 (실제 데이터 사본 rev 56, 360×780, 10/28, 임시저장 지운 뒤):
| 확인 | 결과 |
|---|---|
| 처음 | "지옥도 · 한 조 위에서 0/4명 옮김: 양회욱 ↑랍스터, 이정찬 ↑랍스터, 육민주 ↑양갈비, 이영승 ↑양갈비" / "천국도 · 한 조 아래에서 0/3명 옮김: 김성곤 ↓양갈비, 김예슬 ↓닭갈비, 용현정 ↓닭갈비", 저장 바 없음 |
| 양회욱 누름 → 다시 누름 | "양회욱: 캐비어·랍스터조에서 경기해요. 자동 편성을 다시 눌러 주세요." ↔ "양회욱: 원래 조(소갈비·양갈비)로 돌아왔어요. …" |
| 이정찬·김성곤만 누르고 전체 자동 편성 | 1/4명, 1/3명 옮김 → 캐비어·랍스터 6명·3경기 / 소갈비·양갈비 11명·6경기 / 돼지갈비·닭갈비 9명·5경기, 점검 "참석자 전원 공식 2경기, 파트너 중복 없음", scrollWidth 360 |

## 18. 지옥도·천국도: 참석자·방향 드롭다운 + 확인, 구역 여백 늘림
사용자 요청: 이름 버튼 대신 "내 이름" 드롭다운처럼 참석자와 승급/하향을 골라 확인. 주제가 바뀌는 곳 위아래 여백 늘리기.
```
$ node logic.test.js   (shiftTarget 테스트 먼저 추가)
  FAIL shiftTarget: 등록 조 기준으로 한 조 위(up)/아래(down)/원래 조(back), 없으면 null — L.shiftTarget is not a function
73 passed
(구현 후)
74 passed
$ node deploy.test.js | tail -1
17 passed
```
화면 확인 (실제 데이터 사본 rev 56, 360×780, 10/28):
| 확인 | 결과 |
|---|---|
| 안내 | "지옥도 한 조 위 추천: 양회욱, 이정찬, 육민주, 이영승" / "천국도 한 조 아래 추천: 김성곤, 김예슬, 용현정" |
| 참석자 드롭다운 | 조별 묶음 캐비어·랍스터 5 / 소갈비·양갈비 11 / 돼지갈비·닭갈비 10, 후보에 "· 지옥도"/"· 천국도" 표시 |
| 김성곤 고름 | 방향이 "한 조 아래로 (하향)"으로 자동 선택 → 확인 → "김성곤: 소갈비·양갈비조에서 경기해요. 자동 편성을 다시 눌러 주세요.", "지금 다른 조에서 뛰는 사람 김성곤 (캐비어·랍스터 → 소갈비·양갈비)", 선택 초기화 |
| 김형준(맨 위 조) + 승급 | "김형준: 맨 위 조라 더 올릴 수 없어요." |
| 여백·가로 넘침 | 구역 위아래 구분선과 여백(스크린샷 확인), scrollWidth 360 |

## 19. 지옥도·천국도 추천 문구 두 줄 제거 (사용자 요청)
```
$ node logic.test.js | tail -1
74 passed
$ node deploy.test.js | tail -1
17 passed
```
화면 확인 (실제 데이터 사본, 10/28): 구역 첫 줄 "지옥도·천국도 조 옮기기 고른 사람만 옮겨져요. …" 다음 바로 "참석자" 드롭다운, "추천" 문구 없음, 드롭다운의 지옥도·천국도 표시 7개는 그대로.

## 20. 돼블스플랜(승부 예측) 1단계 — 브랜치 feat/daebles-plan (2026-11-14, Node v22.14.0)
### 로직 테스트 먼저 (구현 전)
```
$ node logic.test.js   (예측 테스트 28개 추가, logic.js는 그대로)
  FAIL predictionDeadline: 그 날 17:30 KST (= 08:30 UTC)
  FAIL isPredictionClosed: 17:29:59는 열림, 17:30:00부터 마감
  FAIL validatePicks: 서로 다른 4경기·a/b면 오류 없음
  FAIL validatePicks: 3개·5개·배열 아님은 count
  FAIL validatePicks: 중복 경기·없는 경기·잘못된 side
  FAIL 하이리스크 4경기 모두 적중 → hit +3
  FAIL 하이리스크 하나 틀림 → miss -1
  FAIL 안전형 적중 +1, 실패 0
  FAIL 결과가 덜 나왔고 틀린 게 없으면 pending, 보너스 0
  FAIL 대기 중이어도 하나 틀리면 즉시 miss
  FAIL 고른 경기가 편성에서 사라지면 check, 보너스 0
  FAIL 사라진 경기가 있으면 다른 경기가 틀려도 check (자동 처리 안 함)
  FAIL 선수 자리가 빈 경기(무효)는 check
  FAIL 주가 없거나 픽이 4개가 아니면 check
  FAIL bonusByPlayer: 주차별 합계, 공개 안 된 주·없는 주는 0
  FAIL standings: 보너스 없으면 기존과 같은 순서·순위
  FAIL standings: 보너스 합산으로 순위, 공식 승은 그대로
  FAIL standings: 합계 동률은 같은 순위, 패 적은 쪽이 위 (기존 동률 규칙)
  FAIL popularPicks: 팀별 인원 순위, 경기 안 비율, 0명·없는 경기 제외
  FAIL popularPicks: 방식 필터
  FAIL pickChanges: 최근 1시간 이벤트의 증감 합 (방식 필터)
  FAIL pickBadges: 상한가는 경기 안 70% 이상, 작전주는 가장 많이 걸린 선수 1명
  FAIL closeFromPredictions: 두 방식 합산 마감 비율 (prediction_close 모양)
  FAIL closingReport: 결과가 다 안 나오면 ready false
  FAIL closingReport: 상한가·폭락주·역배 적중·수익·적중자
  FAIL closingReport: 마감 스냅숏이 있으면 그 비율을 씀 (마감 후 수정과 무관)
  FAIL closingReport: 스냅숏이 없으면 예측으로 계산, 소수 픽 승이 없으면 역배 null
75 passed
```
- 27개 FAIL. 통과 75 = 기존 74 + "지옥도·천국도는 보너스와 무관"(기존 tierOf만 써서 구현 전에도 통과)
```
$ node logic.test.js   (logic.js 구현 후)
102 passed
$ node logic.test.js   (작은 추세선 pickTrend 테스트 1개 먼저 추가)
  FAIL pickTrend: 지금 인원에서 거꾸로 빼 가며 만든 누적 인원 추이 (오래된 것부터, 최대 12점)
       L.pickTrend is not a function
102 passed
$ node logic.test.js   (구현 후)
103 passed
```
### remote.js 테스트 먼저
```
$ node deploy.test.js   (예측 API 테스트 4개 추가, remote.js는 그대로)
  FAIL api.watchPredictions: Realtime이 없거나 꺼져 있으면 구독 안 하고 live=false
  FAIL api 예측: counts·events·close·predictions를 그 주 기준으로 읽음
  FAIL api.submitPrediction: RPC 이름·인자, 마감 후는 closed 코드
  FAIL api 예측 관리: 토큰과 함께 목록·수정·삭제, 마감 스냅숏
17 passed
$ node deploy.test.js   (구현 후)
21 passed
```
### 가짜 서버로 DB 검증 스크립트 미리 돌리기 (실제 DB 아님)
`tools/mock_supabase.js`(PORT 8790, live_state.json)에 대고 실행. 가짜 서버는 schema.sql을 JS로 흉내 낸 것이라 SQL 자체를 검증한 것은 아님.
```
$ VERIFY_URL=http://localhost:8790 ADMIN_PIN=1234 node verify_db.js --predict
대상: http://localhost:8790


돼블스플랜 예측 (테스트 날짜 2000-01-05 · 2099-12-30, app_state 읽기만)
  ok  관리자 로그인 + 명단에서 선수 2명 읽기 (읽기만)  (rev 7)
  ok  이전 시험 찌꺼기 정리 + 테스트 주 만들기 (2000·2099년만)
  ok  테스트 주 함수: 실제 날짜는 test_date_only, 무효 토큰은 unauthorized
  ok  anon이 predictions에 직접 INSERT하면 거부  (401 42501 permission denied for table predictions)
  ok  anon이 prediction_counts에 직접 INSERT하면 거부  (401 42501 permission denied for table prediction_counts)
  ok  anon이 prediction_events에 직접 INSERT하면 거부  (401 42501 permission denied for table prediction_events)
  ok  anon이 prediction_close에 직접 INSERT하면 거부  (401 42501 permission denied for table prediction_close)
  ok  제출 거부: 3개 → bad_count
  ok  제출 거부: 5개 → bad_count
  ok  제출 거부: 중복 경기 → dup_match
  ok  제출 거부: 없는 경기 → bad_match
  ok  제출 거부: 잘못된 side → bad_side
  ok  제출 거부: 명단에 없는 선수 → bad_player
  ok  제출 거부: 없는 방식 → bad_mode
  ok  마감 후 제출 거부 → closed
  ok  정상 제출 → counts +1 (방식별), 이벤트 +4
  ok  마감 전 anon이 predictions를 읽으면 0행
  ok  수정하면 이전 선택은 감소, 새 선택은 증가 (이벤트 -1/+1)
  ok  방식을 바꾸면 하이리스크 counts는 빠지고 안전형으로 들어감
  ok  관리자 목록: 마감 전에도 전체 보임, 무효 토큰은 unauthorized
  ok  관리자 토큰으로는 마감 후에도 수정 가능, 무효 토큰은 거부
  ok  마감 후에는 anon도 predictions를 읽을 수 있음
  ok  close_snapshot: 마감 전 0, 마감 후 한 번만 채움 (두 번째는 0)  (넣은 행 5)
  ok  스냅숏 뒤 관리자 수정은 마감 비율(prediction_close)을 바꾸지 않음
  ok  관리자 삭제 → counts 원래대로
  ok  정리: 테스트 날짜의 행을 모두 지우고 남은 것 없음  (지운 행 {"predictions":2,"prediction_counts":14,"prediction_events":14,"prediction_close":5,"prediction_test_weeks":2})
  ok  app_state는 그대로 (rev 변화 없음)  (rev 7)

27 passed, 0 failed
```
### 화면 확인 (MOCK_DEMO=1, seed.js 명단으로 만든 가짜 주차·예측, 실제 데이터 아님)
| 확인 | 결과 |
|---|---|
| 예측 탭 11/18 (마감 전) | 배너 "11/18(수) · 승리를 예측하라!", "마감까지 3일 22시간", "참여 14명", 실시간 인기 픽 5팀 + "전체 보기 (16팀)", 체결 3줄 |
| 제출 (김형준, 하이리스크, 4경기) | 토스트 "제출했어요. 마감 전까지 고칠 수 있어요.", 내 예측 카드 4칸 ⏳, localStorage `ddw-pred`에 저장. 같은 사람이 이미 낸 예측이 있어 덮어씀 → 참여 14명 그대로, 이벤트 -1 3건·+1 3건 |
| 같은 경기 다른 팀 누르기 | 선택이 바뀜(4/4 유지). 4개 고른 뒤 나머지 13경기 흐림·버튼 26개 disabled |
| 11/11 (마감·결과 완료) | 장 마감 리포트: 참여 18 / 적중 2 / 실패 16, 상한가 83%, 폭락주 82% "9명이 함께 날렸습니다", 역배 18%, 수익 +4승, 적중자 2명. 전원 공개 18명 |
| 리포트 크기 | 390×844에서 카드 위 12px ~ 아래 633px(스크롤 없음), 360×780에서도 12~633px |
| 순위 (소갈비·양갈비) | 보너스 칸 추가, 김혜선 공식 6승 +3 → 1위, 표 아래 "승수 = 공식 경기 + 돼블스플랜 보너스" |
| 관리 › 예측 (PIN 1234, 가짜 서버) | 11/18 14명 전체 보임. 권영순 안전형→하이리스크 고치기 저장 → "예측을 저장했어요." / 1경기 삭제(저장 안 함) → "확인 필요 9명" 경고, 되돌리기 후 0명 |
| 마감 넘어가기 (MOCK_NOW=2026-11-18T17:29:30+09:00, 브라우저 시계도 콘솔에서 같은 시각으로) | "마감까지 0:00:27" → 30초 뒤 "장 마감", 예측하기 화면 닫힘, 전원 공개 0명 → 14명 |
| 브라우저 시계가 늦을 때 마감 후 제출 | 서버가 closed → 토스트 "마감됐어요(수요일 17:30). 이제는 돼장만 고칠 수 있어요.", localStorage 저장 안 함 |
| 가로 넘침 | scrollWidth 360(360px) · 390(390px) · 1009(1024px, 세로 스크롤바 15px) |
| 배너 글자와 캐릭터 (360px) | 글자 오른쪽 끝 213px, 돼지 시작 213px(왼쪽 28%는 투명→불투명 마스크라 259px부터 다 보임), 배너 높이 137px |
### 기존 탭 회귀 비교 (main 빌드 vs 이 브랜치, 같은 MOCK_DEMO 데이터, 360×780, 11/11, 내 이름 김형준)
| 탭 | main | 이 브랜치 |
|---|---|---|
| 이번 주 | main 높이 3209px, 글자 839자 | 3209px, 839자 (같음) |
| 내 기록 | 948px, "조 내 8위" | 948px, "조 내 9위" (보너스 합산 순위. 나머지 글자 같음) |
| 순위 | 2248px | 2272px (보너스 칸, 안내 한 줄 추가) |

### 사용자 SQL Editor 실행 1회차 (사용자가 붙여 준 결과)
```
Failed to run sql query: ERROR:  42601: syntax error at or near "language"
LINE 213: language sql stable security definer set search_path = public as $$
          ^
```
원인 확인 (Windows PowerShell 5.1):
```
기본(ANSI) 읽기 줄 수: 402 / UTF8 읽기 줄 수: 406
기본 읽기 213번째 줄: language sql stable security definer set search_path = public as $$
UTF8 읽기 213번째 줄: -- 그 주 경기 id 목록 (app_state의 공개된 주, 없으면 가짜 주). 읽기만 함
```
→ 복사 명령에 `-Encoding UTF8` 필요. schema.sql 파일은 그대로.

### 사용자 SQL Editor 실행 2회차 (`Get-Content supabase\schema.sql -Raw -Encoding UTF8 | Set-Clipboard` 후 Run) → `node verify_db.js --predict`
사용자가 알려 준 결과(전체 출력은 사용자 터미널에만 있음):
```
27 passed, 0 failed
```
그 뒤 anon 키로 실제 DB를 읽기만 해서 확인 (2026-11-14):
```
predictions        전체 200 */0 | 테스트 날짜 200 */0
prediction_counts  전체 200 */0 | 테스트 날짜 200 */0
prediction_events  전체 200 */0 | 테스트 날짜 200 */0
prediction_close   전체 200 */0 | 테스트 날짜 200 */0
prediction_test_weeks (anon) 401 {"code":"42501", …}
app_state 200 [{"rev":382,"saved_at":"2026-11-12T01:42:17.602166+00:00"}]
```
- 새 표 4개가 있고 행 0개(테스트 날짜 2000·2099년 행도 0개 → 정리됨). prediction_test_weeks는 anon 읽기 거부
- app_state 마지막 저장은 11/12 그대로(검증이 쓰지 않음)
- 확인 못 한 것: 실제 DB에서 브라우저 2개로 Realtime 반영(실제 주에 제출해야 해서 하지 않음)

## 21. 인기 픽 바꾸기 (사용자 요청, 브랜치 feat/daebles-popular-tabs, 2026-11-15)
요청: 하이리스크/안전형 필터 대신 조 탭(전체·캐비어·랍스터·소갈비·양갈비·돼지갈비·닭갈비), 선수별로 몇 명이 골랐는지 순위, 막대를 바탕+색 채움으로, 빨간 추세선 빼기.
```
$ node logic.test.js   (선수별 집계 playerPicks 테스트 2개 먼저 추가, 추세선 pickTrend 테스트 1개 삭제)
  FAIL playerPicks: 선수가 들어간 팀을 고른 수를 합친 순위 (동률은 같은 순위, id 순)
       L.playerPicks is not a function
  FAIL playerPicks: 최근 증감(pickChanges 결과)을 선수별로 합침, 고른 경기만 넘기면 그 경기들만
       L.playerPicks is not a function
102 passed
$ node logic.test.js   (구현 후)
104 passed
$ node deploy.test.js
21 passed
```
화면 확인:
| 확인 | 결과 |
|---|---|
| 실제 데이터 복사본(로컬 가짜 서버 8793, 실제 DB 읽기만 해서 복사) + 가짜 예측 20명, 390px | 조 탭 4개 "전체 / 캐비어·랍스터 / 소갈비·양갈비 / 돼지갈비·닭갈비", 추세선 0개, 가로 넘침 없음(scrollWidth 390) |
| 소갈비·양갈비 탭 + 팀별 | 그 조 경기만: 1위 6명 86%, 2위 5명 83% 두 팀(동률 2위) |
| 전체 + 선수별 | 1위 14명(작전주 배지), "전체 보기 (27명)" |
| 360px | 카드 16~344px, 마지막 조 탭 오른쪽 끝 327px, 조 탭 높이 51px, 막대 높이 10px, scrollWidth 360 |
| PR 스크린숏 | MOCK_DEMO(seed.js 가짜 데이터)로 찍음: docs/screenshots/daebles/390-popular-team.jpg, 390-popular-player.jpg |

## 22. 인기 픽 팀별 카드 개편 + 조별 슈퍼매치 (사용자 요청, 같은 브랜치 feat/daebles-popular-tabs, 2026-11-15)
구조 확인: `prediction_counts`(경기·팀·방식별 인원)만으로 계산 가능해서 DB는 바꾸지 않음. 한 사람은 서로 다른 4경기만 고를 수 있어(서버 `pred_check`) 한 경기 양 팀 인원의 합 = 그 경기를 예측한 서로 다른 회원 수. 마감 후에는 `prediction_close`(마감 시점 스냅숏) 사용.
```
$ node logic.test.js   (matchBoard·superMatches·선수별 비율 테스트 6개 먼저 추가)
  FAIL playerPicks: 선택 비율 = 그 선수 경기를 고른 수 중 그 선수 팀을 고른 수 (상대 팀만 고른 경기도 분모에 포함)
  FAIL matchBoard: 경기별 양 팀 인원·비율(분모는 그 경기를 고른 인원), 0명 경기도 오류 없이 포함
       L.matchBoard is not a function
  FAIL matchBoard 배지: 70% 초과 인기 픽(hot), 30% 미만 역배 후보(under), 고른 사람이 5명 미만이면 배지 없음
       L.matchBoard is not a function
  FAIL superMatches: 조마다 예측 인원이 가장 많은 경기 (양 팀·두 방식 합산), 다른 조와는 비교하지 않음
       L.superMatches is not a function
  FAIL superMatches: 공동 1위는 모두, 예측이 없는 조는 없음, 0명·없는 경기는 무시
       L.superMatches is not a function
  FAIL superMatches: 마감 스냅숏(prediction_close 모양, mode 없음)으로도 같은 결과
       L.superMatches is not a function
104 passed
$ node logic.test.js   (구현 후)
110 passed
$ node deploy.test.js
21 passed
```
화면 확인 A — 실제 데이터 복사본(실제 DB를 읽기만 해서 복사) + 가짜 예측 20명, 로컬 가짜 서버 8793, 390px:
| 확인 | 결과 |
|---|---|
| 팀별 카드 14개를 서버 집계(prediction_counts)에서 직접 계산한 값과 비교(인원·%·총 인원·막대 폭·배지·슈퍼매치) | 불일치 0건. 막대 폭 합 100%(예: 42.86% / 57.14%) |
| 조별 최다 | A 7명, B 7명, C 8명 → 슈퍼매치 4경기(C조는 8명 공동 1위 2경기 모두) |
| 조 탭 소갈비·양갈비 | 그 조 6경기만, 슈퍼매치 1경기(총 7명) |
| 선수별 27명을 서버 집계에서 직접 계산한 값과 비교(인원·%·막대) | 불일치 0건. 1위 14명 70% |
| 이번 주 탭 | 경기 번호 옆 "🔥 슈퍼매치 · 7명 참여" 등 4개, scrollWidth 390 |
| 다른 사람 제출 뒤 자동 갱신(이번 주 탭을 건드리지 않고 대기, 로컬은 Realtime 대신 20초 다시 읽기) | 3명 추가 제출 → B조 2경기 6→9명. 14초 뒤 B조 슈퍼매치가 1경기(7명)→2경기(9명), A조는 1·2경기 공동(각 9명)으로 바뀜 |
화면 확인 B — MOCK_DEMO(seed.js 가짜 데이터), 360px:
| 확인 | 결과 |
|---|---|
| 11/11(마감) | "마감 인기 픽 · 마감 시점 집계". 관리자 RPC로 한 명 예측을 다른 경기로 바꾼 뒤: prediction_counts는 바뀌고 prediction_close 16행은 그대로, 카드 14개·슈퍼매치 동일 |
| 11/18 돼지갈비·닭갈비 탭 | 5경기 중 3경기가 0명 → "– 0명 vs – 0명 / 아직 고른 사람이 없어요", 빈 막대, 오류 없음 |
| 마감 전 `predictions` 읽기(가짜 서버 RLS 흉내) | 0행 |
| 예측하기 화면 | 슈퍼매치 경기 3개에 배지, 제출 → "제출했어요…", 참여 14→15명 |
| 순위·관리 › 예측(가짜 서버 PIN) | 순위표 머리글 그대로, 관리 목록 15명 |
| 가로 넘침 | scrollWidth 360 |
확인 못 한 것: 실제 DB의 Realtime 경로(실제 주에 제출해야 함). 한쪽 100% 카드는 가짜 데이터에 없어서 화면으로는 못 봤고 테스트(matchBoard 배지)로만 확인.

## 23. 인기 픽 색 체계: 네이비 + 뮤트 로즈 (사용자 요청, 2026-11-15)
인기 픽 카드(`.pp`) 안에서만 적용. 다른 화면의 토큰(--bg, --text 등)과 배너·장 마감 리포트의 핑크는 그대로.
```
$ node deploy.test.js | tail -1
21 passed
```
화면 확인(MOCK_DEMO 가짜 데이터, 390px) — 브라우저가 계산한 색:
| 요소 | 값 |
|---|---|
| 1팀 막대·% | rgb(37, 45, 89) = #252D59 |
| 2팀 막대·% | rgb(198, 83, 120) = #C65378 |
| 카드 배경 / 테두리 | #FFFFFF / rgb(220, 226, 239) = #DCE2EF |
| 기본 글자 / 보조 글자 | rgb(36, 40, 58) = #24283A / rgb(115, 123, 144) = #737B90 |
| 인기 픽 배지 | 배경 #FBE8EF, 글자 #A94365 |
| 역배 후보 배지 | 배경 #EAF1FF, 글자 #315CA8 |
| 슈퍼매치 배지 | 배경 #FFF2D5, 글자 #8B6418 |
| 막대 | 그라데이션 없음(background-image none), 두 막대 사이 흰 선 2px, 카드 그림자 없음 |
| 선수별 | 순위 숫자·막대 #252D59, 배지 글자 "인기 선수" |
| 가로 넘침 | scrollWidth 390 |

## 24. 인기 선수 배지: 지금 보는 탭(전체 또는 그 조) 안의 1위 (사용자 요청, 2026-11-15)
화면 확인(MOCK_DEMO 가짜 데이터, 11/18, 선수별):
| 탭 | 1위 (인기 선수) | 배지 수 |
|---|---|---|
| 전체 | 주성모 20명 77% | 1 |
| 캐비어·랍스터 | 주성모 20명 77% | 1 |
| 소갈비·양갈비 | 차승운 9명 75% | 1 |
| 돼지갈비·닭갈비 | 조인규 6명 55% | 1 |

## 25. 이번 주 탭 슈퍼매치 경기 카드: 조 색 테두리 2px + 연한 조 색 배경 (사용자 요청, 2026-11-15)
선정 로직·데이터는 그대로. 기존 조 토큰 `--t-mid`(테두리), `--t-tint`(배경), `--t-line`(선수 칸 테두리) 재사용, 새 색 없음.
```
$ node deploy.test.js | tail -1
21 passed
```
화면 확인(MOCK_DEMO, 11/18, 390px) — 브라우저가 계산한 값(창 배율 0.8이라 2px → 1.6px로 표시):
| 경기 | 테두리 | 배경 |
|---|---|---|
| 캐비어·랍스터 4경기 (슈퍼매치 12명) | 1.6px rgb(184, 64, 58) = --gA | rgb(251, 238, 239) |
| 소갈비·양갈비 1경기 (슈퍼매치 7명) | 1.6px rgb(46, 139, 87) = --gB | rgb(234, 244, 238) |
| 돼지갈비·닭갈비 4경기 (슈퍼매치 6명) | 1.6px rgb(210, 100, 138) = --gC | rgb(253, 238, 243) |
| 일반 경기 (예: 캐비어·랍스터 1경기) | 0.8px rgb(220, 226, 236) (기존) | 흰색 (기존) |
경기 카드 17개 중 슈퍼매치 3개, scrollWidth 390.

## 26. 조별 고정(캐비어·랍스터 1 · 소갈비·양갈비 2 · 돼지갈비·닭갈비 1) · 하이리스크 실패 -2 · 예측하기 조별 배너 (돼장 결정, 브랜치 feat/daebles-quota, 2026-11-16)
시작 전 실제 DB(읽기만): 11/18 prediction_counts 0행(제출 0건), 조 A=캐비어·랍스터 B=소갈비·양갈비 C=돼지갈비·닭갈비, 11/18 경기 A 3 · B 6 · C 5.
```
$ node logic.test.js   (조별 고정·-2 테스트 먼저)
  FAIL PREDICT.quota: 캐비어·랍스터(A) 1 · 소갈비·양갈비(B) 2 · 돼지갈비·닭갈비(C) 1, 합 4
  FAIL validatePicks 조별 고정: A1·B2·C1이면 통과, 아니면 quota
  FAIL validatePicks 조별 고정: 한 조 경기가 모자라 채울 수 없는 주는 예전처럼 아무 4경기
  FAIL quotaStatus: 조별로 몇 개 골랐는지·더 고를 수 있는지
  FAIL 하이리스크 하나 틀림 → miss -2
  FAIL 대기 중이어도 하나 틀리면 즉시 miss
  FAIL bonusByPlayer: 주차별 합계, 공개 안 된 주·없는 주는 0
107 passed
$ node logic.test.js   (구현 후)
114 passed
$ node deploy.test.js   (bad_quota 코드·schema.sql 고정값 = logic.js 테스트 먼저)
  FAIL schema.sql pred_check: 조별 고정(bad_quota)이 logic.js PREDICT.quota와 같음
  FAIL api.submitPrediction: RPC 이름·인자, 마감 후는 closed 코드
20 passed
$ node deploy.test.js   (구현 후)
22 passed
$ VERIFY_URL=http://localhost:8790 ADMIN_PIN=1234 node verify_db.js --predict   (가짜 서버, 실제 DB 아님)
  ok  제출 거부: 조별 고정 어김(A1·B1·C2) → bad_quota
28 passed, 0 failed
```
화면 확인(MOCK_DEMO, 11/18):
| 확인 | 결과 |
|---|---|
| 예측하기 조별 배너 | 캐비어·랍스터조 "1경기 고르기 고름 0/1"(4경기) · 소갈비·양갈비조 "2경기 고르기 고름 0/2"(8경기) · 돼지갈비·닭갈비조 "1경기 고르기 고름 0/1"(5경기) |
| 캐비어·랍스터 1경기 고른 뒤 | 같은 조 4경기 중 3경기 흐림, 다른 경기 버튼 disabled. 같은 경기 다른 팀으로는 바뀜 |
| 소갈비·양갈비 2경기 고른 뒤 | 8경기 중 6경기 흐림 |
| 다 고른 뒤 | 배너 "고름 1/1 ✓ · 2/2 ✓ · 1/1 ✓", 아래 바 "선택 4/4 🔥 하이리스크 +3 / −2" → 제출 성공 |
| 하이리스크 카드 | "하나라도 틀리면 −2승" |
| 서버 규칙(가짜 서버 RPC 직접) | 캐비어·랍스터 2경기 넣으면 bad_quota |
| 내 예측 카드 | 4칸을 조 순서로, 이름 앞에 조 색 점 |
| 데모 예측 32건 | 조별 고정 위반 0건 |
| 가로 넘침(헤드리스 Chrome 390px) | scrollWidth 390 |

### 26-1. 배포·SQL·실제 DB 확인 (2026-11-16)
1. PR #3 머지 → `Deploy to GitHub Pages` (fb978ff) `completed success`
2. 사용자가 SQL Editor에서 `Get-Content supabase\schema.sql -Raw -Encoding UTF8 | Set-Clipboard` 후 Run → 완료
3. 사용자가 `node verify_db.js --predict` 실행 → 사용자 보고: 모두 통과 (가짜 서버 미리 실행 결과는 28 passed, 0 failed. 실제 DB 전체 출력은 사용자 터미널에만 있음)
4. 그 뒤 anon 키로 실제 DB를 읽기만 해서 확인:
```
predictions 테스트 날짜 행 */0
prediction_counts 테스트 날짜 행 */0
prediction_events 테스트 날짜 행 */0
prediction_close 테스트 날짜 행 */0
app_state {"rev":382,"saved_at":"2026-11-12T01:42:17.602166+00:00"}
11/18 집계 행 */0
```
- 검증용 테스트 날짜(2000·2099년) 행은 남지 않았고, app_state는 11/12 저장본 그대로(검증이 쓰지 않음). 11/18 실제 제출은 아직 0건
- 확인 못 한 것: 실제 DB에서 Realtime 반영(회원 제출이 들어온 뒤 휴대폰 2대로)

## 27. 예측 제출 전 이름 확인 창 (사용자 요청, 브랜치 feat/daebles-name-confirm, 2026-11-16)
로그인이 없어서 이름을 잘못 고르면 다른 사람 예측을 덮어쓰므로, 제출하기를 누르면 아래에서 확인 창이 올라옴: "이 이름으로 제출할까요?", 이름(크게)·조, 경고 문구, 방식, 고른 4경기(조 순서). [이름이 달라요] [네, ○○(으)로 제출].
```
$ node logic.test.js | tail -1
114 passed
$ node deploy.test.js | tail -1
22 passed
```
화면 확인(MOCK_DEMO, 11/18):
| 확인 | 결과 |
|---|---|
| 제출하기 누름 | 확인 창 열림, '네' 버튼에 초점, 서버 집계 합 68 그대로(아직 안 보냄) |
| 이름이 달라요 | 창 닫힘, 고른 4경기 유지, 초점이 이름 칸(me-select)으로, 집계 68 그대로 |
| 어두운 바깥 누름 | 창 닫힘 |
| 네, 유성준(으)로 제출 | "제출했어요. 마감 전까지 고칠 수 있어요.", 내 예측 카드 "내 예측 · 유성준" |
| 헤드리스 Chrome 390×844 | 확인 창이 한 화면에 들어감, scrollWidth 390 |

## 28. 주식 용어 빼고 쉬운 말로 (사용자 요청, 브랜치 feat/daebles-plain-words, 2026-11-16)
| 전 | 후 |
|---|---|
| 체결 / 매수(빨강) | 방금 들어온 예측 / 선택(남색) |
| 배너 칩 "장 마감" | "예측 마감" |
| 장 마감 리포트 제목 "돼블스플랜 장 마감" | "돼블스플랜 예측 결과" |
| 📈 오늘의 상한가 "가장 많이 걸렸고 기대대로 승리" | 👍 인기 팀 승리 "가장 많이 골랐고 예상대로 이겼어요" |
| 📉 폭락주 "N명이 함께 날렸습니다" | 😱 인기 팀 패배 "N명이 함께 틀렸어요" |
| 💰 이번 주 수익 | 🏅 이번 주 보너스 |
`역배 적중`·`역배 후보`·`인기 픽`은 주식 용어가 아니라 그대로 둠.
```
$ node deploy.test.js   (app.js 화면 문구 주식 용어 금지 테스트 먼저)
  FAIL app.js 화면 문구에 주식 용어를 쓰지 않음 (사용자 요청 2026-11-16, 주석은 제외)
       남은 주식 용어: 체결, 매수, 장 마감, 상한가, 폭락, 수익
22 passed
$ node deploy.test.js   (바꾼 뒤)
23 passed
$ node logic.test.js | tail -1
114 passed
```
화면 확인(MOCK_DEMO, 헤드리스 Chrome 390px): "방금 들어온 예측", 배너 "예측 마감", 결과 카드 "돼블스플랜 / 예측 결과", scrollWidth 390.

## 29. 내 기록에 돼블스플랜 보너스 표시 (사용자 문의 "적중했는데 반영이 안 된다", 브랜치 fix/me-bonus-display, 2026-11-19)
원인: 보너스는 순위표에만 계산돼 있었고, 내 기록의 승수 칸은 공식 경기만 보여서(라벨 "누적 공식전") 적중이 반영 안 된 것처럼 보였음. 조 내 순위는 이미 보너스를 더한 값이었음. 공식 경기 없이 예측 보너스만 있는 사람은 순위가 "–"로 나오고 조 인원 수에서도 빠졌음.
| 전 | 후 |
|---|---|
| "2승 0패 / 누적 공식전" (보너스 +3 있어도) | "5승 0패 / 공식 2승 · 보너스 +3" |
| 보너스만 있는 사람: 순위 "–", 배너 "기록 대기" | 순위·배너에 조 내 순위 표시, 조 인원에 포함 |
| 보너스 0 | 기존 표시 그대로 ("누적 공식전") |
```
$ node logic.test.js   (meRecord 테스트 5개 먼저)
  FAIL meRecord: 보너스가 없으면 공식전만 (기존 표시 그대로)
  FAIL meRecord: 보너스 +3이면 합계 승수와 내역을 같이
  FAIL meRecord: 하이리스크 실패 -2로 합계가 음수여도 그대로 보여 줌 (순위표와 같은 − 기호)
  FAIL meRecord: 공식 경기 없이 예측 보너스만 있어도 기록 있음
  FAIL meRecord: 행이 없거나 아무 기록도 없으면 has=false
114 passed
$ node logic.test.js | tail -1   (구현 뒤)
119 passed
$ node deploy.test.js | tail -1
23 passed
```
화면 확인(MOCK_DEMO, MOCK_NOW=2026-11-19T09:40+09:00, 헤드리스 Chrome 360·390px):
| 경우 | 순위표 보너스 | 내 기록 |
|---|---|---|
| 김건율 | +1 | "3위 / 조 내 순위 / 10명", "4승 3패 / 공식 3승 · 보너스 +1" |
| 최신웅 (하이리스크 실패) | −2 | "7위", "2승 2패 / 공식 4승 · 보너스 −2 · 결과 미입력 2" |
가로 넘침 없음(360·390). 360px에서 "보너스 −2"가 줄 중간에서 끊기던 것을 조각별 줄바꿈 금지(`.stat span .nw`)로 고침.

## 30. 순위표 열을 총합·승·보너스·패로 (사용자 요청, 같은 브랜치 fix/me-bonus-display, 2026-11-19)
순위는 이미 총합(공식 승 + 보너스) 기준인데 표에는 총합이 없어서, 승 3인 사람이 승 4인 사람과 같은 3위로 보이는 등 순위 근거가 안 보였음.
| 전 | 후 |
|---|---|
| 순위 · 이름 · 승(굵게) · 보너스 · 패 · 승률 | 순위 · 이름 · **총합**(굵게) · 승 · 보너스 · 패 |
| 메달: 승 > 0일 때 | 메달: 총합 > 0일 때 |
| "승수 = 공식 경기 + 돼블스플랜 보너스" | "총합 = 승(공식 경기) + 돼블스플랜 보너스 · 순위는 총합 기준" |
승률은 순위에 쓰이지 않아서 뺌(좁은 화면에서 열 하나를 비우려고).
```
$ node deploy.test.js   (열 순서 테스트 먼저)
  FAIL 순위표 열: 순위·이름·총합·승·보너스·패 (사용자 요청 2026-11-19, 순위 기준인 총합을 맨 앞에)
23 passed
$ node deploy.test.js | tail -1   (바꾼 뒤)
24 passed
$ node logic.test.js | tail -1
119 passed
```
화면 확인(MOCK_DEMO, 360·390px): 머리줄 ["순위","이름","총합","승","보너스","패"], 넘친 칸 0, 가로 넘침 없음. 김건율 "4 | 3 | +1 | 3", 김성곤 "4 | 4 | – | 4"로 같은 3위인 이유가 보임. 처음 열 폭(44/36/44/36px)에서는 "보너스" 머리글이 두 줄로 꺾여서 48px + 줄바꿈 금지로 고침.

## 31. 내 기록 카드: 총합을 크게, 내역을 "공식 승 + 예측 승 | 패"로 나눔 (사용자 요청, 같은 브랜치 fix/me-bonus-display, 2026-11-19)
29번에서는 "4승 3패 / 공식 3승 · 보너스 +1"처럼 한 줄 글로 보여서 예측으로 얻은 승과 패가 눈에 잘 안 들어옴.
| 전 | 후 |
|---|---|
| 큰 숫자 "4승 3패", 아래 작은 글 "공식 3승 · 보너스 +1" | 큰 숫자 "4승 / 총합 · 순위 기준" |
| 예측 적중 횟수 안 보임 | 띠: 공식 승 3 **+** 예측 승 +1(초록, 적중 1 · 실패 0) **│** 패 3 |
| − 보너스도 같은 색 | 예측 승이 −면 빨강, 0이면 기본색 |
- `meRecord`가 문자열 대신 `{ has, total, wins, losses, bonus }`를 돌려줌(화면 문구는 app.js에서 만듦).
- `predictionRecord(state, predictions, pid)` 추가: 공개된 주만 세서 `{ hit, miss, pending, bonus }`. bonus는 `bonusByPlayer`와 같은 값(테스트로 확인).
```
$ node logic.test.js   (테스트 먼저 바꾼 뒤)
  FAIL meRecord ... / FAIL predictionRecord ...   (6 FAIL)
$ node logic.test.js | tail -1   (구현 뒤)
120 passed
$ node deploy.test.js | tail -1
24 passed
```
화면 확인(MOCK_DEMO, MOCK_NOW=2026-11-19T09:40+09:00, 헤드리스 Chrome 360·390px), 가로 넘침 없음, 넘친 칸 0:
| 경우 | 큰 숫자 | 띠 |
|---|---|---|
| 김건율 | 3위 · 4승 | 공식 승 3 + 예측 승 +1(적중 1 · 실패 0) │ 패 3 |
| 최신웅 (하이리스크 실패) | 7위 · 2승 | 공식 승 4 + 예측 승 −2(적중 0 · 실패 1) │ 패 2 |
| 박강호 (예측 안 함) | 1위 · 5승 | 공식 승 5 + 예측 승 0 │ 패 1 (적중 줄 없음) |
사진: docs/screenshots/me-split/after_360.jpg

## 32. 다승왕권 배지: 왕관 빼고 안쪽 여백 넓힘 (사용자 요청, 브랜치 fix/king-chip, 2026-11-19)
순위표 이름 칸이 좁아서(360px에서 약 104px) 배지 안의 왕관(♛)이 글자 위로 꺾여 올라가 이상하게 보였음.
| 전 | 후 |
|---|---|
| `::before`로 왕관 ♛ + 여백 1px 7px | 왕관 없음, 여백 3px 10px |
| 이름 옆에 붙은 채 왕관만 윗줄로 꺾임 (42×36px) | 배지가 통째로 이름 아래 줄로 내려감 (62×25px) |
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 다승왕권 배지: 왕관 없음 + 안쪽 여백 넓힘 (사용자 요청 2026-11-19)
24 passed
$ node deploy.test.js | tail -1   (바꾼 뒤)
25 passed
$ node logic.test.js | tail -1
120 passed
```
화면 확인(MOCK_DEMO, 360px, 돼지갈비·닭갈비조 김진호): 전 `::before` "♛", 후 `none`·padding 3px 10px. 가로 넘침 없음, 넘친 칸 0.
사진: (33번으로 대체되어 삭제)

## 33. 다승왕권·동률 추첨: 글자 배지 빼고 왕관 아이콘만 (사용자 요청, 같은 브랜치 fix/king-chip, 2026-11-20)
32번(여백 넓힘)을 대신함. "다 아니까 글자는 빼고 왕관 하나만" — 순위표 이름 옆과 내 기록 안내 문장의 배지를 금색 왕관 SVG(18px)로 바꿈.
- 왕관에는 `role="img"` + `aria-label`(다승왕권 / 동률 추첨)을 붙여 화면 읽기 프로그램에서는 구분되게 함.
- `.chip.king`·`.chip.lot`은 다른 곳(돼블스플랜 마감 상태, 대진 "바뀜", 결과 "왼쪽/오른쪽 승")에서도 써서 스타일은 main 그대로 둠. 처음엔 지웠다가 grep으로 3곳 더 쓰는 걸 보고 되돌림 → 테스트에 "배지 스타일 유지" 조건 추가.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 다승왕권·동률 추첨: 글자 배지 없이 왕관 아이콘만 (사용자 요청 2026-11-20)
24 passed
$ node deploy.test.js | tail -1   (바꾼 뒤)
25 passed
$ node logic.test.js | tail -1
120 passed
```
화면 확인(MOCK_DEMO, 360·390px, 세 조 모두): 전 배지 글자 2개씩 → 후 배지 0개, 왕관 2개씩(18px, 라벨 다승왕권/동률 추첨). 가로 넘침 없음, 넘친 칸 0.
사진: docs/screenshots/crown/before_after_360.jpg

## 34. "결과 미입력" → 경기날 17:30 이후에만 "결과 대기" (사용자 요청, 같은 브랜치 fix/king-chip, 2026-11-20)
공개된 다음 주 대진도 결과가 없다는 이유로 "결과 미입력 2경기"로 보였음. 아직 안 한 경기를 미입력이라 부르면 안 됨.
| | 그 날 17:30 KST 전 | 17:30 이후 (결과 없음) | 결과 있음 |
|---|---|---|---|
| 순위표 이름 아래 | 표시 없음, 참가 주에도 안 셈 | `· 결과 대기 N경기` | 승/패 |
| 이번 주 경기 카드 | `경기 전` (배너 `경기 전`) | `결과 대기` (배너 `결과 0/N`) | `결과 입력됨` |
- `logic.standings(state, { now })`: 결과 없는 경기 중 시작 전은 `upcoming`, 지난 건 `pending`. now를 안 주면 예전처럼 전부 pending(기존 호출·테스트 호환).
- `logic.matchStarted(date, now)`: 시작 시각은 돼블스플랜 마감과 같은 수요일 17:30 KST(`PREDICT.closeUtc`) 하나만 씀.
- 같이 고침: "결과 대기 N경기"가 "결과 / 대기"로 갈라지던 줄바꿈 → 한 덩어리로 다음 줄에 내려감(`.nw`, `keep-all`).
```
$ node logic.test.js   (테스트 먼저)
  FAIL 결과 대기는 그 경기날 17:30(KST) 이후만, 그 전 경기는 upcoming으로 따로
  FAIL matchStarted: 경기날 17:30 KST 경계
120 passed
$ node deploy.test.js   (테스트 먼저)
  FAIL 화면 문구: "결과 미입력" 대신 "결과 대기", 순위 계산에 now 전달
25 passed
$ node logic.test.js | tail -1; node deploy.test.js | tail -1   (바꾼 뒤)
122 passed
26 passed
```
경계 테스트: 10/14 17:29:59 → 시작 전, 17:30:00 → 결과 대기.
화면 확인(MOCK_DEMO, 브라우저 시계 고정, 360·390px):
| 시각 | 11/18 경기 카드 | 배너 | 순위표 (소갈비·양갈비조) |
|---|---|---|---|
| 11/18 15:00 | 경기 전 | 경기 전 ×3조 | 3주·4주·3주·2주 참가, 결과 대기 없음 |
| 11/19 09:40 | 결과 대기 | 결과 0/4·0/8·0/5 | 차승운 "5주 참가 · 결과 대기 2경기" |
가로 넘침 없음, 넘친 칸 0. 사진: docs/screenshots/result-wait/before_after_1730.jpg

## 35. 이번 주 탭: 내 경기 | 전체 + 내 예측 실시간 (사용자 요청, 브랜치 feat/my-matches, 2026-11-20)
수요일 경기 중 불편했던 두 가지: 내 경기만 볼 수 없음, 내 예측이 지금 맞았는지 볼 곳이 이번 주 탭에 없음(돼블스플랜 탭에만 있었음).
- 맨 위 `내 경기 | 전체` 전환. 기본은 **내 경기**(사용자 선택), 마지막 선택은 이 기기에 기억(`ddw-wview`).
  - 내 경기: 내가 뛰는 경기만, 카드 위에 조 이름. 이번 주 경기가 없으면 안내.
  - 이름을 안 고른 기기: 전환 버튼 대신 "내 기록 탭에서 이름을 고르면…" 안내, 전체만.
  - 관리 모드(돼장): 결과 입력 때문에 항상 전체, 전환 버튼 없음.
- `내 예측` 카드(이번 주 탭 위): 픽 4개 ✓✕⏳, `n/4 적중`, 아래 한 줄 — `남은 N경기 다 맞히면 +3승` / `실패 확정 −2승`(안전형 `실패 확정 · 0승`) / `적중 확정 +N승`. 마감 뒤엔 서버의 전원 공개 예측, 마감 전엔 이 기기에 저장한 예측. 마감 전 미제출이면 "돼블스플랜 하러 가기".
- 전체 보기: 내가 고른 경기 머리에 `내 픽 ✓/✕/⏳`, 고른 팀 칸에 테두리.
- 계산은 `logic.livePrediction(pred, week)`(= `scorePrediction` 위에 숫자만) → 순위표 보너스와 같은 기준. 결과 저장 → Realtime → 다시 그리기는 기존 경로 그대로, DB 변경 없음.
```
$ node logic.test.js   (테스트 먼저)
  FAIL livePrediction: 경기 중 내 예측 상태
122 passed
$ node deploy.test.js   (테스트 먼저)
  FAIL 이번 주 탭: 내 경기 | 전체 전환, 기본은 내 경기
26 passed
$ node logic.test.js | tail -1; node deploy.test.js | tail -1   (바꾼 뒤)
123 passed
27 passed
```
화면 확인(MOCK_DEMO, 브라우저 시계 11/18 19:00, 나=서민희 하이리스크, 결과는 화면 확인용으로만 app_state 응답에 넣음):
| 경우 | 내 예측 카드 | 내 경기 | 전체 |
|---|---|---|---|
| 1경기(A)·1경기(C) 결과 | 2/4 적중 · 남은 2경기 다 맞히면 +3승 | 2경기 (C1 WIN, C4 결과 대기) | 17경기, 내 픽 4개(✓⏳⏳✓) |
| + 소갈비 5경기 반대 결과 | 2/4 적중 · 실패 확정 −2승 (빨간 카드) | 2경기 | 내 픽 ✓✕⏳✓ |
| 이름 안 고름 | 없음 | 전환 없음, 안내 문구 | 17경기 |
| 11/18 15:00, 예측 안 함 | "이번 주 예측을 아직 안 했어요" | 2경기 | — |
360·390px 가로 넘침 없음. 처음 캡처에서 내 경기 카드 머리(조 이름 + 슈퍼매치 + 내 픽 + 상태)가 좁아 "결과 입력 됨"이 세 줄로 꺾임 → 조 이름을 카드 맨 위 줄로 빼고 머리줄은 칸째 줄바꿈(nowrap)으로 고친 뒤 다시 확인.
사진: docs/screenshots/my-matches/mine_live_miss_all_360.jpg

## 36. 내 예측 카드: 픽마다 어느 조 몇 경기인지 (사용자 요청, 같은 브랜치 feat/my-matches, 2026-11-20)
팀 이름(박강호·최신웅)만 있어서 어느 조 몇 경기인지 몰랐음 → `● 캐비어·랍스터 1경기 ……… 박강호·최신웅` 한 줄에 하나씩.
- 내 예측 카드 3곳(이번 주 탭, 돼블스플랜 마감 전·후)만. 전원 공개 목록은 그대로(작은 2칸).
- 처음엔 2칸 그대로 위 줄에 조 이름을 넣었는데 360px에서 "돼지갈비·닭갈비 1경기"가 잘림(넘친 칸 1) → 한 줄에 하나(600px 이상은 2칸)로 바꾼 뒤 넘친 칸 0.
- 정렬: 조 순서 → 그 조 안 경기 순서.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 내 예측 카드: 픽마다 어느 조 몇 경기인지 표시
27 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1   (바꾼 뒤)
28 passed
123 passed
```
화면 확인(MOCK_DEMO, 11/18 19:00, 서민희, 이번 주 탭·돼블스플랜 탭 × 360·390px): 라벨 4개 `캐비어·랍스터 1경기 / 소갈비·양갈비 5경기 / 소갈비·양갈비 7경기 / 돼지갈비·닭갈비 1경기`, 잘린 글자 0, 전원 공개 목록 라벨 0, 가로 넘침 없음.
사진: (37번으로 대체되어 삭제)

## 37. 내 예측 카드: 글자 라벨 대신 조 색 테두리 (사용자 요청, 같은 브랜치 feat/my-matches, 2026-11-20)
36번의 "캐비어·랍스터 1경기" 글자 대신 "문구 말고 테두리로 구분" → 2칸 배치로 되돌리고 칸 테두리를 조 색(2px, `--gc`)으로. 결과는 그대로 배경색·아이콘(✓✕⏳).
- 캐비어·랍스터 `#B8403A`, 소갈비·양갈비 `#2E8B57`, 돼지갈비·닭갈비 `#D2648A` (팀 배너·점과 같은 색)
- 내 예측 카드 3곳만, 전원 공개 목록은 그대로
```
$ node deploy.test.js   (테스트 먼저, 36번 테스트를 바꿈)
  FAIL 내 예측 카드: 글자 대신 조 색 테두리로 구분
27 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1   (바꾼 뒤)
28 passed
123 passed
```
(처음 CSS 검사 정규식이 `var(--gc)`만 찾아서 `var(--gc, var(--line-2))`를 못 잡음 → 정규식을 `var(--gc[,)]`로 고침)
화면 확인(MOCK_DEMO, 11/18 19:00, 서민희, 이번 주·돼블스플랜 탭 × 360·390px): 테두리 rgb(184,64,58)·rgb(46,139,87)·rgb(46,139,87)·rgb(210,100,138) 각 2px, 잘린 글자 0, 전원 공개 목록 2px 테두리 0, 가로 넘침 없음.
사진: docs/screenshots/my-matches/pred_border_360.jpg

## 38. 내 예측 카드: 조 점 → 조 캐릭터 얼굴 아이콘 (사용자 요청, 같은 브랜치 feat/my-matches, 2026-11-20)
이름 옆 점(조 색)이 경기 카드의 점(지옥도·천국도)과 뜻이 달라 헷갈림 → 점 대신 조 캐릭터 얼굴(24px). 테두리 조 색은 그대로.
- 원본 캐릭터는 몸·라켓까지 있어 24px에선 안 보임 → 사용자가 다른 AI로 얼굴만 다시 그린 256px 투명 PNG 6개를 받음(`docs/ref/faces/`, AI 생성물). 내가 한 일은 원본 6개 추출·요청 프롬프트 작성, 넣기.
- `tools/make_faces.py`: 72px WebP base64로 줄여 `images.css`에 `--face-cv/lb/bf/lm/pk/ck` (각 2.9~4.0KB, dist 397KB). 다시 돌려도 중복 없음.
- 조 → 얼굴: `GROUP_FACE = { A: 'lb', B: 'bf', C: 'pk' }` (랍스터·소·돼지, 소/양 중 24px에서 더 잘 구분되는 소). 6개 다 넣어 둬서 표만 바꾸면 됨.
- 얼굴에 `role="img"` + `aria-label`(조 이름).
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 내 예측 카드: 점 대신 조 캐릭터 얼굴 아이콘
28 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1   (바꾼 뒤)
29 passed
123 passed
```
화면 확인에서 잡은 것 2개:
1. 얼굴이 18px로 나옴 → 결과 아이콘용 `.pk i { width: 18px }`이 이김 → `.pk i.face { width: 24px }`.
2. 24px로 고치니 360px에서 이름 4개 다 말줄임 → 칸 안쪽 여백 8→6px, 결과 아이콘 18→14px, 간격 6→4px로 줄인 뒤 잘린 글자 0.
최종(MOCK_DEMO, 11/18 19:00, 서민희, 이번 주·돼블스플랜 탭 × 360·390px): 얼굴 4개 24px·그림 있음, 점 0, 잘린 글자 0, 가로 넘침 없음.
사진: docs/screenshots/my-matches/pred_face_360.jpg

## 39. 경기 진행: 코트 3칸 + 자리 비움(늦음·레슨·오늘 못 함) + 회원 실시간 (사용자 요청, 브랜치 feat/live-courts, 2026-11-20)
요청: 늦게 오거나 레슨(보통 30분)으로 잠시 빠지는 사람, 완료 경기는 아래로, 진행 중인 선수를 고려해 지금 할 수 있는 경기만 → 돼장이 편하게 다음 경기를 고르게.
사용자 결정: 코트 번호 대신 가운데 빈 코트 3칸에 경기를 넣고 → 끝나면 승패 입력 → 아래 남은 경기 / 자리 비움은 **본인도 앱에서** / 회원 화면에도 진행 중·다음 차례 / 바로 가능은 **오래 기다린 사람 우선**.
- **돼장(관리 모드, 이번 주 탭)**: `경기 진행 | 결과 표` (경기날은 경기 진행이 먼저). 코트 3칸 → 지금 못 하는 사람(+ 추가: 늦음 / 레슨 30분 / 오늘 못 함, × 로 해제) → 바로 가능(오래 기다린 순, `코트 N에 넣기`) → 지금 못 함(흐리게, 이유: "OOO 코트 2 경기 중", "OOO 잠시 빠짐 ~19:10") → 완료(접힘).
  - 코트 넣기·이김·빼기는 **누르는 즉시 저장**(저장 중에 또 누르면 끝난 뒤 한 번 더). 결과 고치기는 결과 표에서.
  - 드래그는 안 넣음: 휴대폰에서 끌기가 불편하고 버튼 한 번이 더 빠름. 넣을 코트는 비어 있는 가장 앞 코트.
- **회원**: 오늘 경기날이면 이번 주 탭 위에 지금 코트 3칸, 내 경기 보기에 내 차례 카드(코트 N에서 경기 중 / 곧 내 차례(바로 가능 3번째 안) / 대기 N번째 / 지금은 못 해요 + 이유) + `늦어요` `레슨 30분 빠져요` / `왔어요 · 다시 가능`.
- **logic.js**: `liveBoard(week, avail, now)`(코트·바로 가능·못 함·완료·자리 비움), `startMatch/finishMatch/cancelMatch`, `myLive`. 기다린 시간 = 그날 마지막 경기 끝난 뒤(아직 안 했으면 17:30부터) 분, 정렬은 4명 합, 화면에는 가장 오래 기다린 사람 분. 레슨(away)은 복귀 시각이 지나면 자동으로 풀림, 늦음·오늘 못 함은 해제할 때까지.
- **DB(schema.sql, SQL Editor에서 다시 실행 필요)**: `availability` 테이블(읽기만 공개), `set_availability`(회원: 경기날 당일·그 주 참석자·late/away/here만, 돼장이 넣은 out은 못 바꿈), `admin_set_availability`(토큰), Realtime에 `availability`·**`app_state`** 등록.
  - 이름 확인이 없어서 남의 이름으로 눌러도 막을 수는 없음 → 누가 넣었는지(본인/돼장)와 시각을 남기고 돼장 화면에 "본인" 표시.
- **정정**: 35번에 "결과 저장 → Realtime → 다시 그리기는 기존 경로"라고 썼는데 틀림. app_state 구독이 없었음(오답 노트 21). 이번에 `remote.watchLive`(app_state + availability 구독)와 Realtime이 안 될 때 20초 다시 읽기를 넣음. 돼장 기기에 저장 안 한 변경이 있으면 받아 온 상태로 덮어쓰지 않음.
```
$ node logic.test.js   (테스트 먼저)
  FAIL liveBoard ×4, startMatch/finishMatch/cancelMatch, nextUp(myLive)   (6 FAIL)
123 passed
$ node deploy.test.js   (테스트 먼저)
  FAIL schema.sql 경기 진행 … / FAIL api 경기 진행 …
29 passed
$ node logic.test.js | tail -1; node deploy.test.js | tail -1   (바꾼 뒤)
129 passed
32 passed
```
(화면 연결 테스트 1개와 `longest` 검사는 구현 뒤에 추가함)
화면 확인(MOCK_DEMO, 서버·브라우저 시계 11/18 18:40, 서민희 레슨 30분·임현수 늦음으로 시작, 360·390px):
| 단계 | 결과 |
|---|---|
| 처음 | 코트 3칸 빈, 지금 못 하는 사람 2(본인), 바로 가능 13 (최대 70분 기다림), 못 함 4 |
| 코트 넣기 2번 | 코트1 캐비어·랍스터 1경기, 코트2 소갈비·양갈비 1경기 → 바로 가능 5, 못 함 10 ("이제영 코트 1 경기 중" 등) |
| 15분 뒤 코트1 이김 | 코트1 비움, 완료 1, 바로 가능 8 (최대 85분) |
| + 추가 → 유성준 레슨 30분 | 지금 못 하는 사람 3, 유성준 경기 2개가 못 함으로 |
| 가짜 서버 | rev 4(저장 3번), 코트 `d1118B1@2`, 완료 `d1118A1:a` + endedAt |
| 회원(코트에 있는 사람) | 지금 코트 표시, "코트 2에서 경기 중", 버튼 없음 |
| 회원(서민희, 레슨 중) | "지금은 내 경기를 못 해요 / 내 상태: 잠시 빠짐 ~19:10 / 왔어요" → 왔어요 → "곧 내 차례예요 · 3번째" → 레슨 30분 → 다시 못 함 |
가로 넘침 없음(360·390). 실제 DB의 Realtime·RPC는 SQL 실행 전이라 못 봄.
사진: docs/screenshots/live-courts/admin_member_360.jpg

## 40. 진행 PIN: 경기 진행만 하는 도우미 (사용자 요청, 같은 브랜치 feat/live-courts, 2026-11-20)
돼장 말고 몇 명에게 매칭 관리 권한 → 두 방법(진행 PIN 하나 / 도우미마다 개인 코드) 중 사용자가 **진행 PIN 하나**로 결정.
- 돼장이 설정 > 진행 PIN에서 4자리를 정함(관리 PIN과 같으면 거절, 관리 PIN을 진행 PIN과 같게 바꿔도 거절). `진행 PIN 끄기`·바꾸기 → 도우미 로그인 모두 끊김.
- 도우미는 관리 탭의 같은 PIN 칸에 입력(관리 PIN이 아니면 진행 PIN으로 확인) → 이번 주 탭 **경기 진행만**(결과 표·편성·예측·설정 없음). 로그인은 다음 새벽 4시까지(경기날 하루만으로 정함, 사용자 확인 전 기본값).
- **보안은 서버에서**: `admin_session.role`(admin/operator), `admin_check`는 role='admin'만 → 도우미 토큰으로 `save_state`·예측 관리·PIN 변경 불가. 진행 동작은 새 RPC `live_action(token, week, match, start|finish|cancel, court, side)` 하나로, 서버가 app_state 행을 잠그고 **그 경기 하나만** 바꾼 뒤 rev+1.
- 덤: 돼장 기기도 코트 동작은 live_action을 씀(전체 저장 X) → 돼장·도우미가 동시에 눌러도 서로 덮어쓰지 않고, 같은 코트를 동시에 누르면 늦은 쪽이 "그 코트는 방금 다른 기기에서 찼어요" 후 다시 읽음. 돼장 기기에 저장 안 한 변경이 있으면 받아 온 상태 위에 같은 동작만 다시 적용.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL schema.sql 진행 PIN … / FAIL api 진행 PIN … / FAIL 진행 도우미 … / FAIL 경기 진행 화면(바로 저장을 live_action으로 바꿈)
31 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1   (바꾼 뒤)
35 passed
129 passed
```
(자리 비움 테스트의 "admin_set_availability는 admin_check" 조건을 live_check로 바꿈 — 요구가 바뀌어서)
가짜 서버 흐름(11/18 18:40, 360px):
| 단계 | 결과 |
|---|---|
| 돼장: 진행 PIN을 1234(관리 PIN)로 | "관리 PIN과 다른 번호로 정해 주세요." |
| 돼장: 5678 | "진행 PIN을 정했어요." |
| 도우미: 0000 | "PIN이 맞지 않아요." |
| 도우미: 5678 | 이번 주 탭으로, 결과 표 전환 없음, 코트 3·넣기 버튼 17·결과 표 버튼 0. 토큰 role=operator, 만료 11/19 04:00 KST |
| 서버에 도우미 토큰 | admin_check false, save_state unauthorized, live_check "operator" |
| 돼장이 코트1에 넣은 직후 도우미도 코트1에 다른 경기 | "그 코트는 방금 다른 기기에서 찼어요." → 다시 읽어 코트1에 돼장 경기 |
| 도우미 넣기·이김 | 성공, 서버 rev 4 |
| 돼장이 진행 PIN 끄기 | 도우미 토큰 live_check null, 도우미가 누르면 "로그인이 만료됐어요" |
실제 DB(plpgsql live_action)는 SQL 실행 전이라 못 봄. 가짜 서버는 logic.js 함수로 같은 규칙을 흉내 냄.
사진: docs/screenshots/live-courts/operator_pin_360.jpg

## 41. 진행 도우미 로그인: 새벽 4시 만료 → 계속 유지 (사용자 결정, 같은 브랜치 feat/live-courts, 2026-11-20)
40번에서 기본값으로 둔 "다음 새벽 4시까지"를 사용자가 "계속 유지"로 정함 → 돼장처럼 기기에 남기되 365일(`OP_DAYS`, schema `interval '365 days'`). 끊는 방법은 돼장이 진행 PIN을 바꾸거나 끄기(도우미 세션 전부 삭제)·도우미 기기에서 잠그기.
```
$ node deploy.test.js   (테스트 먼저: 만료를 365일로 바꾸고 새벽 4시 계산 테스트 삭제)
  FAIL schema.sql 진행 PIN … / FAIL api 진행 PIN …
33 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1
35 passed
129 passed
```
가짜 서버: 도우미 로그인 토큰 role=operator, 만료 2027-11-18(1년 뒤), 안내 "이 기기에서 계속 유지돼요". 진행 PIN 끄면 live_check null → 도우미가 누르면 "로그인이 만료됐어요".

## 42. 머지 전 시험용: Windows에서 더블클릭으로 가짜 서버 (사용자 요청, 같은 브랜치 feat/live-courts, 2026-11-22)
- `tools/preview.cmd`: 빌드 → `MOCK_DEMO=1 MOCK_TODAY=1 PORT=8791`로 가짜 서버 → 브라우저 열기. Node.js 없으면 안내 후 멈춤.
- `MOCK_TODAY=1`: 가짜 데이터의 마지막 주(11/18)를 오늘 날짜로 옮김 → 수요일이 아니어도 경기날 화면(경기 진행·자리 비움·내 차례)을 시험.
- `/config.js`가 접속한 주소(Host)를 그대로 씀 → 같은 와이파이 휴대폰에서 `http://PC-IP:8791`로 열어도 가짜 서버로 붙음(전엔 localhost로 고정이라 휴대폰에선 안 됨).
확인(이 컨테이너): `MOCK_TODAY=1`로 띄우면 주 목록 끝이 오늘(2026-11-22), 돼장 로그인 시 `경기 진행*`·코트 3·넣기 버튼 17. `Host: 192.168.0.5:8791`로 config.js 요청 → url이 그 주소.
Windows에서 실제 더블클릭은 못 해 봄(사용자 PC).

## 43. 경기·예측 화면: 이름만(성 빼고)·크게·가운데, 조는 얼굴 아이콘, "N경기" 빼기 (사용자 요청, 같은 브랜치 feat/live-courts, 2026-11-22)
가짜 서버로 직접 본 뒤 요청: 성+이름 대신 "지섭·성준"처럼 이름만, 글씨 키우고 가운데, 순위표의 성+이름은 그대로, 예측도 아이콘+이름, 초록·빨강 점 대신 아이콘, "1경기·5경기" 필요 없음. (38번에서 얼굴 아이콘을 내 예측 카드에만 넣고 나머지는 점·조 이름을 그대로 둔 게 요청과 어긋났음)
- `logic.shortNames(players)`: 첫 글자(성) 빼고, 두 글자 이름은 그대로, 짧은 이름이 겹치면 그 사람들은 성까지(예: 유성준·이성준). 복성은 구분 안 함.
- 이름만: 경기 진행(코트·바로 가능·못 함·완료), 회원 지금 코트, 이번 주 경기 카드, 예측 화면 전부(`teamText`). 순위표·내 기록 제목·관리 명단은 전체 이름 그대로.
- 조 표시: 경기 진행·지금 코트·내 경기 카드·예측 칸(전원 공개 포함)·인기 픽 제목·예측 확인 목록에서 "조 이름 N경기" 대신 얼굴 아이콘(`gface`). 남은 조 라벨(내 기록 "OO조", 관리 화면)도 CSS로 점 → 얼굴. 이번 주 '전체' 보기의 조별 "N경기" 번호는 돼장이 경기를 부를 때 쓰여서 남김.
- 경기 진행 줄: 얼굴 왼쪽 위, 이름 18px 가운데, 넣기 버튼은 아래 넓게. 코트의 팀 버튼도 이름 가운데·18px.
```
$ node logic.test.js / deploy.test.js   (테스트 먼저)
  FAIL shortNames … / FAIL 경기·예측 화면: 이름만…
129 passed / 35 passed
$ (바꾼 뒤)
130 passed
36 passed
```
화면 확인(MOCK_DEMO·MOCK_TODAY, 360·390px): 돼장 경기 진행 얼굴 17·점 0·잘린 글자 0("민희·인규 vs 연욱·영승"), 회원 이번 주 얼굴 9·점 0, 돼블스플랜 탭 얼굴 65·점 0, 가로 넘침 없음.
사진: docs/screenshots/live-courts/short_names_faces_360.jpg

## 44. 내 예측에 진행 코트 · 이름은 내 예측만 짧게 · 가운데 정렬 · 모래시계 빼기 (사용자 요청, 같은 브랜치 feat/live-courts, 2026-11-22)
43번을 보고 다시 정함: (1) 내 예측 칸에 그 경기가 몇 코트에서 진행 중인지 실시간으로, (2) **내 예측 말고는 성까지 다 쓰고 가운데 정렬**, (3) 모래시계(대기 표시) 빼기.
- 내 예측 칸: 경기가 코트에 있으면 오른쪽에 `코트 N`(분홍 배지)·칸 배경 분홍, 화면 읽기는 "코트 N 경기 중". 돼장·도우미가 넣으면 app_state Realtime(가짜 서버는 20초 다시 읽기)으로 바뀜.
- 짧은 이름(`shortNames`)은 내 예측 카드(`pickCells` grp)에서만. 경기 카드·경기 진행·지금 코트·전원 공개 예측·인기 픽은 다시 성까지.
- 경기 카드 팀 칸: 이름 가운데, WIN·패·승리 기록은 오른쪽에 고정(`position: absolute`, 좌우 여백 64px). 전원 공개 예측 칸도 가운데.
- `PK_ICON.pending = ''`: 대기 칸은 아이콘 없이(빈 `<i>`도 안 만듦). `내 픽` 칩도 "내 픽"만.
```
$ node deploy.test.js   (테스트 먼저: 43번 테스트를 새 요구로 바꿈)
  FAIL 이름: 내 예측 카드만 이름만, 나머지는 성까지·가운데 / … / 모래시계 없음 / 내 예측에 진행 코트
35 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1
36 passed
130 passed
```
가짜 서버(MOCK_TODAY, 서민희 하이리스크): 돼장이 픽 2번째 경기를 코트 2, 1번째를 코트 3에 넣고 결과 → 내 예측 `✓ 강호·신웅 | 현수·청섭 코트 2 | 예슬·우성 | 민희·인규`, "남은 3경기 다 맞히면 +3승", 경기 카드 "서민희·조인규 / 양연욱·이영승" 가운데. 360·390px 잘린 글자 0, 가로 넘침 없음. 돼장 경기 진행 "서민희·조인규 vs 양연욱·이영승".
사진: docs/screenshots/live-courts/my_pred_court_360.jpg (45번에서 새 화면으로 바뀜)

## 45. 내 예측: ✓ 오른쪽·코트 배지 빼고 맨 위 코트에 '내 픽'·내 경기 먼저 (사용자 요청, 같은 브랜치 feat/live-courts, 2026-11-22)
44번을 보고: 적중 체크는 오른쪽, 내가 예측한 경기가 진행 중이면 맨 위 '지금 코트'에 표시, 내 예측과 내 경기 순서 바꾸기, 내 예측 칸의 `코트 N` 배지는 빼기.
- 예측 칸: 얼굴 → 이름 → ✓·✕(오른쪽 끝). 코트 배지·분홍 배경 없앰.
- 지금 코트: 내가 예측한 경기면 `내 픽` 칩 + 칸 연분홍 + 내가 고른 팀 이름 분홍 밑줄.
- 내 경기 보기 순서: 지금 코트 → 내 차례 → **내 경기 → 내 예측**. 전체 보기는 내 예측 → 전체 경기 그대로.
```
$ node deploy.test.js   (테스트 먼저: 코트 배지 없음·✓ 오른쪽·지금 코트 내 픽·내 경기 먼저)
  FAIL 이름: …
35 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1
36 passed
130 passed
```
가짜 서버(서민희, 픽 2번째 경기를 코트 2에): 지금 코트 "코트 2 내 픽 김혜선·전철민 vs 임현수·염청섭"(고른 팀 강조), 순서 my-matches → my-pred, 예측 칸 "강호·신웅 ✓ / 현수·청섭 / 예슬·우성 / 민희·인규". 360·390px 잘린 글자 0, 넘침 없음.
사진: docs/screenshots/live-courts/my_pred_court_360.jpg (44번 사진을 바꿈)

## 46. 회원 '내 차례' 문구 빼기, 늦어요·레슨·왔어요 버튼은 그대로 (사용자 요청, 같은 브랜치 feat/live-courts, 2026-11-22)
"곧 내 차례예요는 일단 빼줘" → 내 차례 카드에서 상태 문구(코트 N에서 경기 중·곧 내 차례예요·대기 N번째·지금은 못 해요·남은 경기 없음)를 모두 빼고, 본인 표시만 남김: 평소 "늦거나 레슨으로 잠시 빠지면 눌러 주세요 + [늦어요] [레슨 30분 빠져요]", 표시 중이면 "내 상태: 잠시 빠짐 ~21:07 + [왔어요 · 다시 가능]"(노란 배경). 경기 중에도 버튼이 보임(전엔 숨김). `logic.myLive`는 남겨 둠(테스트 있음, 화면에서는 안 씀).
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 회원 내 차례 문구는 빼고 늦어요·레슨·왔어요 버튼만
36 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1
37 passed
130 passed
```
가짜 서버(서민희, 360·390px): 처음 버튼 2개 → 레슨 → "내 상태: 잠시 빠짐 ~21:07 / 왔어요" → 왔어요 → 버튼 2개 → 늦어요 → "내 상태: 늦음 / 왔어요". 넘침 없음.

## 47. 레슨: "30분" 문구·자동 복귀 없애기 (사용자 요청, 같은 브랜치 feat/live-courts, 2026-11-22)
- 버튼은 회원·돼장 모두 `레슨` 하나(시간 없이). 표시는 "레슨 중", **`왔어요`(회원)나 `×`(돼장)를 누를 때까지** 유지 — 30분 뒤 자동으로 풀리던 것 없앰.
- schema.sql `set_availability`: 레슨(away)을 시간 없이 받게(`p_minutes is not null and …`일 때만 10~90 검사). 가짜 서버도 같게. `liveBoard`의 until 만료 처리는 시간이 있는 예전 행 대비로 남김.
```
$ node deploy.test.js   (테스트 먼저: data-min·"레슨 30분" 없음, SQL이 시간 없는 레슨 허용)
  FAIL 회원 내 차례 문구는 빼고 늦어요·레슨·왔어요 버튼만
36 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1
37 passed
130 passed
```
가짜 서버: 회원 [레슨] → "내 상태: 레슨 중 / 왔어요" → 왔어요 → 버튼. RPC `set_availability(away, 분 없음)` 200·until null, `away 5분` → bad_minutes.
SQL이 또 바뀜 → 머지 전 schema.sql 다시 실행.

## 48. 실제 DB에 schema.sql 실행 + PR #10 머지·배포 (2026-11-23, 사용자 요청 "이거 너가 안돼?")
- 사용자가 PC Chrome에서 Supabase에 로그인한 뒤, Claude in Chrome으로 SQL Editor에 `feat/live-courts`의 schema.sql을 넣고 실행. 넣은 내용은 GitHub raw를 받아 SHA-256 `668fca5a…80b5`가 커밋된 파일과 같은지 확인한 뒤 실행.
- "파괴적 작업" 경고(기존 `drop table if exists admin_login_guard`, 함수 안 delete) 확인 후 실행. 결과 화면은 Chrome 번역 기능 때문에 대시보드가 멈춰서 못 봄 → 아래 두 방법으로 따로 확인.
- 공개 키로 RPC 확인: `live_check` 200 null, `operator_login` → no_op_pin, `availability` 200 [], `set_availability(2000-01-05)` → not_today, `admin_check(가짜)` false, `live_action(가짜)` → unauthorized, `set_operator_pin(가짜)` → unauthorized. app_state rev 453 그대로(데이터 안 바뀜).
- SQL로 확인: 시간 없는 레슨 허용 true, admin_session.role 열 1, admin_check가 role='admin'만 true, Realtime 테이블 `app_state,availability,prediction_counts,prediction_events`, 새 함수 6개.
- PR #10 머지(#8·#9 포함, 셋 다 merged 표시) → GitHub Actions 성공(0ae2828) → 실제 사이트 HTML에 `live_action`·`shortNames`·`--face-lb` 있음.
- 아직 못 본 것: 실제 사이트에서 휴대폰 여러 대로 진행 PIN·코트·Realtime.

## 49. 코트 번호: 고정 5·6번 + 번호 없는 '추가 코트' (사용자 결정, 브랜치 feat/court-numbers, 2026-11-23)
"5·6번 코트는 고정, 한 코트를 더 쓸 수도 안 쓸 수도" → 처음 만든 코트 1·2·3 순번을 실제 번호로. 추가 코트는 고정이 아니라서 번호 없이 "추가 코트".
- 설정 > **고정 코트 번호**(기본 `5, 6`, 1~99 쉼표, 겹치면 거절) → `settings.courts`.
- 경기 진행: `코트 5`·`코트 6` 늘 보임 + `+ 추가 코트 열기` → `추가 코트` 칸(비어 있으면 `닫기`, 경기 중이면 닫기 없음). 넣기 버튼 "코트 5에 넣기"/"추가 코트에 넣기". 못 함 이유 "이제영 코트 5 경기 중". 회원 지금 코트·경기 카드("진행 중 · 코트 5")도 같은 이름.
- 데이터: `m.court` = 실제 번호, 추가 코트는 0. 그 주에 추가 코트를 열었는지 `week.extraCourt`(돼장·도우미 둘 다 `live_action` extra_open/extra_close로).
- logic.js: `courtSlots(settings, week)`, `courtLabel(no)`, `setExtraCourt(week, on)`, `liveBoard`의 `courts`가 `[{no, m}]`로, `startMatch`는 열린 코트(slots)만. 0을 참/거짓으로 보던 곳(`m.court ?`) 고침.
- schema.sql `live_action`: 설정 코트(없으면 5·6) 또는 추가 코트가 열렸을 때 0만 받음, `extra_open`/`extra_close`(경기 있으면 court_busy).
- **같이 고친 버그(오답 노트 22)**: 선수 겹침 검사 SQL의 `->`/`||` 우선순위 — 실제 DB에 오늘 들어간 #10 버전에서 이 검사가 늘 통과였음.
```
$ node logic.test.js   (테스트 먼저: 코트 테스트를 5·6·추가 코트로 다시 씀)
  FAIL courtSlots … / liveBoard 코트 칸 … / startMatch … / setExtraCourt … / myLive …   (5 FAIL)
127 passed
$ node deploy.test.js   (테스트 먼저)
  FAIL 코트: 고정 5·6번(설정) + 번호 없는 추가 코트 …
37 passed
$ node logic.test.js | tail -1; node deploy.test.js | tail -1
132 passed
38 passed
```
(deploy 테스트의 liveBoard 호출 찾는 정규식이 첫 `)`에서 멈춰 처음에 잘못 FAIL → 정규식 고침)
**로컬 Postgres 16에서 SQL 확인**(처음): main의 schema.sql → 새 schema.sql 차례로 적용 오류 없음, Realtime 테이블 4개. `supabase/tests/live_action.sql`:
| 동작 | 결과 |
|---|---|
| k1 코트 1(고정 아님) | bad_court |
| k1 코트 5 | rev 2 |
| k2 코트 5(찼음) | court_busy |
| k3 코트 6(a가 코트 5에서 경기 중) | **고치기 전 rev 3(통과 = 버그)** → 고친 뒤 player_busy |
| k2 추가 코트(안 열림) | bad_court |
| 추가 코트 열기 → k2 추가 코트 | rev → rev |
| 추가 코트 닫기(경기 중) | court_busy |
| k2 결과 → 추가 코트 닫기 | rev → rev |
| k1 빼기 / 코트 없는 k1 결과 / 없는 동작 | rev / not_on_court / bad_action |
| 설정 3·4번에서 코트 5 / 코트 3 | bad_court / rev |
| admin_check(도우미 토큰 / 돼장 토큰) | false / true |
가짜 서버 화면(360px): 처음 `코트 5 비어 있음 · 코트 6 비어 있음 · + 추가 코트 열기`, 넣기 버튼 "코트 5에 넣기" → 둘 넣으면 "빈 코트 없음" → 추가 코트 열기 → "추가 코트에 넣기" → 빈 추가 코트 닫기 → 다시 열고 넣으면 닫기 버튼 0. 설정 칸 "5, 6", "5, 5" 입력 → 거절 안내. 회원 지금 코트 "코트 5 / 코트 6 / 추가 코트". 넘침 없음.
사진: docs/screenshots/live-courts/court_numbers_360.jpg

## 50. 실제 DB에 코트 번호 SQL 실행 + PR #11 머지·배포 (2026-11-23, 사용자 "진행")
- Claude in Chrome으로 SQL Editor에 `feat/court-numbers`의 schema.sql(SHA-256 `7ed0aef7…660e`, 커밋된 파일과 같음 확인) 실행 → "Success. No rows returned". (이번엔 번역 기능을 끄고 실행해서 결과 화면이 보였음)
- 확인 쿼리: live_action에 extra_open·괄호 고친 선수 겹침 검사·추가 코트(0) 규칙 모두 있음 true, app_state rev 453 그대로.
- PR #11 머지 → GitHub Actions 성공(05cebd2) → 실제 사이트 HTML에 `courtSlots`·"추가 코트 열기"·`court-form` 있음.
- 오답 노트 22의 선수 겹침 검사 버그는 이 시점부터 실제 DB에서 고쳐짐(11/23 09:28~10:0x 사이에는 있었음, 그동안 코트 사용 없음 — 실제 경기는 11/25부터).

## 51. 내 경기 보기 순서: 늦어요·레슨을 내 경기 아래로 (사용자 요청, 브랜치 feat/order-avail, 2026-11-23)
- 내 경기 보기: 지금 코트 → **내 경기 → 늦어요·레슨** → 내 예측. 전체 보기는 지금 코트 → 늦어요·레슨 → 내 예측 → 전체 경기 그대로.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 내 경기 보기 순서: 지금 코트 → 내 경기 → 늦어요·레슨 → 내 예측
38 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1
39 passed
132 passed
```
가짜 서버(코트 5에 한 경기, 서민희, 360·390px): 내 경기 보기 `courts.mini → my-matches → my-live → my-pred`, 전체 `courts.mini → my-live → my-pred → group`. 넘침 없음.

## 52. 코트에 진행 시간·남은 시간 짐작 (사용자 요청, 브랜치 feat/court-eta, 2026-11-23)
"13분 진행 중처럼 언제 끝날지 짐작할 수 있게" → 돼장 코트 칸 오른쪽 위·회원 지금 코트 이름 아래에 `13분째 · 약 3분 남음` / 보통 시간을 넘으면 `21분째 · 곧 끝나요`.
- 보통 시간 = **코트에서 끝난 경기들(startedAt·endedAt 둘 다 있는 것)의 걸린 시간 중앙값**, 시즌 전체. 3분 미만·90분 초과(넣고 결과 누르기를 잊은 경우 등)는 버림, 3경기 미만이면 짐작 안 하고 진행 시간만. 평균 대신 중앙값: 한두 경기가 길게 찍혀도 덜 흔들림.
- 돼장 화면 코트 아래 "경기 시간은 보통 16분이에요 (코트에서 끝난 경기 4개 기준)" / 기록이 모자라면 "3개 이상 모이면 짐작해 보여 줘요".
- 코트에 경기가 있으면 1분마다 다시 그림(`live.minute`).
- 지금 데이터에는 startedAt·endedAt이 하나도 없음 → 11/25 첫날은 처음 3경기가 끝날 때까지 "N분째"만 보임.
```
$ node logic.test.js / deploy.test.js   (테스트 먼저)
  FAIL typicalMinutes … / FAIL courtEta …   |   FAIL 코트에 진행 시간·남은 시간 짐작 …
132 passed / 39 passed
$ (바꾼 뒤)
134 passed
40 passed
```
가짜 서버(브라우저 시계 고정, 코트 5 13분 전·코트 6 21분 전 시작, 끝난 경기 14·16·18·15분): 기록 없음 → "13분째"/"21분째" + 안내, 기록 있음 → "13분째 · 약 3분 남음"/"21분째 · 곧 끝나요", "보통 16분 (4개 기준)", 시계 1분 넘기면 "14분째 · 약 2분 남음". 360px 넘침 없음. 안내 문장이 "기 / 준"으로 꺾여 keep-all 추가.
사진: docs/screenshots/live-courts/court_eta_360.jpg

## 53. 경기 진행: 조 탭으로 나누기 (사용자 요청, 브랜치 feat/live-group-tabs, 2026-11-23)
"가능한 경기를 조마다 탭으로 — 밑으로 다 스크롤해서 찾기 힘듦" → 코트·지금 못 하는 사람 아래에 `전체 N | 🦞 n | 🐮 n | 🐷 n`(조 얼굴 + 그 조의 바로 가능 개수) 탭. 고른 조로 바로 가능·지금 못 함·완료를 모두 거름. 화면을 내려도 탭이 위에 붙어 있음(sticky). 순서는 탭 안에서도 오래 기다린 순.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 경기 진행: 바로 가능·못 함·완료를 조 탭 …
40 passed
$ node deploy.test.js | tail -1; node logic.test.js | tail -1
41 passed
134 passed
```
(테스트가 `inGrp(` 호출 모양만 찾아서 `filter(inGrp)`를 못 잡음 → `var inGrp =`로 고침)
가짜 서버(코트 5·6 찬 상태, 360·390px): 전체 바로 가능 8·못 함 7 / 랍스터 0·3 / 소 3·4 / 돼지 5·0, 각 탭에서 다른 조 얼굴 0, 넘침 없음. 360×700에서 800px 내려도 탭이 화면 맨 위(0px)에 붙음.
사진: docs/screenshots/live-courts/group_tabs_360.jpg

## 54. 웹 푸시: 내 경기가 코트에 들어갈 때 · 내 예측 경기가 시작할 때 (사용자 요청, 브랜치 feat/push, 2026-11-23)
"돼장이 새 경기를 채우면 해당하는 사람에게 푸시 알림" → (가) 선택: 그 경기 4명에게 "코트 5에서 내 경기 시작", 그 경기를 예측한 사람(선수 본인 빼고)에게 "내 예측 경기가 코트 5에서 시작". 본문은 "김성곤·유성준 vs 이제영·박강호", 추가 코트는 "추가 코트".
- 흐름: 회원이 내 기록 탭(또는 경기날 내 경기 화면)에서 "알림 받기" → 이 기기를 내 이름으로 구독(`push_subscribe`). 돼장·도우미가 코트에 넣으면(`live_action start` 성공 뒤) 앱이 Edge Function `notify`를 부르고, 함수가 `push_targets`로 받을 기기를 받아 보냄.
- DB: `push_subs`(기기 주소·키, anon 읽기 권한 없음), `push_log`(같은 경기·같은 시작은 한 번만, 30일 지난 기록 지움). `push_targets`/`push_gone`은 돼장·도우미 토큰(`live_check`)만. 푸시 서버가 404·410을 주면 그 기기 구독을 지움.
- Edge Function `supabase/functions/notify/index.ts`: 라이브러리 없이 WebCrypto로 RFC 8291(aes128gcm)·RFC 8292(VAPID ES256). 서비스 키를 쓰지 않고 요청의 공개 키로 RPC만 부름.
- `config.js`에 `vapidKey`(공개 키)가 비어 있으면 알림 카드가 안 보이고 notify도 안 부름 → 키 넣기 전에 머지해도 지금 앱은 그대로.
- 아이폰: 홈 화면에 추가한 앱(iOS 16.4+)에서만. 안 된 상태면 카드에 안내. 차단한 경우도 안내.
```
$ node --experimental-strip-types push.test.mjs
  ok RFC 8291 부록 A 값과 같게 암호화 (http_ece@1.2.0으로도 같은 값 확인)
  ok Node crypto로 풀면 원문 / VAPID JWT 서명 검증 / 알림 문구 / handle(가짜 fetch: sent 1·gone 1, bad_request, no_vapid)
5 passed
$ node deploy.test.js   (테스트 먼저)
  FAIL schema.sql 웹 푸시 … / FAIL 웹 푸시 화면·API …
41 passed
$ (바꾼 뒤) node deploy.test.js | tail -1; node logic.test.js | tail -1
43 passed
134 passed
```
로컬 Postgres 16 (`supabase/tests/push.sql`, begin…rollback): 구독 4 / 없는 선수·쉬는 선수 bad_player / http 주소 bad_endpoint / anon이 push_subs 읽기 → permission denied / 토큰 없이 unauthorized / 코트에 없는 경기 not_on_court / 코트 5 시작 → a·c·d player, e predictor(d는 선수이면서 예측도 했지만 player로 한 번만) / 다시 부르면 0 / 빼고 다른 시각에 다시 넣으면 4 / push_gone 1 / 해제 뒤 남은 c·d. schema.sql 두 번 넣어도 오류 없음, live_action.sql 결과 그대로(rev 9).
가짜 서버 끝까지(진짜 notify 코드 + 로컬 HTTPS 가짜 푸시 서비스가 구독 개인 키로 풀어 봄): d1118A1 코트 5 → 박강호(player) 1건 "코트 5에서 내 경기 시작", 다시 부르면 sent 0, 틀린 토큰 unauthorized / d1118A2 → player 4 + predictor 6, predictor 문구 "내 예측 경기가 코트 5에서 시작", 410 준 9기기는 gone 9로 지워짐.
화면(390px): 내 기록 탭 "🔔 코트 알림 · 알림 받기", 경기날 내 경기 화면 맨 아래 같은 카드(아직 안 켠 사람만), 차단 상태 안내. 헤드리스 Chromium은 권한을 줘도 Notification.permission이 'denied'라서 찍을 때만 'default'로 덮음.
미리보기(preview.cmd): 띄울 때마다 새 VAPID 키를 메모리에 만들고 진짜 notify 코드를 씀 → Node 22 이상이면 PC Chrome에 진짜 알림이 옴. 휴대폰에서 http://PC주소로 열면 보안 연결이 아니라 알림은 안 됨(카드가 "지원 안 함").
사진: docs/screenshots/push/push_card_390.jpg

### 54-1. 실제 Supabase 반영 (2026-11-23, 머지 전)
- 키: 사용자 PC에 Node가 없어 `npx`가 안 됨(오답 노트 23) → 사용자 요청으로 Claude in Chrome이 사이트 탭에서 WebCrypto로 키 한 쌍을 만들어 화면에만 띄움. Claude는 공개 키만 받음(87자, `config.js`에 넣음). 비밀 키는 화면에서 사용자가 복사해 넣음.
- 사용자가 Edge Functions › Secrets에 `VAPID_PUBLIC_KEY`·`VAPID_PRIVATE_KEY`·`VAPID_SUBJECT` 입력. 대시보드의 SHA-256 다이제스트가 공개 키(`b1bb1f3e…cac5`)·사이트 주소(`603ce997…eb24`)를 직접 계산한 값과 같음. 비밀 키는 값을 몰라 확인 못 함.
- `notify` 배포: 대시보드 편집기에 GitHub raw `feat/push`의 index.ts를 넣고 SHA-256(`0f0baa4f…9fdd`)이 커밋된 파일과 같은지 확인한 뒤 배포. 앱과 같은 헤더(apikey + Bearer 공개 키)로 불러 HTTP 200 → JWT 확인 설정이 켜져 있어도 막히지 않음.
- `schema.sql` 실행: 같은 방법으로 SHA-256(`b824e781…a093`) 확인 → "파괴적 작업" 경고(예전 `drop table if exists admin_login_guard`, 함수 안 delete) 확인 후 실행 → "Success. No rows returned". 첫 시도는 확인 버튼을 누르기 전에 탭 묶음이 사라져 실행 안 됨(`push_targets` 404로 확인) → 사용자 "계속" 후 다시 실행.
- 공개 키로 확인:
```
push_targets(가짜 토큰)      → 400 unauthorized
push_gone(가짜 토큰)         → 400 unauthorized
push_subscribe(없는 선수)    → 400 bad_player
push_subscribe(http 주소)    → 400 bad_endpoint
GET push_subs / push_log     → 401 permission denied
live_check(가짜)             → 200 null
notify(가짜 토큰)            → 200 {ok:false, code:unauthorized}   (실행 전: "Could not find the function public.push_targets")
```
- app_state rev 456 (11/23 오전 확인 때 453, 그 사이 저장분). schema.sql은 맨 위에서 app_state를 바꾸지 않음(update는 함수 안에만).
- 아직 못 본 것: 실제 휴대폰에서 구독 → 코트 넣기 → 알림 도착.

## 55. 알림 받기 카드: 돼장·도우미 기기에서도 보이게 (브랜치 fix/push-card-admin, 2026-11-23)
#15는 돼장·도우미로 로그인한 기기에서 카드를 숨겼음(오답 노트 24). 둘 다 선수라 조건을 뺌.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 알림 받기 카드: 돼장·도우미로 로그인한 기기에서도 보여야 함
43 passed
$ (고친 뒤) node deploy.test.js | tail -1; node logic.test.js | tail -1
44 passed
134 passed
```
가짜 서버(390px, 내 기록 탭, 이름 p001): 돼장 로그인 카드 1·알림 받기 버튼 1 / 도우미 로그인 1·1 / 회원 1·1.

## 56. 알림 켠 뒤 "화면 위에 뜨게 하기" 안내 + 시험 알림 (사용자 요청, 브랜치 feat/push-popup-guide, 2026-11-23)
- 실제 휴대폰 확인(사용자, #16 배포 뒤): 코트에 넣자 알림이 **옴**. 다만 카톡처럼 화면 가운데·위 팝업이 아니라 알림창에만 쌓임.
- 원인: 웹 푸시는 Chrome의 사이트별 알림 채널로 오고, 팝업(헤드업) 여부는 휴대폰 설정이 정함. 웹 페이지가 이 등급을 바꾸는 API는 없음 → 회원마다 처음 한 번 설정 필요. 사용자 선택: 앱 안에서 그 설정까지 안내(1번). 진짜 앱(Play 스토어) 방식은 비용·관리 때문에 안 함.
- 바꾼 것: 알림 받기 성공 → 서비스 워커로 **시험 알림**을 바로 띄움(서버 안 거침, tag `ddw-test`) + 카드에 안내 펼침. 안드로이드: 시험 알림 길게 누르기 → ⚙ 알림 설정 → 팝업으로 표시(그림 포함). 아이폰: 설정 › 알림 › 다승왕전 › 알림 스타일 배너. 켜진 상태에서 "시험 알림 보내기"·"카톡처럼 화면 위에 뜨게 하려면?" 버튼.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 알림 켠 뒤 팝업 설정 안내 …
44 passed
$ (바꾼 뒤) node deploy.test.js | tail -1; node logic.test.js | tail -1
45 passed
134 passed
```
가짜 서버(360px, 구독·showNotification은 흉내): 안드로이드 UA → "이 알림을 길게 눌러 ⚙ › 팝업으로 표시를…" 시험 알림 1건, 아이폰 UA → "설정 › 알림 › 다승왕전에서 배너로…" 1건, 둘 다 가로 넘침 없음. 처음엔 그림 속 알림 제목이 360px에서 "코트 5에…"로 잘려 두 줄 배치로 바꿈.
아직 못 본 것: 실제 휴대폰에서 시험 알림을 길게 눌렀을 때 그 사이트 설정으로 바로 가는지(기종마다 다름).
사진: docs/screenshots/push/popup_guide_360.jpg

## 57. 이번 주 · 내 경기 보기 맨 위에 알림 카드 (사용자 요청, 브랜치 feat/push-card-top, 2026-11-23)
"내 경기 진행 탭 맨 위에 알림 허용 안 돼 있으면 표시" → 내 경기 보기에서 `내 경기 | 전체` 바로 아래(지금 코트·내 경기보다 위)에 알림 카드. 경기날이 아니어도 보임. 보이는 상태: 아직 안 켬 / 아이폰 홈 화면 앱 아님(설치 안내) / 차단됨(허용 방법). 켜짐·지원 안 함·키 없음이면 안 보임. 원래 있던 맨 아래 카드(경기날 + 아직 안 켬)는 두 번 보이지 않게 뺌. 내 기록 탭 카드는 그대로.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 이번 주 · 내 경기 보기 맨 위에 알림 카드 …
45 passed
$ (바꾼 뒤) node deploy.test.js | tail -1; node logic.test.js | tail -1
46 passed
134 passed
```
가짜 서버(360px, 이번 주 탭·내 경기): 아직 안 켬 → 카드 1, 순서 `내 경기|전체 → 알림 카드 → 내 경기` / 켜짐 → 카드 0 / 아이폰 Safari(PushManager 없음) → 카드 1(홈 화면에 추가 안내). 셋 다 가로 넘침 없음.
사진: docs/screenshots/push/card_top_360.jpg

## 58. 내 경기 화면에서 알림을 켜도 팝업 안내가 남게 (사용자 질문 "알림 받기 뒤의 그 안내는?", 브랜치 fix/push-guide-in-mine, 2026-11-23)
#57에서 내 경기 맨 위 카드는 "안 켠 사람만"이라, 거기서 알림 받기를 누르면 카드가 바로 사라져 #56의 팝업 설정 안내를 볼 수 없었음(내 기록 탭에서만 보임). → 켠 직후에는 안내가 펼쳐진 채 그 자리에 남고, **다 했어요**를 누르면 사라짐. 내 기록 탭에도 같은 버튼.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 내 경기 화면에서 알림 받기를 눌러도 팝업 안내가 그 자리에 남고 …
46 passed
$ (바꾼 뒤)
  FAIL 이번 주 · 내 경기 보기 맨 위에 알림 카드 …   ← #57 테스트가 예전 한 줄(`if (mine && pushNeeded())`)을 글자 그대로 찾음
$ (#57 테스트를 `if (mine && (pushNeeded()…`로 넓힘, 위치 검사는 그대로) node deploy.test.js | tail -1; node logic.test.js | tail -1
47 passed
134 passed
```
가짜 서버(390px, 안드로이드 UA, 권한 요청·구독·showNotification 흉내): 알림 받기 → 서버 구독 1건(p001) + 시험 알림 1건 + 카드 1·안내 1 남음, 토스트 "방금 온 시험 알림으로 화면 위 팝업을 켜 주세요" → 다 했어요 → 카드 0.
사진: docs/screenshots/push/mine_flow_390.jpg

## 59. 갤럭시 팝업 안내를 실제로 된 순서로 고침 (브랜치 fix/galaxy-popup-guide, 2026-11-23)
- 실제 기기 확인(사용자 갤럭시, PC에서 조영재 경기 m10382hh를 코트 5에 넣었다 바로 뺌, 15:32·15:35 두 번, 둘 다 notify sent 1·failed 0, 뺀 뒤 court·startedAt null·결과 그대로): 알림은 오지만 헤드업 없음.
- 원인: Chromium `WebApkServiceImplWrapper.java` 원문 — 채널 ID가 HIGH_PRIORITY일 때만 IMPORTANCE_HIGH, 나머지는 IMPORTANCE_DEFAULT. 웹 API로 바꿀 수 없음. 갤럭시는 One UI 6.1부터 알림 카테고리가 숨겨져 앱 단위 "알림 팝업 ✓"만 보였음(오답 노트 25).
- 사용자 갤럭시에서 확인된 순서: 설정 › 알림 › 고급 설정 › 앱별 알림 카테고리 관리 켬 → 다승왕 알림 설정 맨 아래 "알림 카테고리" 생김(항목 "일반" 하나) → "일반" 글자(스위치 아님) → 팝업으로 표시 켬 → **헤드업 뜸**(사용자 "되네").
- 앱 안 안드로이드 안내를 이 5단계로 바꿈(아이폰 안내는 그대로).
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 갤럭시 팝업 안내: 숨은 카테고리 켜기 → 일반 글자 → 팝업으로 표시 …
47 passed
$ (바꾼 뒤) node deploy.test.js | tail -1
48 passed
```
가짜 서버 360px 안드로이드 UA: 5단계 안내·그림 "⚙ › 알림 카테고리 › 일반 / 팝업으로 표시", 가로 넘침 없음.
사진: docs/screenshots/push/galaxy_guide_360.jpg
## 60. 경기 진행: 경기를 누르면 빈 코트 고르기, 이김·빼기는 확인 창 (사용자 요청, 브랜치 feat/court-pick-confirm, 2026-11-23)
"진행 가능한 경기마다 '코트 5에 넣기'가 반복됨 → 경기를 누르면 비어 있는 코트 선택 창, 코트에서 뺄 때·승리 눌렀을 때 확인 창"
- 바로 가능: 줄 전체가 버튼, 오른쪽에 › 하나, 제목에 "누르면 코트 선택". 누르면 아래에서 창이 올라와 **빈 코트마다 큰 버튼**(코트 5·코트 6·추가 코트 중 빈 것)과 취소. 빈 코트가 없으면 줄이 눌리지 않고 "빈 코트 없음".
- 코트 카드의 팀 "이김" → "코트 6 결과를 저장할까요? / ○○·○○ 승 / ○○·○○ 패" → 네, 저장 / 취소.
- "코트에서 빼기" → "코트 6에서 뺄까요? / 결과 없이 코트만 비우고 다시 바로 가능으로" → 네, 빼기 / 취소.
- 창이 떠 있는 사이 다른 기기가 바꿨으면(이미 코트에 있음·끝남·빈 코트 없음) 실행 대신 안내만. 창 모양은 예측 제출 확인 창(pc-sheet)을 그대로 씀.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 경기 진행: 경기를 누르면 빈 코트 고르는 창, 이김·코트에서 빼기는 확인 창을 거침
47 passed
$ (바꾼 뒤) node deploy.test.js | tail -1; node logic.test.js | tail -1
48 passed
134 passed
```
가짜 서버(360px, 돼장 로그인, 추가 코트 열고): 바로 가능 17줄, 목록 안 바로 넣기 버튼 0 / 첫 경기 누름 → 창에 [코트 5, 코트 6, 추가 코트] → 코트 6 → 서버에 court 6 / 이김 → "코트 6 결과를 저장할까요?" → 취소 → 서버 결과 null 그대로 / 코트에서 빼기 → "코트 6에서 뺄까요?" → 네, 빼기 → 서버 court null. 가로 넘침 없음. 처음엔 줄마다 "코트 ›" 알약을 붙였다가 그것도 반복이라 › 하나로 줄임.
사진: docs/screenshots/live-courts/pick_confirm_360.jpg

### 60-1. 확인 창을 화면 가운데로, 확인 버튼을 왼쪽에 (사용자 요청 2026-11-24, 같은 브랜치)
- 경기 진행 창(코트 고르기·이김·빼기)만 화면 가운데 상자로. 예측 제출 확인 창은 그대로 아래에서 올라옴.
- 버튼 순서 [취소][네, 저장] → **[네, 저장][취소]**, [취소][네, 빼기] → **[네, 빼기][취소]**.
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 경기 진행 확인 창: 화면 가운데, 확인 버튼이 왼쪽·취소가 오른쪽
48 passed
$ (바꾼 뒤) node deploy.test.js | tail -1
49 passed
```
가짜 서버 360px 돼장: 같은 흐름 다시 — 코트 고르기 [코트 5, 코트 6, 추가 코트] → 코트 6 / 이김 취소 → 결과 그대로 / 빼기 → 코트 비워짐, 세 창 모두 화면 가운데, 가로 넘침 없음.
사진: docs/screenshots/live-courts/pick_confirm_center_360.jpg
- #20 머지 뒤 이 브랜치가 충돌(deploy.test.js·deploy-log.md 같은 자리에 둘 다 추가). main을 합치며 양쪽을 모두 살렸는데, git이 두 테스트를 공통 `});` 줄 기준으로 갈라서 "화면 가운데" 테스트의 닫는 `});`가 빠짐 → `node deploy.test.js`가 SyntaxError로 멈춰서 발견, 한 줄 복구. 합친 뒤 deploy.test.js 50 passed(#20의 48 + 이 브랜치 2), logic.test.js 134, push.test.mjs 5.

## 61. 뚱뚱배 1차 ① 순수 함수 (브랜치 feat/tourney-logic, 2026-11-24)
- 결정(김형준 2026-11-24): 명세 v2 2장 질문 1~12번 모두 기본값으로 진행 (돼장은 판단 안 함). 12/2 명단 마감, 12/4 대진 공개
- 새 파일 `tourney.js`(뚱뚱배 순수 함수)·`tourney.test.js`. 명세는 logic.js에 넣자고 했지만 logic.js가 이미 960줄이라 따로 둠. 아직 화면에서 쓰지 않음(빌드에 안 들어감) → 머지해도 앱은 그대로
- 함수: roundRobin(원형 순환, 홀수·2바퀴), scheduleMatches(조 코트에만·같은 순서 두 코트 금지·도착 전 금지는 반드시 지킴 / 연속 출전·쉬는 간격·길이는 비용으로, 무작위 탐욕 배치 200번 중 최소), estimateStarts, parseRoster(회원 매칭·게스트·급수·중복), defaultMode(공개일~대회 다음 날)
```
$ node tourney.test.js   (테스트 먼저, tourney.js 없음)
0 passed   (FAIL 17)
$ (구현 뒤) node tourney.test.js | tail -1; node logic.test.js | tail -1; node deploy.test.js | tail -1
17 passed
134 passed
51 passed
```
- 역검증(규칙을 일부러 지운 복사본으로 테스트):
  - 도착 시각 검사 제거 → "늦게 오는 사람" 1개 FAIL
  - 같은 순서 겹침 검사 제거 → 1개 FAIL
  - 연속 출전 경고 제거 → 1개 FAIL / 중복 이름 처리 제거 → 1개 FAIL / defaultMode 다음 날 경계 제거 → 1개 FAIL
  - 3연속 비용만 0 → FAIL 없음(오래 쉰 팀 먼저 규칙이 이미 막음). 연속·3연속·쉬는 간격 비용을 모두 0 → "3연속 없음" FAIL
  - 처음 도착 검사 역검증은 sed 치환 실수로 파일이 깨져 17개 FAIL이 나왔던 것(진짜 결과 아님) → 파이썬으로 다시 지워서 1개 FAIL 확인
- CI에 `node tourney.test.js` 추가. 이를 지키는 deploy.test.js 테스트는 워크플로 변경을 되돌린 상태에서 FAIL 확인

## 62. 클럽 홈 틀 (뚱보단 통합 1단계, 브랜치 feat/club-home, 2026-11-24)
사용자 시안(클럽 홈 → 이벤트 카드 → 이벤트 화면)대로 틀만 바꿈. 다승왕 화면 내용은 그대로.
- 하단 탭: 홈 · 기록 · 내 기록 · 관리 (관리는 로그인 전 PIN 표시)
- 홈: '진행 중'에 다승왕전 카드(시즌 상태, 진행 막대 n/11주, 이번 주 날짜, 내 이름을 골랐으면 내 배정 지옥도·천국도·중립) → 누르면 기존 다승왕 화면. '다가오는 일정'에 다음 경기날 3개. 뚱뚱배 카드는 대회 표가 생기면 여기에
- 다승왕전 화면: 맨 위 '‹ 홈', 안쪽 탭은 이번 주·순위·예측 (내 기록·관리는 하단 탭으로 옮김)
- 기록: 기록 보관소 첫 모양(이번 시즌 다승왕전 → 순위). 지난 시즌·뚱뚱배는 대회 뒤에
- 처음 여는 사람은 홈부터. 전에 쓰던 사람은 마지막 탭(예: 이번 주) 그대로 열림
- 새 순수 함수 `homeSummary(state, today, pid)` (logic.js)
- 함께 고침: 데이터 받기 전 render가 돌아 나던 TypeError (#15부터, 오답 노트 26)
```
$ node logic.test.js; node deploy.test.js   (테스트 먼저)
  FAIL homeSummary … / FAIL 클럽 홈 틀 …
134 passed / 51 passed
$ (구현 뒤) logic 135 · deploy 53 · tourney 17 · push 5 passed
```
가짜 서버: 360px 홈→다승왕전(안쪽 탭 [이번 주, 순위, 예측])→기록→내 기록→관리→홈→‹ 홈 모두 이동, pageerror 0, 가로 넘침 없음 / 390·1024px 가로 넘침 없음, 저장된 탭 'week'면 이번 주로 열림 / 회귀: 경기 진행(코트 고르기 [코트 5, 코트 6, 추가 코트] → 코트 6, 이김 취소, 빼기) 그대로, 알림 켜기 흐름(구독 1·시험 알림 1·안내·다 했어요) 그대로
사진: docs/screenshots/club-home/club_home_360.jpg
## 63. 갤럭시 알림 사진 안내 guide.html (브랜치 feat/alarm-guide, 2026-11-25)
- 요청(김형준 2026-11-25): 직접 찍은 갤럭시 설정 화면으로 파트 1(휴대폰 설정)·파트 2(다승왕 알림 설정) 나눠 따라 하기 쉽게. 개인정보는 지우기
- 새 페이지 `guide.html`(앱과 따로 된 정적 페이지 → 단톡방에 링크로 공유 가능), 사진 8장 `guide/*.jpg`(폭 540, 합계 약 160KB). 앱 알림 안내(안드로이드)에 "📷 사진으로 따라 하기" 버튼
  - 파트 1: 설정 › 알림 › 고급 설정 › 앱별 알림 카테고리 관리 켜기
  - 파트 2: 시험 알림 보내기 → 길게 누르기 → ⚙ → 알림 카테고리 → '일반' 글자 → 소리 + 팝업으로 표시 → 다시 시험 알림
- 개인정보 처리(`tools/guide_images.py`, 원본 스크린샷은 저장소에 안 넣음): 설정 첫 화면 위쪽(이름·이어폰 이름) 잘라냄, 시험 알림의 사이트 주소(kimhyeo…) 가림, 모든 사진에서 상태표시줄(통신사·알림 아이콘) 잘라냄. 누를 곳에 노란 테두리
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 갤럭시 알림 사진 안내 guide.html: … → dist/guide.html 없음
  FAIL 앱 알림 안내(안드로이드)에서 사진 안내 guide.html로 가는 링크 → pushGuide에 guide.html 링크 없음
51 passed
$ (만든 뒤) node deploy.test.js | tail -1; node logic.test.js | tail -1; node tourney.test.js | tail -1; node --experimental-strip-types push.test.mjs | tail -1
53 passed
134 passed
17 passed
5 passed
```
- 역검증: 사진 이름 하나 틀리게 → "dist에 사진 없음" FAIL / 'kimhyeo' 넣기 → "개인정보 문자열" FAIL / 파트 2 제목 지우기 → 처음엔 FAIL 없음(본문 "파트 2로 가요"에 걸림) → 제목(h2) 기준으로 테스트를 고친 뒤 FAIL 확인
- 360px·1024px: 깨진 사진 0, 가로 넘침 없음, 페이지 오류 없음. 사진: docs/screenshots/alarm-guide/guide_360.jpg

## 64. "카톡처럼 화면 위에 뜨게 하려면?" → 사진 안내로 바로 (브랜치 feat/guide-direct, 2026-11-25)
- 요청(김형준 2026-11-25): 알림 카드의 이 링크를 누르면 사진 안내 화면이 바로 뜨게
- 안드로이드: 링크를 `<a href="guide.html">`로 바꿔 누르면 바로 guide.html. 아이폰: 사진 안내가 갤럭시용이라 지금처럼 앱 안 글 안내(push-help). 알림을 막 켰을 때 자동으로 펼쳐지는 안내(📷 사진으로 따라 하기 버튼 포함)는 그대로
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 알림 카드 "카톡처럼 화면 위에 뜨게 하려면?" → … 안드로이드 링크가 guide.html로 바로 가지 않음
53 passed
$ (바꾼 뒤) node deploy.test.js | tail -1; node logic.test.js | tail -1; node tourney.test.js | tail -1; node --experimental-strip-types push.test.mjs | tail -1
54 passed
134 passed
17 passed
5 passed
```
- 역검증: 아이폰 쪽도 링크로 바꾸면 → "아이폰은 앱 안 안내(push-help)로" FAIL (기존 "안내 다시 보기 없음"도 같이 FAIL)
- 가짜 서버 360px, 알림 켜진 상태: 안드로이드 UA → 링크 누르면 http://localhost:8799/guide.html, 제목 [파트 1 · 휴대폰 설정, 파트 2 · 다승왕 알림 설정, 안 될 때] / 아이폰 UA → 앱 안 글 안내가 펼쳐지고 시험 알림 1건, 가로 넘침 없음

## 65. 클럽 홈 + 경기날엔 바로 다승왕 (브랜치 feat/club-home 추가, 2026-11-25)
- 요청(김형준 2026-11-25): 클럽 홈(#23)을 머지하되, 경기날(오늘)엔 앱을 열면 바로 다승왕 화면, 왼쪽 위 뒤로 가기(‹ 홈)를 누르면 클럽 홈
- `L.startTab(보던 탭, 오늘, 시즌 날짜)`: 오늘이 다승왕전 날이면 'week'(관리 화면에서 새로 고침한 경우만 그대로), 아니면 보던 탭, 처음이면 'home'. 경기날엔 '이번 주'가 그날로 열림
- 오늘만이 아니라 앞으로 매주 경기날(수요일)에도 같은 동작
- main(#24·#25)을 합치며 deploy-log.md 충돌 → 양쪽 항목(62 / 63·64) 모두 살림
```
$ node logic.test.js; node deploy.test.js   (테스트 먼저)
  FAIL startTab: … → startTab 없음
  FAIL 앱을 열 때: 경기날이면 바로 이번 주(그날) … → start에서 첫 화면을 startTab으로 정하지 않음
$ (구현 뒤) logic 136 · deploy 57 · tourney 17 · push 5 passed
```
- 역검증: 경기날 규칙 줄 삭제 → "경기날인데 홈으로 열림" FAIL / 그날로 맞추는 줄 삭제 → "경기날 이번 주가 오늘 날짜가 아님" FAIL
- 가짜 서버 360px, 브라우저 시계 고정:
  - 11/25 18:00, 마지막 탭 홈 → 이번 주(11/25) + ‹ 홈 버튼, 누르면 클럽 홈(다승왕전 카드)
  - 11/25, 처음 여는 사람 → 같음
  - 11/26, 마지막 탭 홈 → 클럽 홈 / 마지막 탭 기록 → 기록
  - 페이지 오류 없음

## 66. 예측 탭 '내 예측 하기' 버튼이 하단 탭 뒤에 깔림 — 고침 (브랜치 fix/plan-cta-above-nav, 2026-11-25)
- 신고(김형준 2026-11-25 12:51, 경기날): 예측 버튼이 사라짐
- 원인: #23에서 하단 탭(.bnav, bottom: 0, z-index 9)을 넣을 때 .plan-cta(bottom: 0, z-index 9)를 안 올림 → CSS 뒤에 나오는 .bnav가 위에 그려져 버튼을 덮음 (오답 노트 27)
- 고침: .plan-cta를 bottom: calc(60px + safe-area)로, 본문 아래 여백 128 → 150px (버튼 + 탭 높이만큼)
```
$ node deploy.test.js   (테스트 먼저)
  FAIL 하단 탭(.bnav)에 가려지는 고정 버튼 없음 … → .plan-cta가 하단 탭 뒤(bottom: 0)에 깔림
$ (고친 뒤) deploy 58 · logic 136 · tourney 17 · push 5 passed
```
- 가짜 서버(MOCK_DEMO + MOCK_TODAY: 편성 공개된 주를 오늘로), 브라우저 시계 11/25 12:55, 예측 탭:
  - main 빌드: 360·1024px 모두 버튼 가운데를 찍으면 .bnav (버튼 아래 750px, 탭 위 699px) → 재현
  - 고친 빌드: 360·1024px 모두 버튼이 맨 위(버튼 아래 690px), 눌러서 예측 화면(.pe-head) 열림, 페이지 오류 없음
- 사진: docs/screenshots/plan-cta/before_after_360.jpg

## 67. 클럽 홈: 운동 참가(예시 · 신청은 밴드) · 청백전·뚠뚠배 · 진행 중인 공지 (브랜치 feat/home-band-info, 2026-11-25)
- 요청(김형준 2026-11-25): 다승왕 화면·관리 탭은 그대로, 홈은 시안대로 하되 참가는 예시이고 밴드에서 한다는 걸 밝히기, 청백전·다승왕 날짜 넣기, 공지는 지금 진행 중인 것만
- 새 파일 `club.js`(빌드에 인라인): 밴드 공지 6개·참가신청서 2주·행사 2개 데이터 + activeNotices / currentSignup / upcoming. 회원 이름·연락처 없음, 밴드 글 번호만
  - 지난 공지(2025 비상연락망, 하반기 행사일정)는 넣지 않음. until이 지난 공지·주간은 홈에서 자동으로 빠짐
  - 앱 공지·신청 기능 전까지 임시: 새 밴드 공지가 올라오면 club.js에 한 줄 추가해야 함
- 홈 순서: 운동 참가(요일 칸 '예시' 표시 + "참가 신청과 대기는 밴드 참가신청서에서" + 밴드 열기 버튼) → 진행 중(다승왕전 카드 + 청백전 D-4 · 뚠뚠배 D-23) → 진행 중인 공지(누르면 밴드 원문) → 다가오는 일정(다승왕전 + 행사 합쳐 4개)
- 청백전 날짜: 밴드 글에 "11월 29일(금)"인데 2026-11-29는 일요일 → 요일을 붙이지 않고 "11/29"로만 표시, 사용자 확인 요청
```
$ node logic.test.js; node deploy.test.js   (테스트 먼저)
  FAIL activeNotices … / currentSignup … / upcoming … / club.js 데이터 … (club.js 없음)
  FAIL 클럽 홈: 참가 신청은 예시 + 밴드 안내 … → club.js가 app.js보다 먼저 들어가야 함
$ (구현 뒤) logic 140 · deploy 59 · tourney 17 · push 5 passed
```
- 테스트 고침 1건(느슨하게 한 것 아님): 새 창 링크 검사를 viewHome 안 문자열 대신 bandLink 함수에서 확인하도록 (링크를 함수로 뺐기 때문)
- 가짜 서버(MOCK_DEMO+MOCK_TODAY), 시계 고정:
  - 11/25 13:20, 360·390·1024px: 요일 칸 월·화 지남 / 수 오늘 / 목 밴드, 공지 6개, 일정 [11/25 다승왕, 11/29 청백전, 12/2, 12/9], 밴드 링크 9개 모두 /post/번호, 가로 넘침·페이지 오류 없음
  - 11/27: 참가 칸이 다음 주(11/30–12/4)로, 이번 주 신청 공지 빠짐 / 12/5: 등록된 주간이 없어 참가 카드 숨김, 청백전 지나서 빠짐
- 사진: docs/screenshots/home-band/home_360.jpg
- 추가(김형준 확인 2026-11-25): 청백전은 **11/27(금)** → club.js 날짜·공지 기한 11/27, 요일 표시. 테스트(11/27·금요일) 추가, 11/29로 되돌리면 FAIL 확인. logic 140 passed

## 68. 내 기록·관리를 다승왕 안쪽 탭으로 되돌림 (브랜치 fix/dsw-tabs-back, 2026-11-25)
- 요청(김형준 2026-11-25 16:25): 기록·관리 탭을 예전처럼 다승왕 탭에 속하게, 예측 옆에 (오답 노트 28: 처음 요청을 잘못 읽음)
- 다승왕 안쪽 탭: 이번 주 · 순위 · 예측 · 내 기록 · 관리(로그인 전 PIN 표시) — #23 이전과 같은 5칸
- 하단 탭: 홈 · 다승왕 · 기록 (내 기록·관리는 빠짐, 다승왕 안 어느 탭이든 '다승왕'에 불)
- 테스트: 클럽 홈 틀 테스트를 새 요구로 고쳐 쓰고(요구 변경) 먼저 FAIL 확인 → logic 140 · deploy 59 · tourney 17 · push 5 passed
- 가짜 서버 11/25 16:40, 360·390·1024px: 안쪽 탭 5개, 내 기록·관리·예측 모두 다승왕 머리(돼지지옥 배너)와 '‹ 홈' 아래에 열림, 관리는 PIN 입력 화면, 하단 탭 홈·다승왕·기록 이동 정상, 가로 넘침·페이지 오류 없음
- 사진: docs/screenshots/dsw-tabs/admin_360.png

## 71. 회원 로그인(조 → 이름 → 비밀번호 4자리) + 돼장 회원 관리 (브랜치 feat/member-login, 2026-11-26)
- 요청(김형준 2026-11-26 17:32): 밴드를 앱으로 옮기기 1순위. 결정은 2026-11-25·26 대화대로 — 첫 화면 로그인, 게스트 없음, 이름 바꾸기 없음, 이미 비밀번호가 있는 이름은 그 비밀번호로만, 조 변경은 즉시
- **배포 순서 주의**: 운영 DB에 schema.sql '회원 로그인' 부분을 먼저 넣어야 함. 안 넣고 머지하면 비밀번호 확인 함수가 없어 아무도 못 들어옴
- DB(schema.sql): `member_pin`(bcrypt 해시, 틀린 횟수, 잠금 시각) · `member_session`(1년 토큰) 표. 둘 다 anon·authenticated 권한 회수, 함수로만 접근
  - member_has_pin / member_set_pin(이미 있으면 pin_exists) / member_login({token} · {error:wrong,left} · {error:locked,until}) / member_check(쉬는 회원·초기화면 null) / member_change_pin / member_logout
  - admin_member_pins · admin_reset_member_pin: 돼장(admin)만, 도우미(operator)는 unauthorized. 초기화하면 그 회원의 모든 기기 토큰도 지움
  - 5번 틀리면 10분 잠금. 틀린 횟수를 남기려고 오류(raise) 대신 값으로 돌려줌(raise하면 횟수 증가도 같이 취소됨)
- 앱:
  - 로그인 전에는 로그인 화면만(머리·하단 탭 없음): 조 카드(캐릭터 2개 + 인원) → 그 조 이름 → 처음이면 '비밀번호 만들기'(두 번), 있으면 비밀번호 입력
  - 예전에 이름만 골라 둔 기기(ddw-me)는 바로 그 이름의 비밀번호 단계
  - 내 기록 탭의 이름 고르기(select)와 예측 화면의 이름 고르기를 없앰. 내 기록 아래 '비밀번호 바꾸기'
  - 관리 › 회원: 조·쉬는 회원·전체 칸, 회원 줄(급수·조·비밀번호 있음/아직 로그인 안 함), 새 회원(이름 + 급수 → 조 자동), 급수 바꾸기(저장 즉시 조 이동), 쉬는 회원/다시 활동, 비밀번호 초기화(확인 한 번 더)
  - 회원 관리 저장은 app_state 전체 저장이라, 저장 안 된 편성 변경이 있으면 먼저 저장·되돌리라고 막음(편성 변경이 같이 저장되는 것 방지)
- 급수: 운영 명단에는 2026-11-24(rev 463)에 밴드 기준 55명의 `grade`가 이미 들어가 있음(밴드에 없는 3명만 '급수 미정'). 가짜 서버 데모(seed.js)에는 grade가 없어서 화면 확인 때 모두 '급수 미정'으로 보였던 것 — 처음엔 이걸 운영 상태로 잘못 적음(오답 노트 31). 급수를 안 고르면 조는 그대로
```
$ psql < supabase/tests/members.sql   (테스트 먼저: 함수 없음 FAIL → 구현 뒤)
  ok 43개 (3자리·글자·5자리 거절, 이미 있으면 못 만듦, bcrypt, 틀림 4→3, 맞으면 횟수 처음부터, 5번째 잠김·잠긴 동안 맞아도 거절·10분, 도우미 초기화 거절, 초기화 뒤 토큰 무효, 쉬는 회원 토큰 무효, anon 표 직접 읽기 거절 …)
$ node logic.test.js; node deploy.test.js   (테스트 먼저 FAIL 8건 확인)
  logic 145 · deploy 63 · tourney 17 · push 5 passed / live_action.sql·push.sql FAIL 0
```
- 역검증: 잠금 횟수를 50으로 → SQL FAIL 3, member_check에서 쉬는 회원 확인 빼기 → FAIL 1, 로그인 화면 막기 빼기 → deploy FAIL, 같은 이름 막기 빼기 → logic FAIL 2. 모두 되돌리고 다시 통과
- 가짜 서버(MOCK_DEMO, MOCK_MEMBER_PINS) Playwright, 360·390·1024px, 페이지 오류 0·가로 넘침 없음:
  - 새 기기: 조 3개(10·23·13명) → A조 10명 → 조영재 '비밀번호 만들기', 두 번 다르게 → "두 번 적은 비밀번호가 달라요." → 같게 → 홈 + "조영재 님, 반가워요!", 다시 열어도 로그인 유지
  - 내 기록: 이름 고르기 없음, 비밀번호 바꾸기(틀린 지금 비밀번호 → 안내, 맞으면 바뀜)
  - 다른 기기 같은 이름: 비밀번호 입력, 틀림 4→3→2→1번 남음 안내, 5번째 "…까지 잠겼어요"
  - 예전 사용자(ddw-me만 있음): 바로 비밀번호 단계 → 로그인
  - 돼장: 새 회원 홍길동(양갈비 → 소갈비·양갈비조), 박강호 급수 소갈비 → 즉시 B조, 서버 저장 확인. 이제영 비밀번호 초기화 → 그 기기 다시 열면 '비밀번호 만들기'
- 고친 것(화면 확인 중 발견): 비밀번호 바꾸기 접힘 칸이 토스트로 다시 그릴 때 접힘 → 펼침 상태 기억 / 회원 저장 뒤 '저장했어요.'가 내 안내를 덮음 → save(안내) / 초기화 뒤 기기가 '비밀번호 입력'으로 감 → 서버에 다시 물어 '만들기'로
- 사진: docs/screenshots/member-login/
- **고침(2026-11-27 김형준)**: "등급이 랍스터여도 소갈비 조에 뛸 수 있다, 대회(조)랑 회원 등급은 다르다" → 급수와 조를 따로 고르게 바꿈
  - 처음 구현은 급수를 바꾸면 조가 따라 바뀌었음(급수 → 조 자동). 11/24 명단 정리 때 이미 "밴드 급수는 grade 정보로만, 계산에는 안 씀"으로 정해 둔 것과도 어긋남(오답 노트 32)
  - logic `memberEdit`: 급수를 바꿔도 조 그대로, 조(A/B/C)는 `group`으로 따로 바꾸면 바로. 새 회원만 조를 안 주면 급수로 추천한 조
  - 회원 고치기 창: '급수 (회원 등급)' 6칸 + '다승왕·대회에서 뛰는 조 · 급수와 조는 따로예요' 3칸. 조를 바꿀 때만 "○조 → ○조 · 저장하면 바로 바뀌고, 이번 시즌 승수도 새 조 순위로 가요"
  - 새 회원: 급수를 고르면 그 급수의 조를 미리 골라 두고, 조를 직접 고른 뒤에는 급수를 바꿔도 조가 안 바뀜
  - 테스트를 새 요구로 먼저 바꾸고 FAIL 3건 확인 → logic 145 · deploy 63 passed. 역검증: 급수 바꾸면 조도 바꾸게 되돌리면 logic FAIL
  - 가짜 서버 360px: B조 권영순 급수 랍스터로 저장 → 서버 group B 그대로 · grade 랍스터 / 조 A로 → "캐비어·랍스터조로 옮겼어요", 서버 group A / 새 회원 양갈비 → 추천 B, C로 바꾼 뒤 급수 소갈비로 바꿔도 C 유지 → 서버 {group C, grade 소갈비}. 오류 0·넘침 없음
  - 그래서 11/24 표의 '급수 ≠ 조' 5명(박희수 등)은 그대로 둬도 되는 정상 상태

## 72. 운동 참가 신청 + 대기 + 정원 (브랜치 feat/signups, #31 위에, 2026-11-26)
- 요청(김형준 2026-11-26 17:32): 밴드 이관 2순위. 정원은 "우리 방식대로" 월·수·금 24 · 화·목 18 기본 + 그 주 그날만 바꾸기
- **배포 순서**: #31(회원 로그인) 다음. 운영 DB에 schema.sql '운동 참가 신청' 부분, Edge Function notify 새 코드(kind=signup)를 먼저 넣어야 함
- DB:
  - `workout_default`(월~금 기본 정원) · `workout_day`(그날 정원·메모·쉬는 날) · `signup`(회원 또는 게스트 한 줄, 신청 시각 순) · `signup_notice`(자리 나서 들어간 사람 알림 대기열). 네 표 모두 직접 읽기·쓰기 막고 함수로만
  - 상태는 저장하지 않고 계산: 신청 순서대로 정원까지 '신청 완료', 나머지 '대기 n번'. 그래서 취소·정원 늘리기·명단 빼기를 하면 대기 1번이 따로 처리 없이 들어감 → 바뀌기 전 '신청 완료' 목록과 비교해 새로 들어간 사람만 알림 대기열에(게스트는 데려온 회원에게)
  - 같은 날 동시 신청은 `pg_advisory_xact_lock`으로 차례대로
  - 회원: signup_apply / signup_cancel / signup_guest(하루 3명까지) / signup_guest_cancel(데려온 사람만) — 로그인 토큰(member_check) 필수, 오늘~13일 뒤 월~금만
  - 돼장(admin만, 도우미 안 됨): admin_set_day(정원·메모·쉬는 날) / admin_set_default_cap / admin_signup_add·remove(밴드·카톡 신청자 정리, 날짜 제한 없음)
  - 명단 signups_list(from, to)는 누구나(회원 이름은 이미 app_state에 공개. 게스트 이름은 이 함수로만)
- Edge Function notify: `{kind:'signup'}`이면 토큰 없이 signup_notices_take(안 보낸 것만 한 번 꺼내고 표시)로 대상을 받아 "○요일 운동 자리 났어요" 전송, 410은 push_unsubscribe
- 앱:
  - 하단 탭 홈·**참가**·다승왕·기록(4칸). 참가 탭: 이번 주/다음 주, 요일 카드(내 상태 칩, 현재/정원 막대, 메모, 신청·대기 신청·취소(확인 한 번)·＋게스트·명단)
  - 돼장: 카드마다 '정원·메모'(그날 정원·쉬는 날·메모), 명단 펼치면 빼기·넣기, 관리 › 설정에 기본 정원 월~금
  - 홈 참가 카드: 예시 + 밴드 안내 → 이번 주 실제 현황(내 신청 칸 남색·대기 노랑)과 '참가 신청하러 가기'
  - 참가 탭·홈을 보고 있으면 30초마다 명단 새로
- 요구가 바뀐 테스트 2개를 고쳐 씀(느슨하게 한 것 아님): 하단 탭 3→4칸(참가 추가), 홈 참가 카드 '예시+밴드' → '실제 신청 현황'
```
$ psql < supabase/tests/signups.sql   (테스트 먼저: 함수 없음 FAIL → 구현 뒤)
  ok 44 (기본 정원 24,18,24,18,24 · 토요일 없음 · 쉬는 회원·지난 날·3주 뒤 거절 · 정원 2에서 a·b 신청 완료, c 대기 1, 게스트 대기 2 ·
         a 취소 → c 자동 입장 + 알림 'c:in' · 게스트 들어가면 데려온 d에게 'guest_in' · 정원 3 → b 입장 · 돼장 넣기·빼기 · 남의 게스트 취소 거절 ·
         쉬는 날 신청 거절 · 기본 정원 바꾸기 · 알림은 구독한 기기만 한 번 · anon 표 직접 읽기 거절)
$ node logic.test.js; node deploy.test.js; node push.test.mjs   (테스트 먼저 FAIL 확인)
  logic 147 · deploy 66 · tourney 17 · push 7 passed / members.sql 43 ok · live_action·push.sql FAIL 0
```
- 테스트 기대값을 고친 것 1건: 'b 취소 → 게스트 입장 → b 다시 신청'에서 대기 번호를 2로 적었는데 실제 순서상 1이 맞음(계산 실수, 규칙은 그대로)
- 역검증: 알림 대기열 넣기 막기 → SQL FAIL 3, 열리는 기간 13→30일 → FAIL 1, 내 상태 찾기 막기 → logic FAIL, 자리 난 사람 알림 호출 빼기 → deploy FAIL, notify의 signup 대상 조회 빼기 → push FAIL. 되돌리고 다시 통과
- 가짜 서버(MOCK_SIGNUPS: 다음 주 월 15·화 6·수 27(24+대기 3)·목 6·금 3, 밴드 11/30 주 숫자와 비슷하게) Playwright, 360·390·1024px, 페이지 오류 0·가로 넘침 없음:
  - 홈 참가 카드 이번 주(월~수 지남, 목 18자리, 금 24자리), 하단 탭 홈·참가·다승왕·기록
  - 월 신청 → "신청했어요" 16/24, 화 게스트 → 내 게스트 칩, 수 명단 끝 '대기 1~3', 월 취소 → 확인 → 15/24
  - 다른 회원(390px)은 수요일 '대기 3번 · 앞에 2명'
  - 돼장: 수요일 정원 30 → "대기 3명이 들어갔어요", 가짜 서버 '[자리 났어요] … p005' + notify 호출됨(구독 없음 sent 0), 금요일 쉬는 날·메모, 화요일 명단에 넣기 → '돼장 넣음', 설정 기본 정원 24,18,24,18,24
- 고친 것(화면 확인 중): 360px에서 주 버튼 날짜가 두 줄로 깨짐 → '이번 주' / 날짜를 위아래로
- 아직 정하지 않은 것(김형준·돼장): 신청·취소 마감 시각(지금은 당일까지 취소 가능), 게스트 규칙(지금은 회원 1명당 하루 3명, 정원에 포함)
- 사진: docs/screenshots/signups/
## 74. 홈 청백전 카드에 실시간 점수판 링크 (브랜치 feat/cheongbaek-live, main 기준, 2026-11-27)
- 요청(김형준 2026-11-27 09:46): 다른 회원이 만든 청백전 페이지(https://chang333787-boop.github.io/cheongbaek-2026/)로 우리 앱에서 링크만 타고 가게. 청백전이 오늘(11/27)이라 이관 작업(#31~#33)과 따로 main 기준으로 만듦. 69~73번은 머지 전 PR들이 쓰고 있어 74번
- 링크 확인(WebFetch): 제목 '라켓뚱보단 청백전', 11/27(금) 오리초 실시간 점수판(패기팀 vs 짬바팀, 3코트, 32명), 방문자 로그인·개인정보 입력 없음(관리만 PIN)
- `club.js` EVENTS 청백전에 `live` 주소. 홈 행사 카드: live가 있으면 "📺 실시간 점수판"(노란 버튼, 새 창) + "밴드 공지 보기 ›"를 함께 담은 div (a 안에 a를 넣을 수 없어서). live 없는 행사(뚠뚠배)는 예전처럼 카드 전체가 밴드 링크. 행사 날이 지나면 카드가 사라지므로 링크도 같이 사라짐
```
$ node logic.test.js; node deploy.test.js   (테스트 먼저 FAIL 2건 확인 → 구현 뒤)
  logic 141 · deploy 60 · tourney 17 · push 5 passed
```
- 역검증: 처음 테스트는 글자만 찾아서 live 분기를 `if (false)`로 막아도 통과했음(FAIL 0) → 분기 모양까지 확인하게 테스트를 고침. 이제 분기 막기 → deploy FAIL, 새 창(target·rel) 빼기 → deploy FAIL. 되돌리고 통과
  - 처음 커밋의 이 로그 줄은 확인 전에 'FAIL'이라고 적었던 것 → 오답 노트 33
- 가짜 서버, 시계 11/26·11/27·11/28, 360·390·1024px: 11/26 D-1·11/27 D-DAY에 버튼(href 그 주소 · target _blank · rel noopener · 높이 40px), 11/28엔 청백전 카드 없음, a 안 a 0개, 가로 넘침·오류 없음
- 고친 것(화면 확인 중): 360px에서 "📺 실시간 점수판 ›"의 ›가 다음 줄로 → › 빼고 한 줄로
- 사진: docs/screenshots/cheongbaek-live/home_card_360.jpg
- 배포(2026-11-27 09:5x): 김형준 "진행" → #34 squash 머지(ed713c3) → GitHub Pages 배포 success → 실제 사이트(Chrome)에서 홈 청백전 카드 'D-DAY · 📺 실시간 점수판'(href 그 주소, target _blank) 확인, 뚠뚠배 카드는 그대로

## 75. 앱을 열면 늘 홈 + 청백전 당일엔 청백전이 홈 맨 위 큰 카드 (브랜치 feat/home-first-cb-hero, main 기준, 2026-11-27)
- 요청(김형준 2026-11-27 10:01): ① 앱 접속하면 다승왕이 아니라 홈 ② 오늘만 청백전이 메인(다승왕과 자리 바꿈) ③ '실시간 점수판' 말고 '청백전'으로만 ④ 다승왕처럼 꾸미되 돼장 청백전 공지(밴드 글 2638) 포스터 참고
- ① `L.startTab`: 늘 'home'(관리 화면에서 새로 고침할 때만 그대로). 경기날이면 다승왕에 들어갔을 때 그날 주가 보이게 `ui.week = 오늘`은 탭과 상관없이
- ② `Club.heroEvent(today)`: 따로 페이지(live)가 있고 오늘이 그 행사 날이면 그 행사. 홈 '진행 중'에서 그 행사가 큰 카드(다승왕 카드 자리), 다승왕은 작은 카드(행사 카드 줄 맨 앞, 누르면 다승왕)
- ③ 큰 카드 글씨 "청백전", 작은 카드(전날까지) 버튼도 "청백전 바로가기 ›". '실시간 점수판' 글씨는 홈에서 없음
- ④ 포스터에서 가져온 것: 하늘색 집중선 배경, 왼쪽 청팀 파랑 → 오른쪽 백팀 흰색, '청팀 VS 백팀' 뱃지(노란 테두리 빨간 VS), 굵은 남색 테두리 제목(청 파랑·백 흰색·전 빨강), 빨간 D-DAY. 포스터 그림 자체는 쓰지 않음
- 테스트를 새 요구로 먼저 바꾸고 FAIL 5건 확인 → logic 142 · deploy 61 · tourney 17 · push 5 passed. 요구가 바뀐 테스트 3개(경기날 다승왕으로 열기 → 늘 홈, 버튼 글씨 '실시간 점수판' → '청백전')는 고쳐 씀
- 역검증: heroEvent를 '오늘 이후'로 넓히면 logic FAIL 1(heroEvent 테스트, 전날에도 큰 카드), 홈에서 heroEvent를 안 쓰면 deploy FAIL 1 → 되돌리고 통과
- 가짜 서버, 360·390·1024px, 페이지 오류 0·가로 넘침 없음·a/button 안 링크 0:
  - 11/27, 저장된 탭이 다승왕·기록·없음 모두 → 홈. 큰 카드 'D-DAY · 오늘 · 청팀 VS 백팀 · 청백전 · 11/27(금) · 성남오리초 · 바로가기 ›'(href 청백전 페이지, 새 창), 작은 카드 '돼지지옥 다승왕전 5/11주 완료 · 이번 주 12/2(수)' + 뚠뚠배
  - 11/28: 예전처럼 다승왕 큰 카드, 청백전 없음 / 12/2(경기날): 홈으로 열리고, 다승왕 누르면 12/2 주
- 고친 것(화면 확인 중): 360px에서 부제 두 줄 → 짧게
- 사진: docs/screenshots/cheongbaek-hero/home_hero_360.jpg
- 배포(2026-11-27 10:1x): 김형준 "진행" → #35 squash 머지(edaee79) → GitHub Pages 배포 success → 실제 사이트(Chrome): 홈으로 열림(하단 탭 홈 선택), '진행 중' 맨 위 청백전 큰 카드(href 청백전 페이지), 작은 카드 '돼지지옥 다승왕전 7/11주 완료 · 이번 주 12/2' + 뚠뚠배, '실시간 점수판' 글씨 없음
  - 사용자 Chrome은 다크 모드 확장 프로그램이 색을 바꿔 그려서(계산된 배경색이 rgba(24,26,27…)로 바뀌어 있음, 앱 CSS엔 다크 모드 규칙 없음) 카드가 어둡게 보였음. 일반 화면 모습은 가짜 서버 사진과 같음

## 76. 앱 이름 '라켓뚱보단' (브랜치 fix/app-name, main 기준, 2026-11-27)
- 요청(김형준 2026-11-27 10:18): 앱 이름을 다승왕이 아니라 라켓뚱보단으로
- 바꾼 곳: manifest name '라켓뚱보단 다승왕전' → '라켓뚱보단', short_name(홈 화면 아이콘 밑 이름) '다승왕' → '라켓뚱보단', 창 제목(build.js TITLE), 아이폰 홈 화면 이름(apple-mobile-web-app-title), 알림 기본 제목(sw.js), 시험 알림 제목. 화면 안 '돼지지옥 다승왕전' 같은 행사 이름은 그대로
- 테스트를 먼저 바꾸고 FAIL 확인 → deploy 61 · logic 142 · tourney 17 · push 5 passed. 요구가 바뀐 테스트 1개(manifest 이름)는 고쳐 씀. 역검증: short_name을 '다승왕'으로 되돌리면 deploy FAIL
- service worker는 네트워크 먼저라 manifest 새 이름을 바로 받아 감. 이미 설치한 앱의 아이콘 이름은 안드로이드 Chrome은 다음에 앱을 열 때 manifest를 다시 확인해 바뀌고(바로 안 바뀔 수 있음), 아이폰은 홈 화면에서 지우고 다시 추가해야 바뀜
- 배포(2026-11-27 10:2x): 김형준 "진행" → #36 squash 머지(c6d7cb7) → GitHub Pages 배포 success → 실제 사이트(Chrome): 창 제목·아이폰 홈 화면 이름·manifest name·short_name 모두 '라켓뚱보단', 청백전 큰 카드 그대로

## 77. 앱 시작이 '불러오는 중'에서 멈추지 않게 (브랜치 fix/boot-stuck, main 기준, 2026-11-27)
- 계기(김형준 10:24): 폰(설치한 앱)에서 '불러오는 중…'만 보이고 안 열림 — 화면 캡처
- 원인 조사:
  - PC Chrome 실제 사이트는 정상. 저장된 이름을 회원 58명으로 하나씩 바꿔(iframe) 홈을 열어 봐도 58명 모두 '진행 중'까지 그려짐(멈춤 0) → 특정 회원 데이터 문제는 아님
  - 앱 JS에 최신 문법(?. ?? => let const 템플릿) 없음 → 오래된 폰 브라우저 문법 오류도 아님
  - 남은 가능성: 폰 쪽(앱 이름 바꾼 직후 설치 앱 업데이트 중, 느린 네트워크로 데이터 응답이 안 옴, 그 기기에 남은 화면 기억). 확정 못 함
  - 10:38 김형준: 앱을 다시 여니 잘 열림 → 한때만 생긴 일(이름 바꾼 직후 업데이트·네트워크 쪽으로 보임). 같은 일이 다시 생기면 이 PR의 오류 화면으로 원인을 볼 수 있게 함
  - 지금 구조의 약점: 데이터를 받은 뒤 화면을 그리다 오류가 나면 잡지 않아서, 데이터 응답이 끝없이 늦어지면 기다리기만 해서 둘 다 '불러오는 중'에 멈춤
- 고친 것:
  - start를 try/catch → 오류 화면 "화면을 그리지 못했어요 + 오류 글자 + 다시 시도 + 처음 상태로 열기"
  - '처음 상태로 열기': 이 기기의 화면 기억(임시 저장·탭·보기·주·관리 메뉴)만 지우고 다시 열기. 내 이름·관리자 로그인은 그대로
  - 15초 넘게 데이터를 못 받으면 "불러오는 데 오래 걸려요 + 다시 시도"(나중에라도 받으면 그대로 열림)
- 테스트를 먼저 쓰고 FAIL 확인 → deploy 62 · logic 142 · tourney 17 · push 5 passed. 역검증: try/catch 빼면 deploy FAIL
- 가짜 서버 Playwright 360px:
  - viewHome에 일부러 오류를 넣으면 → "화면을 그리지 못했어요 · 시험 오류: viewHome · 다시 시도 · 처음 상태로 열기"
  - 처음 상태로 열기 → 이름(p001) 남고 탭·임시 저장 지워짐, 앱 열림
  - 데이터 응답이 안 오면 2초 '불러오는 중…' → 15.5초 '불러오는 데 오래 걸려요 · 다시 시도' / 정상이면 16초 뒤에도 그 안내 안 뜸
  - 테스트 데이터를 처음에 settings: {}로 줬더니 시즌 날짜 계산이 끝나지 않아 페이지가 멈춤 → 실제 상태에 오류만 넣는 방식으로 바꿈(앱 코드 문제 아님, 실제 settings엔 시작·끝 날짜가 있음)
- 사진: docs/screenshots/boot-error/render_error_360.jpg
- 배포(2026-11-27 10:4x): 김형준 "진행" → #37 squash 머지(33e6e64) → GitHub Pages 배포 success → 실제 사이트(Chrome): 새 시작 코드(오류 화면·15초 안내) 들어감, 홈 정상(청백전 큰 카드, 제목 라켓뚱보단)

## 78. #31·#32 운영 반영 준비 (2026-11-27)
- 요청(김형준 11:38): 로그인과 요일별 참가 기능을 최우선으로
- 최신 main(#34~#37: 청백전 링크·큰 카드, 늘 홈, 앱 이름, 시작 오류 화면)을 feat/member-login → feat/signups로 merge. 충돌은 css·테스트·이 로그·오답 노트의 '둘 다 덧붙인' 부분뿐이라 둘 다 살림. 정리하다 테스트 두 곳씩 닫는 `});`가 빠짐 → 테스트가 문법 오류로 알려 줘서 고침(지난번과 같은 모양)
- 합친 뒤: logic 149 · deploy 70 · tourney 17 · push 7 passed / members 43 · signups 44 ok
- **운영 DB용 SQL 묶음** `supabase/migrations_2026-11-27_member_signups.sql`(334줄): schema.sql의 '회원 로그인' + '운동 참가 신청' 부분 그대로. 표 6개(member_pin, member_session, workout_default, workout_day, signup, signup_notice)를 새로 만들고 함수만 추가 — 기존 표·데이터(app_state 등)는 안 건드림
  - 확인: 운영과 같은 상태(main의 schema.sql만 넣은 새 DB)에 묶음을 넣고 → 한 번 더 넣어도 오류 없음(여러 번 돌려도 같음) → members 43 · signups 44 ok
  - deploy 테스트: 묶음이 schema.sql과 글자까지 같은지, 지우는 SQL(drop table·truncate·app_state 지우기)이 없는지. 역검증: 묶음의 잠금 시간을 바꾸면 FAIL
- 가짜 서버 E2E(합친 브랜치): 로그인(새 기기 만들기·다시 열기 유지·잠금·예전 사용자), 회원 관리(급수·조 따로), 참가(신청·대기·게스트·취소 확인·다른 회원 대기 3번·돼장 정원 30 → 대기 3명 입장 + 알림 호출·쉬는 날·명단 넣기·기본 정원) 모두 예상대로, 페이지 오류 0·가로 넘침 없음
- **운영 DB SQL 실행(2026-11-27 11:5x, 김형준 "sql 진행")**: Claude in Chrome으로 Supabase SQL Editor(project ovnagheqsygclposiemh)에 GitHub raw `8b9b7bb`의 묶음 파일을 받아 넣음 — 받은 파일과 편집기 내용 모두 SHA-256 `1542f9bf…3d23`(커밋된 파일과 같음), 335줄
  - "Potential issue detected(destructive operations)" 경고: 함수 안의 delete(만료 세션 정리·로그아웃·초기화·신청 취소)와 revoke 때문. 지금 바로 지우는 문장은 없음(테스트로 drop table·truncate·app_state 지우기 없음 확인) → Run query → "Success. No rows returned"
  - Chrome 자동 번역이 켜져 있었지만 편집기 내용은 SHA로 같은지 확인했고, 결과는 아래처럼 API로 따로 확인
  - 실행 뒤 공개 키로 확인: member_has_pin(p010) → 200 false · workout_defaults → [24, 18, 24, 18, 24] · signups_list(11/30~12/4) → 정원 24·18… 빈 명단 · 토큰 없이 signup_apply → unauthorized · 비밀번호 없는 회원 로그인 → no_pin · member_pin·signup 표 직접 읽기 → 401(권한 없음) · app_state rev 508 그대로
  - 앱 코드는 아직 머지 전이라 회원 화면은 그대로. 머지는 김형준 요청대로 밤 10시 예약
- **미리보기(2026-11-27 12:1x, 김형준 "미리보기 만들기")**: 머지 전에 직접 눌러 보도록 새 공개 저장소 `kimhyeongjun-1204/dasungwang-preview`(사용자 Chrome에서 만듦, 이 세션 GitHub 권한으로는 저장소를 못 만들어서) → feat/signups `01879fe` 빌드 결과만 올리고 GitHub Pages(main / 루트) 켬 → https://kimhyeongjun-1204.github.io/dasungwang-preview/ 200
  - 맨 위 빨간 띠 "미리보기 · 실제 DB를 써서 신청·비밀번호가 실제로 남아요", 창 제목·manifest 이름에 '미리보기'
  - 같은 주소(github.io)라 이 기기 저장값(ddw-me 등)을 실제 앱과 같이 씀 → PC Chrome은 ddw-me가 김성곤이라 미리보기가 '김성곤 님 비밀번호 만들기'로 열림(만들지 않음). 사용자에게 '‹ 이름 다시 고르기'로 본인 이름을 고르라고 안내
  - 확인 끝나면 저장소는 지워도 됨

## 79. 게스트 팝업·참가자 명단 팝업(밴드처럼) (2026-11-27)
- 요청(김형준 13:08): 게스트 추가는 이름 선택, 이름·성별(남/여)을 가운데 팝업으로 / 참여 목록에 이름과 급수 아이콘 / 신청 일시를 밴드처럼 / 목록 창은 밴드 참고
- 바꾼 것:
  - 게스트 추가 → 가운데 팝업: '이름 (선택)' 칸 + 성별 남/여(꼭 골라야 함) + 추가·취소. 이름 없이 넣으면 명단에 '게스트'로 보임
  - '명단 n' → 밴드 '참가자' 창처럼 가운데 팝업: 급수 캐릭터 아이콘 · 이름(급수) · 신청 일시("2026년 11월 26일 오후 2:38", 한국 시간) · 오른쪽 순서/대기 n · 아래 '확인'. 게스트는 남/여 색 동그라미 + "(게스트·여 · 데려온 사람 데려옴)". 돼장은 줄마다 빼기 + 아래 '명단에 넣기'
  - DB: signup에 guest_gender(M/F) 추가, 게스트 이름은 비워도 됨, signup_guest(token, d, 이름, 성별) 4개 인자, signups_list에 gender·at(신청 시각) 추가
  - 이미 있는 게스트 행(성별 없음)은 지우지 않으려고 새 검사 규칙은 NOT VALID로 추가(새로 넣는 행만 검사)
- 테스트 먼저 쓰고 FAIL 확인 → logic 150 · deploy 71 · tourney 17 passed / members 43 · signups 49 ok
- 역검증(실제로 돌린 결과):
  - SQL에서 bad_gender 검사를 빼면 → signups FAIL 2(성별 없음·이상한 값). 표의 검사 규칙이 대신 막긴 하지만 오류 이름이 달라 앱 안내가 안 맞음
  - 앱에서 '성별 안 고르면 막기'를 빼면 → 처음엔 deploy가 그대로 통과(테스트가 약했음) → 보내기 직전에 막는지 보는 검사를 더하고 다시 빼 보니 deploy FAIL 1
- 운영 상태에서 올리는 길: 예전 묶음(운영에 들어간 것) + 예전 모양 게스트 행이 있는 DB(ddw2)에 새 묶음 → 오류 없음, 예전 행 남음, signup_guest 인자 4개, members·signups 테스트 통과
- 가짜 서버 Playwright 360·1024px:
  - 게스트 팝업 가운데(세로 중심 380/760), 성별 안 고르고 추가 → "성별을 골라 주세요." / 이름 없이 여 → "게스트(여) 추가했어요." / 성별 누른 뒤에도 적은 이름 그대로 / 하루 4번째 게스트 → "게스트는 하루 3명까지…" 팝업 그대로
  - 명단 팝업: "화요일 운동 · 12/1 8/18", 급수 아이콘, 신청 일시, 게스트 줄 / 27명 날은 목록만 스크롤되고 창은 화면 안 / 바깥 누르면 닫힘 / 페이지 오류 0 · 가로 넘침 없음
  - 처음 토스트가 "홍길동(남)를 추가했어요"로 어색 → "홍길동(남) 추가했어요"로 고침
- 사진: docs/screenshots/signup-modal/guest_360.jpg · list_360.jpg
- **운영 DB SQL 다시 넣기(2026-11-27 13:3x, 김형준 "지금 SQL 진행")**: Claude in Chrome으로 Supabase SQL Editor에 GitHub raw `f2b9d3f`의 묶음을 넣음. 받은 파일과 편집기 내용 모두 SHA-256 `d15eebf6…bd21`(커밋된 파일과 같음), 343줄
  - "destructive operations" 경고: 이번엔 예전 함수 2개(signup_guest 3개 인자·signup_rows)와 예전 검사 규칙을 지우는 문장 때문(새 모양으로 바꾸려는 것). 표를 지우는 문장은 없음 → 실행
  - 실행을 누른 직후 대시보드 화면이 'browser extension may have caused an error'로 깨짐(Chrome 자동 번역 탓으로 보임) → 실행됐는지 화면으로는 못 봐서 공개 키 API로 확인
  - 확인: signup_guest(4개 인자, 가짜 토큰) → 400 unauthorized(함수 있음) · 예전 3개 인자 → 404(없어짐) · signups_list(11/30~12/4) → 정원 24·18·24·18·24 빈 명단 · workout_defaults → [24, 18, 24, 18, 24] · member_has_pin(p010) → false · signup 표 직접 읽기 → 401 · app_state rev 508 그대로
  - 운영엔 아직 신청이 없어서 gender·at 값은 운영에서 직접 못 봄(로컬 signups 테스트로만 확인). 실제 회원 이름으로 신청을 넣어 보지는 않음

## 80. 참가 카드 밴드식 체크 · "15/22 ›" · 참가자 급수 탭 (2026-11-27)
- 요청(김형준 13:41·13:55): 취소 확인의 "다시 신청하면 맨 뒤로 가요." 빼기 / 밴드 참가신청서 띄워 보기(Claude in Chrome으로 11/23 김성곤 글 '배드민턴 위크 11.30~12.4' 열어 둠) / 신청은 체크 버튼, "15/22 ›"처럼 인원 보고 › 눌러 명단 — 이건 밴드처럼, 나머지는 그대로 / 참가자 창은 밴드처럼(신청 일시) + 프로필 자리에 급수 아이콘 + 탭 '전체·캐비어·랍스터·소갈비·양갈비·돼지갈비·닭갈비'
- 밴드에서 본 것(11/30 주): 월 15/22 · 화 6/18 · 수 24/24 · 목 7/16 · 금 3/20 — 이번 주는 기본 정원(24·18·24·18·24)과 다름. 수요일은 이름 20명인데 24명(외부 참석자 4명으로 보임)
- 바꾼 것:
  - 카드: 진행 막대·'신청' 큰 버튼·'명단 n' 버튼 → 한 줄 [체크 동그라미 · 요일민턴(작게 '체크하면 신청' / '신청했어요' / '대기 n번이에요') · 15/22(대기 있으면 '대기 n') ›]. 체크 = 신청(꽉 차면 대기 신청), 체크된 걸 누르면 기존 취소 확인. 대기 중이면 노란 체크
  - 위쪽 요일·날짜·상태 칩, 메모, ＋게스트, 돼장 정원·메모, 내 게스트 칩은 그대로
  - 참가자 창: 4칸 탭(전체 / 캐비어·랍스터 / 소갈비·양갈비 / 돼지갈비·닭갈비, 칸마다 인원). 게스트·급수 없는 사람은 전체에만. 열 때마다 전체부터. 순서 번호는 탭을 바꿔도 원래 신청 순서
  - 처음 탭을 한 줄 가로 스크롤로 만들었더니 360px에서 세 번째 탭이 잘림 → 4칸 고정(두 줄 글자)으로 바꿈
- 테스트 먼저 쓰고 FAIL 확인 → logic 151 · deploy 73 · tourney 17 passed
- 역검증: sgFilter가 탭을 무시하면 logic FAIL 1 · 체크된 동그라미도 신청으로 보내면 deploy FAIL 1
- 가짜 서버 Playwright 360·1024px: 화 체크 → "12/1(화) 신청했어요." 7/18 · 다시 누르면 "12/1(화) 신청을 취소할까요?" → 취소 6/18 / 수 "24/24 대기 3 ›" → 참가자 창 탭 전체 27·캐비어·랍스터 7·소갈비·양갈비 12·돼지갈비·닭갈비 8, 탭마다 그 급수만 / 다시 열면 전체 / 가로 넘침 없음 · 페이지 오류 0
- 사진: docs/screenshots/signup-modal/card_check_360.jpg (탭 사진은 81의 얼굴 탭으로 바뀜)
- DB 변경 없음(화면만)

## 81. 참가 카드 문구·얼굴 아이콘·급수 탭 6개 (2026-11-27)
- 요청(김형준 14:03): "체크하면 신청" 문구 빼기 / 프로필은 전신 캐릭터 말고 얼굴만 나오는 아이콘 / 탭은 묶지 말고 캐비어·랍스터… 각각 / 탭도 얼굴 아이콘으로
- 바꾼 것:
  - 카드: 신청 전에는 '요일민턴'만(체크하면 신청·체크하면 대기 신청 문구 뺌). 신청 뒤 '신청했어요'·'대기 n번이에요', 쉬는 날·지난 날 안내는 그대로
  - 참가자 창 프로필: 다승왕 화면에서 쓰던 얼굴 아이콘(images.css face-cv…)으로
  - 탭 7칸: 전체 + 캐비어·랍스터·소갈비·양갈비·돼지갈비·닭갈비 얼굴, 아래 인원. 0명인 탭은 흐리게. 화면 읽기는 "양갈비 6명"처럼 이름으로
- 테스트 먼저 바꾸고 FAIL 확인 → logic 151 · deploy 73 · tourney 17 passed
- 역검증: 급수 대신 예전처럼 두 급수 묶음으로 거르면 logic FAIL 1 · 프로필을 전신 아이콘으로 되돌리면 deploy FAIL 1
- 가짜 서버 Playwright 360·1024px: 카드 "월요민턴 15/24 ›"(문구 없음) / 탭 전체 27·캐비어 4·랍스터 3·소갈비 6·양갈비 6·돼지갈비 4·닭갈비 4, 탭마다 그 급수만 / 탭 한 칸 너비 360px 40px · 1024px 59px, 가로 넘침 없음 · 페이지 오류 0
- 사진: docs/screenshots/signup-modal/list_faces_all_360.jpg · list_faces_lm_360.jpg · card_check_360.jpg(다시 찍음)

## 82. 참가 탭 맨 위 안내문 뺌 (2026-11-27)
- 요청(김형준 14:06): "동그라미를 체크하면 바로 신청돼요. 정원이 차면…" 문구 다 빼기
- 테스트 먼저(문구 없어야 함) FAIL 확인 → 줄 삭제 → deploy 73 · logic 151 passed. 빌드 결과에도 문구 0개

## 83. 체크 해제 = 바로 취소 (2026-11-27)
- 요청(김형준 14:08): 체크 버튼을 해제하면 "취소할까요?" 없이 그냥 해제
- 바꾼 것: 체크된 동그라미를 누르면 바로 취소 요청 → "취소했어요."(대기자가 들어가면 "대기하던 n명이 들어갔어요." 덧붙임). 확인 배너·sgAsk 상태·sg-cancel-yes/no 처리 뺌
- 테스트 먼저 바꾸고 FAIL 확인 → deploy 73 · logic 151 · tourney 17 passed. 처음 쓴 검사가 처리 코드 위 주석 줄을 못 넘어가서 구현 뒤에도 FAIL → 검사식을 고침(구현은 그대로)
- 역검증: sg-cancel을 다시 한 단계 거치게 바꾸면 deploy FAIL 1
- 가짜 서버 Playwright 360·1024px: 화 체크 → 7/18 / 다시 누르면 배너 없이 바로 6/18 · "취소했어요." / 가로 넘침 없음 · 페이지 오류 0

## 84. 참가자 창 게스트 줄 문구 (2026-11-27)
- 요청(김형준 14:17): "게스트·남 · 김형준 데려옴" 말고 "남게스트 · 김형준 추가" 식으로
- 바꾼 것: 이름 있는 게스트 "홍길동(남게스트 · 조영재 추가)", 이름 없는 게스트 "여게스트 · 조영재 추가". 쓰지 않던 sgName 함수 지움
- 테스트 먼저(예전 문구 없음·새 문구) FAIL 확인 → deploy 74 · logic 151 passed
- 가짜 서버 Playwright 360px 명단: "여게스트 · 조영재 추가" / "홍길동(남게스트 · 조영재 추가)" 확인. 처음엔 이름 없는 쪽이 "여게스트· 조영재"로 붙어 보여서 띄어쓰기 고침

## 85. 뒤로 가기 · 라켓뚱보단 눌러 홈 (2026-11-27)
- 요청(김형준 14:18·14:20): 참가 신청에 들어가면 뒤로 가기 버튼이 없고, 폰에서 뒤로 가면 앱이 꺼짐 / 왼쪽 위 '라켓뚱보단' 누르면 홈으로
- 원인: 화면 전환이 화면 안 상태만 바꾸고 브라우저 기록을 안 남김 → 폰 뒤로 가기 = 첫 페이지 뒤 = 앱 밖
- 바꾼 것:
  - 홈 → 다른 화면(참가·다승왕·기록)으로 갈 때, 팝업(참가자·게스트)을 열 때 기록을 하나씩 쌓음. 폰 뒤로 가기는 L.backStep대로 한 단계: 팝업 닫기 → 홈 → (홈이면) 앱 밖
  - 화면 안 버튼으로 닫을 때(‹·라켓뚱보단·확인·취소·게스트 추가 완료)는 쌓인 기록도 하나 빼서 다음 뒤로 가기가 맞게(그때 오는 popstate는 무시)
  - 참가·기록 화면 맨 위 왼쪽에 '‹'(홈으로), '라켓뚱보단' 글자도 누르면 홈. 다승왕 화면은 원래 '‹ 홈' 있음
  - 같이 고친 버그: 지난 날·쉬는 날(흐린 카드)에서 연 참가자 팝업이 다음 카드 아래로 깔려 '확인'이 안 눌림 → 팝업을 카드 밖에서 그림(오답 노트 34)
- 테스트 먼저 쓰고 FAIL 확인 → logic 152 · deploy 75 · tourney 17 passed (팝업 위치 검사는 고친 뒤 추가, 역검증으로 FAIL 확인)
- 역검증: 홈→화면 기록을 안 쌓으면 deploy FAIL 1 · 팝업을 카드 안에 다시 그리면 deploy FAIL 1 · backStep이 팝업을 무시하면 logic FAIL 1
- 가짜 서버 Playwright 360px(브라우저 뒤로 = 폰 뒤로): 참가 → 뒤로 → 홈 / 참가 → 명단 팝업 → 뒤로 → 팝업만 닫힘 → 뒤로 → 홈 / ‹ → 홈 / 기록에서 라켓뚱보단 → 홈 / 명단 '확인' 뒤 뒤로 → 홈 / 게스트 추가 완료 뒤 뒤로 → 홈 / 다승왕 → 순위 → 뒤로 → 홈 / 참가 → 기록 → 뒤로 → 홈 / 홈에서 뒤로 → 앱 밖. 매번 남은 기록이 화면과 맞음(홈=base). 앱 오류 0
- 실제 폰(설치한 앱)에서는 아직 못 눌러 봄 — 미리보기에서 확인 필요

## 86. 참가자 탭 다시 두 급수씩 묶음 + 급수 높은 순 (2026-11-27)
- 요청(김형준 14:24): 탭을 캐비어·랍스터 / 소갈비·양갈비 / 돼지갈비·닭갈비로 묶고 등급 순 내림차순
- 바꾼 것: 탭 4칸(전체 + 묶음 3개, 묶음 탭은 얼굴 두 개 + 인원). 묶음 탭 안은 급수 높은 순(캐비어 → 랍스터), 같은 급수는 신청 순. 전체 탭은 그대로 신청 순(14:03 "전체는 참가 누른 일시"). 오른쪽 번호·대기는 원래 신청 순서 그대로
- 테스트 먼저 바꾸고 FAIL 확인 → logic 152 · deploy 75 · tourney 17 passed
- 실수: 탭 코드를 통째로 바꾸다가 바로 위에 넣어 둔 backStep(뒤로 가기) 함수까지 지움 → logic 테스트가 멈추고 deploy 2개가 "backStep is not defined"로 FAIL → 다시 넣음
- 역검증: 묶음 안 정렬을 빼면 logic FAIL 1
- 가짜 서버 Playwright 360·1024px(급수는 가짜 서버가 조 안에서 번갈아 넣은 값): 캐비어·랍스터 탭 = 캐비어 #1·#7·#20·대기 2 → 랍스터 #13·#19 / 소갈비·양갈비 탭 = 소갈비 6명 → 양갈비 6명 / 돼지갈비·닭갈비 탭 = 돼지갈비 4명 → 닭갈비 4명 / 탭 한 칸 360px 71px, 가로 넘침 없음 · 오류 0
- 사진: docs/screenshots/signup-modal/list_group_tabs_360.jpg

## 88. '게스트는 돼장만' 되돌림 (2026-11-27)
- 요청(김형준 14:33): 게스트 추가는 돼장뿐 아니라 다른 사람도 가능하게 그냥 둠 → 87(47e12e9)을 git revert
- 운영 DB에는 87의 SQL을 넣지 않았음 → 운영(d15eebf6 묶음)과 코드가 다시 같음. 묶음 SHA-256 d15eebf6… 확인
- 되돌린 뒤: deploy 75 · logic 152 passed / signups 49 · members 43 ok (Postgres가 꺼져 있어서 처음엔 0 ok로 나옴 → 켜고 다시 돌림)

## 89. 밴드 11/30 주 신청자 → 앱(운영 DB)으로 옮김 (2026-11-27 14:5x)
- 요청(김형준 14:33): 다음 주 신청 회원 찾아서 옮기자
- 밴드 글 '[참가신청서] 배드민턴 위크 11.30~12.4'(11/23 김성곤)의 요일별 '참가자' 창 5개를 Claude in Chrome으로 읽음: 월 15/22 · 화 6/18 · 수 24/24 · 목 7/16 · 금 3/20, 모두 55줄(28명). 외부 참석자 없음(아까 수요일 '이름 20명'은 카드 글자가 잘려 보인 것 — 참가자 창엔 24명 다 있음)
- 이름 28개 모두 앱 명단에 한 명씩만 있음(같은 이름 없음), 급수도 밴드와 같음
- SQL(저장소에 안 올림 — 실제 회원 id·시각): 정원 월 22 · 목 16 · 금 20(화 18 · 수 24는 기본값과 같아 그대로) + signup 55줄. 신청 시각은 밴드 시각(분까지) 그대로, 같은 분에 둘이면 밴드 순서대로 초를 1초 차이로. 회원이 직접 신청한 것으로(by_admin false). 이미 있는 (날짜, 회원)은 건너뜀. 알림 안 만듦
  - 먼저 ddw2 복사본(ddw3)에 두 번 → 두 번째도 15/6/24/7/3 그대로, 알림 0, 순서가 밴드와 같음
  - 넣기 직전 밴드 다시 확인: 15/6/24/7/3 그대로
  - Supabase SQL Editor에 넣고 SHA-256 c081fa5b…9c06(만든 파일과 같음), 68줄 확인 → 실행 → 결과 15·6·24·7·3
- 실행 뒤 공개 키로 확인: signups_list 11/30~12/4 = 15/22 · 6/18 · 24/24 · 7/16 · 3/20, 대기 없음, 순서·처음·마지막 신청 시각이 밴드와 같음 · app_state rev 508 그대로
- 남은 일: 지금부터 밴드에서 새로 신청·취소하는 사람은 앱에 따로 반영해야 함(돼장 '명단에 넣기·빼기', 또는 같은 SQL을 다시 만들어 돌리면 새 사람만 들어감)

## 90. 회원 로그인(#31) · 운동 참가 신청(#32) 머지·배포 (2026-11-27 14:4x)
- 요청(김형준 14:42): 청백전 관계없이 로그인이랑 참가 신청 머지 진행 (밤 10시 예약보다 앞당김)
- 머지 전: main이 두 브랜치에 이미 다 들어가 있음(충돌 없음). feat/signups에서 logic 152 · deploy 75 · tourney 17 · push 7 passed / members 43 · signups 49 ok. 운영 DB 묶음 SHA-256 d15eebf6…(운영에 넣은 것과 같음)
- #31 'merge' 방식 머지(ab71e04) → #32 base를 main으로 → 'merge' 방식 머지(4683f88). main과 feat/signups 글자 차이 없음
- GitHub Pages 배포(4683f88) success
- 실제 사이트(Chrome): 새 코드 들어감(체크 버튼·뒤로 가기·로그인·급수 탭·‹ 버튼), 제목 '라켓뚱보단', 홈에 청백전 큰 카드 그대로. 참가 탭 다음 주 = 월 15/22 · 화 6/18 · 수 24/24 · 목 7/16 · 금 3/20(89에서 옮긴 그대로), 들어가면 기록이 쌓이고 ‹ 버튼 있음
- 확인하다 본 것: 이 PC Chrome은 미리보기와 같은 주소라 저장값을 같이 씀 → ddw-me가 김성곤(p005)이고 회원 로그인 상태로 열림. member_has_pin: p005 true · p010 false → 김성곤 비밀번호가 이미 만들어져 있음(Claude가 만든 것 아님 — 비밀번호를 넣은 적 없음). 돼장 본인이 만든 게 아니면 관리에서 초기화 필요 → 김형준에게 확인 요청
- 밤 10시 예약 작업(같은 머지)은 끄려 했으나 권한이 막힘 → 남아 있음. 10시에 돌면 이미 머지된 걸 보고 보고만 하면 됨

## 91. 로그인: 예전에 고른 이름으로 바로 가지 않기 (2026-11-27)
- 신고(김형준 14:49): 로그인하면 바로 '주성모 님'으로 뜸
- 원인: 토큰이 없는데 예전에 고른 이름(ddw-me, 로그인 생기기 전 '내 이름')이 있으면 그 사람 비밀번호 단계로 바로 감(#31에서 '예전 사용자 편하게' 하려던 것). 같이 쓰던 폰·PC면 남의 이름 화면이 뜨고, 처음이면 남의 이름으로 비밀번호를 만들 수 있음. PC Chrome이 김성곤으로 열린 것도 같은 이유로 보임
- 고친 것: 토큰 없으면 늘 '내 조를 골라 주세요'부터. 로그인했던 사람이 풀렸을 때(초기화·만료, memberOut)만 그 이름 비밀번호 단계로
- 테스트 먼저(처음 열 때 lgPick 없음) FAIL 확인 → deploy 76 · logic 152 passed
- 가짜 서버 Playwright 360px: 예전 이름만(p005, 토큰 없음) → "내 조를 골라 주세요" / p010 토큰 → 로그인 상태·하단 탭 / 아무것도 없음 → "내 조를 골라 주세요" · 오류 0
- 운영 확인(공개 키, member_has_pin 58명): 비밀번호 있는 사람 김성곤(p005) · 김형준(p006) · 최서연(p031) — 주성모(p008)는 없음(남의 이름으로 만든 것 없음)
- 배포(2026-11-27 14:5x, 김형준 "머지"): #38 squash 머지(e465a93) → GitHub Pages success → 실제 사이트 index.html에 예전 바로 가기(lgPick(meP.id)) 없음, 새 코드 들어감

## 92. 관리 PIN 입력 없앰 — 돼장·진행 도우미를 회원 로그인으로 (2026-11-27)
- 요청(김형준 15:02): 다승왕 관리 PIN 입력 지우기 / 돼장(김성곤)은 PIN 9999로
  - 물어본 것: 진행 도우미 → "돼장이 회원 중에서 지정" / 돼장 권한 → "김성곤 + 김형준"
  - 김성곤 비밀번호 9999는 Claude가 넣지 않음(비밀번호를 대신 만들지 않기로 한 규칙) → 김형준에게 방법 안내
- DB(새 '회원 역할' 부분): club_role 표(돼장 p005·p006 넣음, 아무도 직접 못 읽음), admin_session에 player_id
  - member_role_session(회원 토큰) → 역할 있으면 {token, role}, 없으면 null. 하루 넘게 남은 같은 열쇠가 있으면 그걸 다시 줌(앱을 열 때마다 안 쌓임)
  - admin_operators / admin_set_operator(돼장만): 도우미 지정·해제. 해제하면 그 회원 열쇠 바로 끊음. 돼장은 도우미로 못 바꿈(is_admin)
  - admin_reset_member_pin: 그 회원 관리 열쇠도 같이 끊음
  - 예전 admin_login·operator_login(PIN) 함수는 앱에서 안 쓰지만 비상용으로 남김
- 앱: 관리 탭 PIN 입력·잠그기·진행 PIN 카드·관리 PIN 바꾸기 카드 뺌. 로그인·앱 열 때 roleSync로 열쇠 받기, 로그아웃·초기화 때 버림, 서버가 열쇠를 거절하면 다시 받기(adminExpired). 관리 탭은 돼장·도우미에게만 보임. 설정에 '진행 도우미' 카드(고르기·✕)
- 운영에 넣을 SQL: 작은 묶음 supabase/migrations_2026-11-27b_member_roles.sql(68줄, SHA-256 083bade7…9e4a). 전체 묶음도 schema.sql 따라 다시 뽑음(다시 돌려도 같음)
- 테스트 먼저 쓰고 FAIL 확인 → roles 27 · members 43 · signups 49 ok / deploy 78 · logic 152 · tourney 17 · push 7 passed
  - 처음 쓴 roles 테스트 하나('돼장은 해제로 못 뺌')의 기대값이 틀림 — 그때 b가 아직 도우미라 목록은 ["b"]. 코드는 그대로, 기대값만 고침
- 역검증:
  - 도우미 해제 때 열쇠를 안 끊으면 roles FAIL 1 · 비밀번호 초기화 때 안 끊으면 FAIL 1
  - admin_set_operator 첫 줄의 돼장 확인을 빼도 FAIL 0 — 끝에서 부르는 admin_operators가 다시 확인해서 예외가 나고 바꾼 게 되돌아감(권한은 그대로 막힘). 확인이 두 겹이라 남김
  - 로그인 뒤 roleSync를 빼도 처음엔 deploy가 통과(검사식이 파일 뒤쪽 다른 roleSync까지 잡음) → memberIn 함수 안만 보게 고친 뒤 FAIL 1. 로그아웃 때 열쇠를 안 버려도 FAIL 1
- 운영과 같은 상태에서 올리기: #31 전 schema + 운영 묶음(d15eebf6) + 밴드 55줄 + 새 역할 묶음 두 번 → 오류 없음, 신청 55줄 그대로, 돼장 p005·p006, 함수 3개, player_id 칸 / roles·members 통과. signups 테스트는 그 DB에서 FAIL 18 — 테스트가 다음 주 월요일을 쓰는데 옮겨 둔 55줄과 겹침. 같은 DB에 역할 묶음 없이(밴드만) 돌려도 FAIL 18, 밴드 없이 역할 묶음만이면 49 ok → 역할 SQL 탓 아님
- 가짜 서버 Playwright 360px: 돼장(p010) → 관리 탭 보임, PIN 칸·잠그기 없음, 설정 카드 '운동 기본 정원 / 고정 코트 번호 / 진행 도우미' → 최신웅 지정 / 그 회원 → 관리 탭 보임, "진행 도우미예요" / 일반 회원 + 예전 PIN 열쇠 남은 기기 → 관리 탭 없음, 열쇠 지워짐 / 해제 뒤 그 회원 → 관리 탭 없음 / 오류 0
## 93. 끝난 주 숨기기 · 명단 급수 글자·순서 번호 빼기 · 대기 신청 버튼 · 홈에 내 이름 (2026-11-27)
- 요청(김형준 15:55): ① 11/27(금)은 청백전이라 참가 신청 안 받음, 이번 주가 끝났으면 다음 주 탭만 ② 이름 옆 (소갈비) 지우기 ③ 참가자 창 오른쪽 신청 순서 번호 지우기 ④ 수요일처럼 꽉 차면 대기 신청 버튼 / ⑤ 홈 맨 위 오른쪽에 내 급수 아이콘·이름
- 바꾼 것:
  - L.signupOpenWeeks: 오늘부터 남은 날이 전부 '쉬는 날'인 주는 뺌(명단 못 받은 날은 열린 것으로 봄, 다 빠지면 그대로). 참가 탭 주 고르기와 홈 '운동 참가' 카드 둘 다
  - 참가자 창: 이름만(급수는 얼굴 아이콘으로), 오른쪽은 대기한 사람만 '대기 n'
  - 꽉 찬 날·내가 아직 없을 때: 체크 동그라미 대신 '대기 신청하기' 버튼. 카드 줄 오른쪽 '대기 n' 작은 글자는 뺌(위 칩 '꽉 참 · 대기 n명'에 있음) — 360px에서 '수요민턴'이 두 줄로 꺾여서
  - 홈 맨 위 오른쪽 '얼굴 + 내 이름'(로그인했을 때만)
  - ①의 11/27 쉬는 날 지정은 운영 데이터라 따로(아래)
- 테스트 먼저 FAIL 확인 → logic 153 · deploy 77 · tourney 17 · push 7 passed
- 역검증: signupOpenWeeks가 다 돌려주면 logic FAIL 1 / 대기 버튼을 끄면 처음엔 deploy 통과(검사가 글자만 봄) → 버튼을 그리는 조건식까지 보게 고친 뒤 FAIL 1
- 가짜 서버 Playwright 360px(급수·이름은 가짜): 11/27 열림 → 주 '이번 주·다음 주', 홈 11/23–11/27 / 11/27 쉬는 날(청백전) → 주 '다음 주'만, 홈 11/30–12/4 / 수요일 줄 "대기 신청하기 수요민턴 24/24 ›" 동그라미 없음 → 눌러서 "대기 4번으로 신청했어요." → "대기 4번이에요" / 명단 줄 "박강호 2026년 11월 15일 오전 5:57"(급수·번호 없음), 대기만 "대기 4" / 홈 오른쪽 위 "얼굴 + 유성준" / 오류 0
- 사진: docs/screenshots/signup-modal/next_only_wait_360.jpg · list_no_grade_no_num_360.jpg · home_me_360.jpg
- 운영 데이터(2026-11-27 16:0x, 김형준 "금요일은 청백전이라 참가 신청 안 받아도 됨"): Supabase SQL Editor로 workout_day 11/27 = 쉬는 날 + 메모 '청백전'(정원 24 그대로). 넣기 전 11/27 신청 0명 확인. 실행 뒤 signups_list: 11/27 쉬는 날·청백전·open false · 11/30~12/4는 22·18·24·16·20, 15·6·24·7·3명 그대로

## 94. 내 정보 탭 — 달력·다가오는 운동·다승왕전 기록 (2026-11-27)
- 요청(김형준 16:04): 하단에 '내 정보' 추가 → 달력으로 운동 나간 날·신청한 날 표시, 대회 기록. 물어본 것: 지난 기록 → "밴드 기록도 가져오기", 대회 → "앱 대회만"
- 바꾼 것(#40 위에 쌓음):
  - 하단 탭 다섯 번째 '🙂 내 정보'
  - 위: 급수 얼굴 · 이름 · 급수 · 조 / 달력(일요일 시작, ‹ › 달 넘기기): 지난 날 신청 완료 = '운동함'(남색), 오늘 이후 신청 = '신청'(테두리), 대기 = '대기'(노랑), 오늘은 빨간 테두리. 지난 대기·내가 데려온 게스트는 운동한 날로 안 셈. 아래 그 달 개수
  - 다가오는 운동(이번 주·다음 주 명단에서 신청함·대기 n번), 참가 신청 바로가기
  - 대회 기록: 다승왕전 나간 주·승패(주별, 최근부터), '다승왕 내 기록 자세히'. 뚱뚱배는 앱에서 열리면
  - 그 달 명단은 signups_list로 그때그때(새 SQL 없음). 탭에 들어올 때마다 새로 읽음
  - L.monthGrid · L.myDays · L.myDsw (logic.js)
- 테스트 먼저 FAIL 확인 → logic 154 · deploy 78 · tourney 17 passed (예전 '하단 탭은 4개' 검사는 내 정보를 허용하게 고침)
- 역검증: 지난 대기도 '운동함'으로 세면 logic FAIL 1
- 가짜 서버 Playwright 360·1024px(가짜 데이터): 하단 탭 '홈·참가·다승왕·기록·내 정보' / 제목 '🙂 내 정보' / 11월 달력 11/30 '신청', 오늘 테두리 / 다가오는 운동 '11/30(월) 신청함' / 다승왕전 '5주 · 4승 4패', 주별 줄 / 12월로 넘기기 됨 / 가로 넘침 없음 · 오류 0
- 사진: docs/screenshots/signup-modal/my_info_360.jpg
- 밴드 지난 기록: #정기모임(벙)_알림 글을 훑어보니 2025-06부터 있음(2025년은 요일마다 따로 올린 글, 2025-10월 무렵부터 '배드민턴 위크' 주 단위 글). 명단은 글마다 요일별 '참가자' 창을 열어야 나옴 → 범위 정한 뒤 옮기기(아직 운영 DB에 안 넣음)

## 95. 이달의 출석왕 (2026-11-27)
- 요청(김형준 16:12): 이달(11월 등)의 출석왕 순위 집계 / 밴드 정보 수집은 이번 달 것부터만
- 바꾼 것(#41에 이어서): L.attendRank — 그 달 명단에서 오늘 전 날짜의 '신청 완료'만 셈(대기·게스트·오늘 이후 빼고), 같은 수는 같은 순위. 기록 탭 맨 위 'n월 출석왕' 카드(‹ › 달 넘기기, 10위까지 + 내 줄 강조, 1위 👑). 내 정보 달력 아래 'n월 출석 n회 · n위 (n명 중)'
- 테스트 먼저 FAIL 확인 → logic 155 · deploy 79 passed
- 역검증: 오늘 것도 세면 logic FAIL 1
- 가짜 서버 Playwright 360px(가짜 데이터, 11/23~26에 돼장 넣기로 8줄): '👑 이제영 3회 · 2 유성준 2회 · 2 최신웅 2회 · 4 김건율 1회', 내 줄 강조 / 12월 '아직 운동한 기록이 없어요' / 내 정보 '11월 출석 2회 · 2위 (4명 중)' / 오류 0
- 사진: docs/screenshots/signup-modal/attend_rank_360.jpg

## 96. 밴드 11월 기록 옮기기 · 회원 역할 SQL · #39·#40·#41 머지 (2026-11-27 16:3x)
- 요청(김형준 16:12·16:16): 정보 수집은 이번 달 것부터 / 완료되면 SQL 작업하고 순서대로 머지
- **밴드 11월 참가신청서 → 운영 DB**
  - 글 4개(11.2~6, 11.9~13, 11.16~20, 11.23~26 — 11/27은 청백전이라 없음)의 요일별 '참가자' 창 19개를 Claude in Chrome으로 읽음. 줄 수가 창 위 인원(23·11·24·9·4 / 16·7·26·6·10 / 19·16·26·13·7 / 22·5·26·4)과 모두 같음
  - 회원 이름 45개 모두 앱 명단에 한 명씩(빠진 사람 없음). 외부 참석자 6줄은 게스트로(이름·남/여는 밴드 글자에서, 데려온 사람 = 밴드의 '…님이 추가'). 돼장이 넣은 회원 2줄은 by_admin
  - 신청 시각은 밴드 시각, 같은 분은 밴드 순서대로 초를 1초씩. 그날 정원 = 밴드 최대 인원(19일). 이미 있는 줄은 건너뜀, 알림 안 만듦. 회원 268줄 + 게스트 6줄
  - 운영과 같은 복사본(#31 전 schema + 운영 묶음 + 11/30 주 + 11월 두 번 + 역할 묶음)에서 확인: 19일 모두 밴드와 같은 인원·정원, 대기 0, 알림 0, 두 번째는 추가 0
  - SQL Editor에 넣고 SHA-256 4625e46d…8348(만든 파일과 같음), 291줄 → 실행 → signups_list 11/2~12/4가 밴드와 같음(11/27은 쉬는 날 0/24). SQL은 실제 회원 id라 저장소에 안 올림
- **회원 역할 SQL(#39)**: GitHub raw(feat/member-roles)의 묶음 → SHA-256 083bade7…9e4a 확인 → 'destructive operations' 경고(함수 안 delete) → 실행. 공개 키로 확인: member_role_session·admin_operators·admin_set_operator 가짜 토큰 → unauthorized(함수 있음) · club_role 표 직접 읽기 401 · app_state rev 508 그대로
- **머지**: #39 merge(c8bc0e5) → #40에 main 합침(deploy-log만 충돌, 92·93 둘 다 남김) → 테스트 전부 통과 → #40 merge(f07bdbb) → #41 base를 main으로, main 합침(충돌 없음) → logic 155 · deploy 81 · tourney 17 · push 7 / roles 27 · members 43 · signups 49 → #41 merge
- #41 merge(869a4a0) → GitHub Pages c8bc0e5·f07bdbb·869a4a0 모두 success → 실제 사이트 index.html에 새 코드(대기 신청하기·내 정보 달력·출석왕·회원 역할·홈 내 이름·끝난 주 숨기기) 들어감, 관리 PIN 입력 칸 없음
- 운영 데이터로 계산한 11월 출석(11/2~11/26, 신청 완료만): 45명, 1위 김진호 17 · 2위 박복균 14 · 3위 김예슬 12 · 4위 이은미 11 · 공동 5위 조영재·박희수 10
