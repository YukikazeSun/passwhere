@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Passwhere - Development Launcher
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"
set "START_RESULT=%ERRORLEVEL%"
if not "%START_RESULT%"=="0" (
  echo.
  echo Startup failed with exit code %START_RESULT%.
  echo Logs are available under output\start-dev.*.log.
  pause
)
exit /b %START_RESULT%
