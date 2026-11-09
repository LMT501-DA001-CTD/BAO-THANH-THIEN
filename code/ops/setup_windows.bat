@echo off
rem SkyRescue one-time setup for Windows: Python 3.12 venv + CPU ML stack.
setlocal
cd /d "%~dp0\.."
echo === SkyRescue Windows setup ===
echo.

rem The pinned CPU wheels (torch 2.5.1, torchvision 0.20.1) have no Windows
rem build for Python 3.13. Use Python 3.12 for this demo.
set "PY=null"
py -3.12 --version >nul 2>&1 && set "PY=py -3.12"
if "%PY%"=="null" python --version >nul 2>&1 && set "PY=python"
if "%PY%"=="null" (
  echo Python 3.12 was not found. Install Python 3.12 from python.org
  echo and tick "Add python.exe to PATH" during the install, then rerun this file.
  pause
  exit /b 1
)

%PY% -c "import sys; assert sys.version_info[:2] == (3, 12)" >nul 2>&1
if errorlevel 1 (
  echo Python 3.12 is required. The CPU PyTorch wheels have no Windows build
  echo for Python 3.13 or newer. Install Python 3.12 and rerun this file.
  pause
  exit /b 1
)

echo Using interpreter: %PY%
%PY% --version

echo Creating virtual environment .venv ...
%PY% -m venv .venv
if errorlevel 1 (
  echo Could not create the venv. Delete the .venv folder and retry.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat

echo Upgrading pip ...
python -m pip install --upgrade pip

echo Installing CPU PyTorch + demo dependencies (5-15 minutes) ...
python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection and retry.
  pause
  exit /b 1
)

echo Checking the CPU ML stack ...
set "YOLO_AUTOINSTALL=False"
set "YOLO_OFFLINE=1"
python -c "import cv2, torch, torchvision; print('torch', torch.__version__); print('torchvision', torchvision.__version__)"
if errorlevel 1 (
  echo The ML stack did not import. Delete .venv and rerun setup.
  pause
  exit /b 1
)

echo.
echo Setup complete. Start the demo with: ops\run_windows.bat
pause
