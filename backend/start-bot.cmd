@echo off
REM Starts Abeddy's AI Assistant on this PC and shows its live log.
REM While this window is open the bot is running. Close the window to stop it.

title Abeddy Bot - RUNNING (close this window to stop)
cd /d "%~dp0"

REM Never run two copies: they would fight over the same WhatsApp login.
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul
if %errorlevel%==0 (
  echo.
  echo  The bot is already running on this PC.
  echo  Check it at http://localhost:3001/api/status
  echo.
  pause
  exit /b
)

if not exist "dist\index.js" (
  echo Building the bot for the first time...
  call npm run build || goto :failed
)

echo.
echo  Abeddy Bot is starting. Keep this window open.
echo  Status page: http://localhost:3001/api/status
echo.
node dist\index.js

:failed
echo.
echo  The bot has stopped. Scroll up to see why.
pause
