@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 이상을 설치한 후 다시 실행해 주세요.
  pause
  exit /b 1
)
node.exe -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 이상이 필요합니다.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist "server.mjs" goto incomplete
if not exist "package.json" goto incomplete
node.exe -e "console.log('Futures Workroom v'+require('./package.json').version)"
node.exe server.mjs --open 2>startup-error.log
set "WORKROOM_START_EXIT=%errorlevel%"
if "%WORKROOM_START_EXIT%"=="0" goto finished
echo.
echo 실행 오류가 발생했습니다. 아래 내용 또는 startup-error.log를 확인해 주세요.
type startup-error.log
:finished
pause
exit /b %WORKROOM_START_EXIT%
:incomplete
echo ZIP을 전부 압축 해제한 폴더에서 run.cmd를 실행해 주세요.
pause
exit /b 1
