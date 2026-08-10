@echo off
rem VEROX WhatsApp bridge — double-click to run on a Windows PC.
cd /d "%~dp0"
where node >nul 2>nul || (echo [!] Node.js not found. Install it from https://nodejs.org first. & pause & exit /b)
if not exist "node_modules" (echo Installing dependencies... & call npm install)
if not exist ".env" (echo [!] Create a .env file first ^(copy .env.example to .env and fill your keys^). & pause & exit /b)
echo Starting VEROX WhatsApp bridge on http://localhost:8787 ...
node server.js
pause
