@echo off
setlocal
cd /d "%~dp0.."
if not exist node_modules call npm install
start "Hot 100 Study Planner" cmd /c "npm run dev -- --host 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:5173
endlocal
