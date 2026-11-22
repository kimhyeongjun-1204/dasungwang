@echo off
rem 가짜 서버로 미리보기 (실제 DB와 무관). 더블클릭 → 브라우저에서 http://localhost:8791
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js가 없어요. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행하세요. & pause & exit /b 1)
node build.js || (pause & exit /b 1)
set MOCK_DEMO=1
set MOCK_TODAY=1
set PORT=8791
echo.
echo 관리 PIN 1234 / 진행 PIN은 관리 탭 - 설정에서 정하기
echo 휴대폰: 같은 와이파이에서 http://(이 PC의 IP):8791  (ipconfig 의 IPv4 주소)
echo 끝내려면 이 창을 닫으세요.
echo.
start "" http://localhost:8791/
node tools\mock_supabase.js
pause
