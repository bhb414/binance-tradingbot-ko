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
node.exe -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 이상이 필요합니다.');process.exitCode=1}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist "repair.ps1" (
  echo 복구 ZIP의 repair.cmd와 repair.ps1을 둘 다 run.cmd 옆에 넣어 주세요.
  pause
  exit /b 1
)
rem Keep the final command on one line: the release may replace these files.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair.ps1" & call set "WORKROOM_REPAIR_EXIT=%%errorlevel%%" & pause & call exit /b %%WORKROOM_REPAIR_EXIT%%
