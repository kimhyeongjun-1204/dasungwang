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
