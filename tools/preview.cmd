@echo off
rem Fake-server preview (no real DB). See docs or the guide txt.
cd /d "%~dp0.."
where node >nul 2>nul || (echo [!] Node.js not found. Install LTS from https://nodejs.org and run again. & pause & exit /b 1)
node build.js || (pause & exit /b 1)
set MOCK_DEMO=1
set MOCK_TODAY=1
set PORT=8791
echo.
echo  Admin PIN: 1234   (operator PIN: set it in Admin - Settings)
echo  Phone on same Wi-Fi: http://[this PC IPv4 from ipconfig]:8791
echo  Close this window to stop. Data resets on next start.
echo.
start "" http://localhost:8791/
node tools\mock_supabase.js
pause
