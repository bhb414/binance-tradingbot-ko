@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 이상이 필요합니다.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git for Windows 설치 후 다시 실행해 주세요.
  pause
  exit /b 1
)
node tools/update.mjs
pause
