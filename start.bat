@echo off
setlocal
set "ROOT=%~dp0"
set "BUNDLED=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

where python >nul 2>&1
if not errorlevel 1 (
  python "%ROOT%server.py" %*
  exit /b %errorlevel%
)

where py >nul 2>&1
if not errorlevel 1 (
  py "%ROOT%server.py" %*
  exit /b %errorlevel%
)

if exist "%BUNDLED%" (
  "%BUNDLED%" "%ROOT%server.py" %*
  exit /b %errorlevel%
)

echo Pythonが見つかりません。Python 3.10以降をインストールしてください。
exit /b 1
