@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Dafegen Project Management - Local Start
echo ============================================
echo.
echo Note: this app is a single server that handles the
echo frontend UI and the backend API together - there is
echo no separate backend process. The database is a local
echo SQLite file (data\eaas-pm.db) opened directly by the
echo app, so there is no separate database server either.
echo.

if not exist node_modules (
  echo Installing dependencies for the first time - this can take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. See the errors above.
    pause
    exit /b 1
  )
)

if not exist .env.local (
  if exist .env.example (
    echo No .env.local found - copying it from .env.example...
    copy .env.example .env.local >nul
    echo Edit .env.local now if you want different admin credentials, then re-run this file.
  )
)

echo Starting the local server in a new window...
start "Dafegen PM - local server" cmd /k "npm run dev"

echo Waiting for it to come up...
ping -n 7 127.0.0.1 >nul

echo Opening http://localhost:3000 in your browser...
start "" http://localhost:3000

echo.
echo Done. Keep the "Dafegen PM - local server" window open while you use the app.
echo Close that window (or press Ctrl+C inside it) to stop the server.
endlocal
