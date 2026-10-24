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
