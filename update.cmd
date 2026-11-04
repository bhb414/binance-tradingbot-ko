@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 이상이 필요합니다.
  pause
  exit /b 1
)
node.exe -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 이상이 필요합니다.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git for Windows 설치 후 다시 실행해 주세요.
  pause
  exit /b 1
)
node.exe tools/update.mjs
set "WORKROOM_UPDATE_EXIT=%errorlevel%"
pause
exit /b %WORKROOM_UPDATE_EXIT%
