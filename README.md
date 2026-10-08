# 라켓뚱보단 다승왕전 웹앱

매주 수요일 다승왕전의 편성·결과 입력·조별 순위·내 기록을 보는 단일 페이지 앱.
배포본: https://claude.ai/artifact/X8D3DszEsU934JYtWzVVCW (Claude 아티팩트, 페이지가 자기 자신을 다시 저장하는 구조)

## 파일
| 파일 | 내용 |
|---|---|
| `logic.js` | 순수 로직: 자동 편성(hill-climbing), 승수 집계·순위, 지옥도/천국도 등급, 시드→실력 점수, 주차 점검, 밴드 명단 파싱 |
| `logic.test.js` | 로직 테스트 42개 (구현 전에 작성) |
| `app.js` | 화면 렌더링·이벤트 처리·저장(문서 재생성 후 publish) |
| `app.css` | 포스터 스타일 디자인 |
| `images.css` | 돼장·지옥도·천국도 이미지(WebP base64, 이벤트 포스터에서 잘라 냄) |
| `seed.js` | 최초 데이터 (그룹 편성표, 10/7 편성, 10/14 참석자) |
| `live_state.json` | 배포본에서 가져온 현재 데이터 스냅샷 (있으면 빌드에 이걸 씀) |
| `build.js` | 위 파일을 합쳐 `dist/dasungwang.html` 생성 |
| `dist/dasungwang.html` | 빌드 결과 (아티팩트에 올리는 파일) |

## 실행 (Windows, PowerShell)
```powershell
cd C:\dev\badmintion
node logic.test.js      # 테스트
node build.js           # dist\dasungwang.html 생성
```
Node.js만 있으면 되고 설치할 패키지는 없음.

## 주의
- 배포본에서 돼장이 저장한 결과·PIN·시드는 배포본 안에만 있음. 다시 빌드하기 전에 앱의 관리 › 설정 › 내보내기 › '전체 데이터 JSON'을 받아 `live_state.json`을 교체해야 최신 데이터가 유지됨.
- 시드는 화면에 안 보이게 인코딩만 함(암호화 아님).
- 규칙·결정 사항은 Claude 프로젝트 문서 '다승왕앱_설계메모', '기능정의서_충돌검토' 참고.
