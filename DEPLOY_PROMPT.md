# 다승왕 앱 외부 배포 — claude.ai 아티팩트 → Supabase + GitHub Pages

## 배경
- 프로젝트 폴더: `C:\dev\badmintion` — README.md부터 읽어줘. 배드민턴 클럽 수요 다승왕전용 단일 페이지 앱(편성·결과 입력·조별 순위·내 기록).
- 지금은 claude.ai 아티팩트로 배포돼 있어. 저장할 때 페이지가 `api.artifact.publish(buildDoc(next))`로 자기 HTML 전체를 다시 올리는 구조야(app.js의 `save()`, `buildDoc()`). 상태는 HTML 안 `<script id="state">` JSON에 들어 있어. 이 저장 방식은 claude.ai 밖에서는 동작하지 않아.
- 목표: 내 주소로 배포하고, 돼장의 결과 저장은 계속 되게 하고, 휴대폰에서 홈 화면에 추가하면 주소창 없이 앱처럼 열리게. **빠르게, 화면과 로직 변경은 최소로.**
- 깨면 안 되는 것: logic.js 순수 로직, 이번 주·순위·내 기록·관리 화면과 문구·디자인, rev 기반 충돌 처리(`draftConflict`), 임시저장(draft), 저장 실패 배너(`ui.saveError`), 관리자 30일 기억.

## 구성 (이걸로 확정)
- 정적 호스팅: GitHub Pages (GitHub Actions로 배포)
- 데이터: Supabase Postgres. 브라우저에서 supabase-js(CDN, 버전 고정)로 호출
- 별도 서버 코드 없음. 쓰기는 전부 Postgres 함수(RPC, `SECURITY DEFINER`)로만.

## DB 설계
- `app_state(id int primary key default 1, state jsonb, rev int, saved_at timestamptz)` — 1행만. RLS로 anon은 SELECT만.
- `admin_secret(id int primary key, pin_hash text)` — pgcrypto `crypt()`(bcrypt). anon 접근 불가.
- `admin_session(token uuid primary key, expires_at timestamptz)` — anon 직접 접근 불가.
- 로그인 실패 기록용 테이블 — 연속 5회 실패하면 10분 잠금. 4자리 PIN이라 무차별 대입 방지가 필수야.
- 함수:
  - `admin_login(pin text) returns uuid` — PIN이 맞으면 30일짜리 토큰 발급.
  - `save_state(token uuid, new_state jsonb, expected_rev int) returns int` — 토큰이 유효하고 `rev = expected_rev`일 때만 저장하고 새 rev를 반환. 아니면 구분 가능한 에러(`unauthorized`, `stale_rev`).
  - `change_pin(token uuid, old_pin text, new_pin text)`.
- 공개 state JSON에는 `settings.pin`(salt/hash)을 넣지 마. 누구나 읽을 수 있는 곳에 4자리 PIN 해시가 있으면 바로 역산돼.
- 초기 데이터: `live_state.json`(현재 배포본 데이터, rev 7)을 `app_state`에 넣는 로컬 스크립트. PIN은 내가 직접 정해서 넣을 수 있게 안내해 줘.

## 프론트 변경
1. `build.js`가 `dist/index.html`을 완전한 문서로 만들게(doctype, charset, viewport, theme-color, manifest, 아이콘). `<script id="state">` 대신 시작할 때 Supabase에서 읽고, 로딩 표시와 실패 시 다시 시도 안내를 넣어.
2. `save()`: publish 대신 `save_state` RPC 호출. `stale_rev`면 기존 충돌 UI(`draftConflict`)를 그대로 쓰고, 실패는 기존 `ui.saveError` 배너로.
3. PIN 잠금 해제·생성·변경: 브라우저 안 해시 비교(`pinHash`) 대신 RPC. 토큰은 localStorage에 30일 보관(읽기·쓰기는 try/catch). 만료되거나 무효면 다시 PIN 입력 화면.
4. Supabase URL과 anon key는 `config.js`로 분리. anon key는 공개돼도 되는 키야. service_role 키는 절대 프론트나 저장소에 넣지 마.
5. 홈 화면 앱(PWA):
   - `manifest.webmanifest` — name "라켓뚱보단 다승왕전", short_name "다승왕", display standalone, start_url, 색상
   - 아이콘 192/512 — images.css의 `--img-pig`(돼장 이미지)로 생성
   - 최소 service worker — index.html은 network-first, Supabase 요청은 캐시 금지
   - iOS용 apple-touch-icon과 meta 태그
6. 이미지는 지금처럼 base64 그대로 둬도 돼(빠른 배포 우선).

## 저장소
- `.gitignore`에 `live_state.json`, `*.bak.json`, `.env`를 추가해. 실제 부원 이름과 PIN 해시가 들어 있어서 초기 데이터 넣기는 로컬에서만 해.
- GitHub Actions: push하면 `node logic.test.js` → `node build.js` → Pages 배포. 테스트가 실패하면 배포하지 않게.
- Supabase 무료 플랜의 비활성 일시정지 정책을 확인해서 README에 적어 줘.

## 내가 직접 해야 하는 단계
계정 만들기나 키 확인처럼 네가 못 하는 단계에서는 멈추고, 윈도우 기준 클릭 순서를 알려줘: Supabase 프로젝트 생성, SQL Editor에서 실행, URL·anon key 복사, GitHub 저장소 생성, Pages 설정.

## 검증 (테스트 먼저 작성)
- 구현 전에 실패하는 테스트부터 만들어. `logic.test.js` 43개는 계속 통과해야 해.
- DB 검증 스크립트(`node verify_db.js`)로 아래를 실제로 실행해서 확인:
  - anon이 `app_state`를 직접 UPDATE/INSERT하면 거부
  - anon이 `admin_secret`, `admin_session`을 읽으면 거부
  - 틀린 PIN 로그인은 실패하고, 5회 실패하면 잠금
  - 오래된 rev로 저장하면 `stale_rev`
  - 유효한 토큰과 최신 rev로 저장하면 성공하고 rev가 1 증가
  - 공개 state에 `settings.pin`이 없음
- 브라우저 확인:
  - 360px 폭에서 이번 주·순위·내 기록·관리 화면
  - 저장한 뒤 새로고침해도 유지
  - 두 탭에서 동시에 저장하면 충돌 안내가 뜸
- 결과는 `docs/deploy-log.md`에 실제로 실행한 명령과 출력만 기록해(추정치 금지). 네가 처음 제안했다가 틀려서 고친 부분은 `docs/wrong-answers.md`에 따로 적어.

## 진행 방식
- 먼저 README.md, build.js, app.js의 `save()` / `buildDoc()` / `viewLock()` / PIN 처리 부분을 읽고, 바꿀 파일 목록과 순서를 5줄 이내로 보여준 다음 바로 진행해.
- 기존 화면 디자인과 문구는 바꾸지 마.
- 명령어는 PowerShell 기준으로.
