@echo off
rem Build a clean SkyRescue share zip in dist\.
setlocal
cd /d "%~dp0\.."
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe ops\package_share_zip.py %*
) else (
  python ops\package_share_zip.py %*
)
echo.
pause
