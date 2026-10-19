# 라켓뚱보단 다승왕전 웹앱

매주 수요일 다승왕전의 편성·결과 입력·조별 순위·내 기록을 보는 단일 페이지 앱.
- 화면: GitHub Pages (정적 파일, push하면 GitHub Actions가 테스트 → 빌드 → 배포)
- 데이터: Supabase Postgres 1행(`app_state`). 누구나 읽기만 가능, 저장은 관리자 PIN으로 받은 토큰이 있을 때 RPC로만
- 휴대폰에서 '홈 화면에 추가'하면 주소창 없이 앱처럼 열림(PWA)
- 예전 배포본(Claude 아티팩트): https://claude.ai/artifact/X8D3DszEsU934JYtWzVVCW

## 파일
| 파일 | 내용 |
|---|---|
| `logic.js` | 순수 로직: 자동 편성(hill-climbing), 승수 집계·순위, 지옥도/천국도 등급, 시드→실력 점수, 주차 점검, 밴드 명단 파싱 |
| `logic.test.js` | 로직 테스트 43개 |
| `app.js` | 화면 렌더링·이벤트 처리. 저장은 `remote.js`를 통해 Supabase로 |
| `remote.js` | Supabase 읽기/RPC 호출, 관리자 토큰(30일) 보관, 에러 구분(`stale_rev`, `unauthorized`, `no_pin` …) |
| `config.js` | Supabase Project URL과 anon(publishable) key. **공개돼도 되는 값만** |
| `deploy.test.js` | 배포 관련 테스트(remote.js, 빌드 결과, service worker) |
| `app.css`, `images.css` | 포스터 스타일 디자인, 이미지(WebP base64) |
| `build.js` | 위 파일을 합쳐 `dist/`(index.html, config.js, sw.js, manifest, 아이콘) 생성 |
| `manifest.webmanifest`, `sw.js`, `icons/` | 홈 화면 앱 설정, 최소 service worker, 아이콘(돼장 이미지로 생성: `py tools/make_icons.py`) |
| `supabase/schema.sql` | DB 테이블·권한·함수. SQL Editor에서 실행 |
| `seed_db.js` | `live_state.json` → `seed.local.sql`(초기 데이터 SQL, PIN 해시 제외). 로컬 전용 |
| `verify_db.js` | 실제 Supabase에 anon 권한으로 접속해 권한·로그인·저장 규칙 확인 |
| `seed.js` | 최초 예시 데이터 (live_state.json이 없을 때) |
| `tools/mock_supabase.js` | 로컬 화면 확인용 가짜 Supabase (개발 전용, PIN 1234) |
| `docs/deploy-log.md` | 실제로 실행한 명령과 출력 기록 |

`live_state.json`, `seed.local.sql`, `.env`, `dist/`는 `.gitignore` 대상이에요. 실제 부원 데이터는 저장소에 올리지 않아요.

## 처음 설치 (Windows, 한 번만)

### 1. Supabase 프로젝트 만들기
1. https://supabase.com 접속 → 오른쪽 위 **Start your project** (GitHub 계정으로 로그인하면 편해요)
2. **New project** → Organization 선택 → Project name `dasungwang` → **Database Password**는 **Generate a password** (따로 쓸 일은 없지만 비밀번호 관리자에 저장) → Region **Northeast Asia (Seoul)** → **Create new project**
3. 1~2분 기다리면 프로젝트 화면이 열려요

### 2. DB 만들기 (SQL Editor)
1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. 이 폴더의 `supabase\schema.sql` 내용을 전부 붙여 넣고 **Run** → `Success. No rows returned`
3. 초기 데이터 SQL 만들기 (PowerShell):
   ```powershell
   cd C:\dev\badmintion
   node seed_db.js
   Get-Content seed.local.sql -Raw | Set-Clipboard
   ```
4. SQL Editor에서 **New query** → 붙여 넣기(Ctrl+V) → **Run** → 아래 결과 표에 `rev 7`, `has_pin false`가 보이면 성공
5. 관리 PIN 정하기: **New query**에 아래 한 줄을 쓰고 `1234` 자리에 **새 PIN 4자리**를 넣어 **Run** → `PIN 설정 완료`
   ```sql
   select public.set_admin_pin('1234');
   ```
   - **예전 아티팩트에서 쓰던 PIN은 쓰지 마세요.** 그 PIN의 해시는 공개 페이지 안에 있어서 누구나 알아낼 수 있어요.
   - 이 쿼리는 저장(Save)하지 말고 탭을 닫으세요.

### 3. URL·anon key 복사 → `config.js`
1. 프로젝트 화면 위쪽 **Connect** 버튼(또는 왼쪽 아래 **Project Settings** → **API Keys**)
2. **Project URL**(`https://xxxx.supabase.co`)과 **anon public** 키(`eyJ…`) 또는 **Publishable key**(`sb_publishable_…`)를 복사
3. `config.js`의 `url`, `anonKey`에 붙여 넣고 저장
   - **service_role / secret 키는 절대 넣지 마세요.** (그 키는 모든 권한을 가져요)

### 4. DB 검증
```powershell
node verify_db.js
```
PIN을 물어보면 2-5에서 정한 PIN을 입력(화면에 안 보임). 저장 시험 때문에 rev가 1 올라가요(데이터 내용은 그대로).

### 5. GitHub 저장소 만들기 → push
1. https://github.com/new → Repository name `dasungwang` → **Public** (무료 계정의 GitHub Pages는 공개 저장소만 가능) → README 추가 체크하지 말고 **Create repository**
2. PowerShell:
   ```powershell
   cd C:\dev\badmintion
   git remote add origin https://github.com/<내 계정>/dasungwang.git
   git push -u origin main
   ```

### 6. Pages 설정
1. 저장소 → **Settings** → 왼쪽 **Pages** → Build and deployment의 **Source**를 **GitHub Actions**로
2. **Actions** 탭에서 `Deploy to GitHub Pages`가 초록색이 되면 주소: `https://<내 계정>.github.io/dasungwang/`
3. 실패하면 Actions 탭에서 빨간 줄을 눌러 어느 단계(테스트/빌드/배포)에서 멈췄는지 확인

### 7. 휴대폰 홈 화면에 추가
- 아이폰(Safari): 주소 열기 → 공유 버튼 → **홈 화면에 추가**
- 안드로이드(Chrome): 주소 열기 → ⋮ 메뉴 → **홈 화면에 추가** (또는 '앱 설치')

## 평소 사용 · 수정
```powershell
cd C:\dev\badmintion
node logic.test.js      # 로직 테스트
node deploy.test.js     # 배포 테스트 (빌드도 함께 실행)
node build.js           # dist\ 생성
node tools\mock_supabase.js   # 로컬 확인: http://localhost:8787 (가짜 데이터, PIN 1234)
git add -A; git commit -m "수정 내용"; git push   # push하면 자동 배포
```
Node.js만 있으면 되고 설치할 패키지는 없어요.

## 저장·보안 규칙
- 저장은 `save_state(token, state, expected_rev)` RPC로만. 다른 곳에서 먼저 저장했으면 `stale_rev` → 최신 버전을 불러오고 '내 변경 불러오기/버리기' 안내가 떠요.
- PIN은 서버에 bcrypt 해시로만 있고(`admin_secret`), 공개 state에는 PIN 정보가 없어요. 저장할 때 `settings.pin`을 보내도 서버가 버려요.
- PIN이 맞으면 30일짜리 토큰을 발급해 이 기기에 기억해요. 토큰이 만료되거나 PIN이 바뀌면 다시 PIN 입력 화면이 떠요.
- PIN을 바꾸면 지금 기기를 뺀 다른 기기의 관리자 로그인이 모두 풀려요.
- 로그인 실패 잠금은 없어요(2026-10-19 운영 판단). 4자리 PIN은 경우의 수가 1만 개뿐이라, 누가 프로그램으로 계속 넣어 보면 뚫릴 수 있다는 점은 알고 쓰기로 했어요. 이상한 저장이 보이면 바로 PIN을 바꾸세요(바꾸면 다른 기기 로그인은 모두 풀려요).
- 잊었을 때: SQL Editor에서 `select public.set_admin_pin('새PIN');` (모든 관리자 로그인도 초기화)
- 시드(실력 순위)는 공개 state 안에 화면에 안 보이게 인코딩만 돼 있어요(암호화 아님).

## Supabase 무료 플랜: 비활성 일시정지 (2026-10-19 확인)
- 무료 플랜 프로젝트는 **7일 동안 활동이 적으면 일시정지**될 수 있어요. 하루에 몇 번 정도 DB 요청이 있으면 보통 괜찮아요.
- 정지 약 1주일 전 경고 메일, 정지되면 확인 메일이 와요. 경고 메일을 받으면 대시보드에서 프로젝트를 한 번 열거나 앱을 열면 돼요.
- 정지되면 앱이 '데이터를 불러오지 못했어요'를 보여요. 대시보드 → 프로젝트 → **Resume project**로 되살리면 데이터·설정이 그대로 돌아와요(공식 문서 기준 정지 후 최대 1년까지 복원 가능).
- 시즌 중에는 매주 앱을 쓰니까 정지될 가능성은 낮아요. 시즌 사이 쉬는 기간에 정지될 수 있어요.
- 출처: https://supabase.com/docs/guides/platform/free-project-pausing

## 참고
- 규칙·결정 사항은 Claude 프로젝트 문서 '다승왕앱_설계메모', '기능정의서_충돌검토' 참고.
