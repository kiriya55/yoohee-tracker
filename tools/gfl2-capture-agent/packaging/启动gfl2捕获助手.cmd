@echo off
chcp 65001 >nul
setlocal

rem --- 定位本脚本所在目录（解压后的助手根目录） ---
set "AGENT_DIR=%~dp0"
if "%AGENT_DIR:~-1%"=="\" set "AGENT_DIR=%AGENT_DIR:~0,-1%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未找到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)

node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
if errorlevel 1 (
  echo [ERROR] 需要 Node.js 20 或更高版本，当前版本：
  node --version
  pause
  exit /b 1
)

if not exist "%AGENT_DIR%\agent\dist\src\cli.js" (
  echo [ERROR] 找不到助手程序文件（agent\dist\src\cli.js）。
  echo 请确认压缩包已完整解压，且本脚本与 agent 文件夹在同一目录。
  pause
  exit /b 1
)

if not exist "%AGENT_DIR%\agent\node_modules\mockttp\package.json" (
  echo [ERROR] 缺少运行依赖（agent\node_modules）。压缩包可能已损坏，请重新下载并完整解压。
  pause
  exit /b 1
)

echo ============================================
echo   GFL2 本地捕获助手
echo   首次运行会在本机安装一个临时抓包证书，
echo   请在弹出确认时输入 y 回车同意。
echo   导入完成后直接关闭本窗口即可，证书和
echo   系统代理设置会自动还原。
echo ============================================
echo.

pushd "%AGENT_DIR%\agent" >nul
node dist\src\cli.js %*
set "AGENT_EXIT=%ERRORLEVEL%"
popd

if not "%AGENT_EXIT%"=="0" (
  echo.
  echo [ERROR] 助手异常退出，代码 %AGENT_EXIT%。
  pause
)
exit /b %AGENT_EXIT%
