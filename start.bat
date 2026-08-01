@echo off
setlocal
rem Double-click this file to launch EQL Parser on Windows. It installs dependencies on first
rem run, builds the UI, opens your browser, and serves the app. Close the window to stop.
rem
rem The macOS twin is start.command; keep the two in step.

cd /d "%~dp0"

if "%EQL_PORT%"=="" set "EQL_PORT=8787"
set "URL=http://localhost:%EQL_PORT%"

rem `where` is the Windows `command -v`. Node ships npm, so one check covers both.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Every npm call needs `call`, or the batch file exits at the first one: npm is itself a
rem .cmd, and cmd.exe hands control over rather than returning without it.
if not exist "node_modules" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo Building the interface...
call npm run build:web
if errorlevel 1 (
  echo UI build failed.
  pause
  exit /b 1
)

rem Open the browser a moment after the server comes up. Detached, so it can wait while the
rem server takes the foreground below.
rem
rem The URL is deliberately left unquoted: `cmd /c "..."` mis-parses nested quotes, and our URL
rem has no spaces to need them. `ping` rather than `timeout` because timeout aborts outright
rem when stdin is redirected, which it is inside a detached cmd.
start "" /b cmd /c "ping -n 5 127.0.0.1 >nul & start %URL%"

echo.
echo   EQL Parser running at %URL%
echo   Close this window to stop.
echo.

node --import tsx src/index.ts
rem If the server exits on its own, hold the window open so the error stays readable.
pause
