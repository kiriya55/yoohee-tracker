@echo off
setlocal

set "REPO_ROOT=%~dp0"
set "AGENT_DIR=%REPO_ROOT%tools\gfl2-capture-agent"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required, but node was not found.
  echo Install Node.js from https://nodejs.org/ and run this script again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js with npm enabled.
  pause
  exit /b 1
)

node -e "if (Number(process.versions.node.split('.')[0]) ^< 20) process.exit(1)"
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required.
  node --version
  pause
  exit /b 1
)

if not exist "%AGENT_DIR%\package.json" (
  echo [ERROR] Could not find tools\gfl2-capture-agent\package.json.
  echo Run this script from a complete Yoohee Tracker checkout.
  pause
  exit /b 1
)

pushd "%AGENT_DIR%" >nul
if not exist "node_modules\mockttp\package.json" (
  echo Installing capture agent dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    popd
    pause
    exit /b 1
  )
)

echo Starting GFL2 Local Capture Agent...
echo Keep this window open while importing records in Yoohee Tracker.
echo.
call npm start -- %*
set "AGENT_EXIT=%ERRORLEVEL%"
popd

if not "%AGENT_EXIT%"=="0" (
  echo.
  echo [ERROR] Capture agent exited with code %AGENT_EXIT%.
  pause
)
exit /b %AGENT_EXIT%
