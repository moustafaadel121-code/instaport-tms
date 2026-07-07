@echo off
title InstaPort TMS Server
echo.
echo  ================================
echo   InstaPort TMS - Starting...
echo  ================================
echo.
cd /d "%~dp0"
node server.js --dev
pause
