@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
if not exist server\generated\parcels.json (
  call npm run import:data
  if errorlevel 1 exit /b 1
)
echo Open http://127.0.0.1:43880 in your browser.
call npm start
pause
