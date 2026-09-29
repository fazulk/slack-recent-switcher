@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node
call npm ci
if errorlevel 1 goto failed
call npm run install:slack -- %*
if errorlevel 1 goto failed
echo.
echo Open Slack Recents from the Start Menu.
pause
exit /b 0
:missing_node
echo Install Node.js 22.12 or newer from https://nodejs.org, then run this installer again.
:failed
echo Installation did not complete. See the error above.
pause
exit /b 1
