# 처음에 틀렸다가 고친 것

| # | 처음 한 것 | 무엇이 틀렸나 | 고친 것 |
|---|---|---|---|
| 1 | `sw.js`에서 "다른 출처(origin)만 캐시하지 않으면 Supabase 요청은 안전"이라고 판단 | 로컬 가짜 서버처럼 API가 같은 출처에 있으면 `/rest/v1/app_state` 응답이 캐시에 들어감. 실제로 캐시 목록에서 확인했고, 서버를 끈 뒤 새로고침하자 캐시된 옛 데이터가 떴음 | `/rest|auth|storage|functions/v1/` 경로는 출처와 상관없이 가로채지 않게 함. 테스트(`deploy.test.js`)에도 추가 |
| 2 | `tools/mock_supabase.js`의 `send()`가 문자열이 아니면 모두 `JSON.stringify` | 정적 파일(Buffer)까지 JSON으로 바뀌어 깨지는 버그 (실행 전에 발견) | `Buffer.isBuffer`면 그대로 보냄 |
| 3 | `verify_db.js` 잠금 시험의 안내 문구를 "앞의 실패 1회는 초기화됨 → 새로 5회"로 씀 | 코드는 앞의 틀린 PIN 1회 + 4회 = 연속 5회로 세는데 문구가 반대로 설명함 | 문구를 "위의 틀린 PIN 1회 + 아래 4회 = 연속 5회"로 고침 |
| 4 | bash에서 `python tools/make_icons.py` 실행 | `python`이 Windows 스토어 별칭(WindowsApps\python.exe)이라 exit 49로 실패 | `py tools/make_icons.py`(Python 런처)로 실행, README에도 `py`로 적음 |
| 5 | 서버를 끈 직후 새로고침해서 "서버가 꺼져도 데이터가 뜬다"고 봄 | 종료 명령 직후 서버가 아직 응답하고 있었음 (`fetch`로 다시 확인하니 그다음부터 `Failed to fetch`) | 서버가 실제로 꺼진 것을 확인한 뒤 다시 시험 → '다시 시도' 화면 확인 |
| 6 | 서버가 꺼진 상태에서 저장 후 1.5초 만에 보고 "실패 배너가 안 뜬다"고 봄 | supabase-js가 몇 번 재시도하느라 실패가 늦게 옴 | 3.5초 뒤 다시 확인하니 `ui.saveError` 배너가 정상으로 뜸 |
| 7 | `save_state`에서 `new_state #- '{settings,pin}' - 'rev' - 'savedAt'`로 PIN·rev·savedAt을 한 줄에 지움 | PostgreSQL에서 `-`가 `#-`보다 우선순위가 높아서 `'{settings,pin}' - 'rev'`부터 계산하려다 `42725 operator is not unique: unknown - unknown`. 로컬 가짜 서버는 JS라 못 잡았고, 실제 DB의 `verify_db.js`에서 정상 저장이 실패해서 발견 | `((new_state #- '{settings,pin}'::text[]) - 'rev'::text) - 'savedAt'::text`로 괄호와 타입을 명시 |
