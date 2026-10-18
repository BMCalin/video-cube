@echo off
rem Video Cube launcher for Windows: double-click to start the app.
rem Installs or updates dependencies when needed, starts the dev server
rem and opens the app in your default browser.

setlocal
cd /d "%~dp0"
title Video Cube

where node >nul 2>nul
if errorlevel 1 goto no_node

echo Checking dependencies...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto install_failed

echo.
echo Starting Video Cube. Your browser will open in a moment.
echo Keep this window open while you use the app. Close it, or press Ctrl+C, to stop.
echo.
call npm run dev -- --open
goto end

:no_node
echo Node.js was not found.
echo Install Node.js 24 or newer from https://nodejs.org/ and run this file again.
pause
exit /b 1

:install_failed
echo.
echo Installing the dependencies failed. Check the messages above and your internet connection.
pause
exit /b 1

:end
endlocal
