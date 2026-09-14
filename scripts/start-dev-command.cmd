@echo off
chcp 65001 >nul
call "%PASSWHERE_VSDEVCMD%" -arch=x64
if errorlevel 1 exit /b %errorlevel%
cd /d "%PASSWHERE_PROJECT_ROOT%"
call npm.cmd run tauri dev
exit /b %errorlevel%
