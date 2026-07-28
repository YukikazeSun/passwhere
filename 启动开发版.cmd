@echo off
setlocal
title 我密码呢 - 开发版启动器
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"
set "START_RESULT=%ERRORLEVEL%"
if not "%START_RESULT%"=="0" (
  echo.
  echo Startup failed with exit code %START_RESULT%.
  echo Keep this window open for diagnostics.
  pause
)
exit /b %START_RESULT%
