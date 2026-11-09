@echo off
rem Start the SkyRescue demo on Windows. Close this window to stop it.
setlocal
cd /d "%~dp0\.."

if not exist .venv\Scripts\python.exe (
  echo The virtual environment is missing. Run ops\setup_windows.bat first.
  pause
  exit /b 1
)

if not exist data mkdir data
if not exist data\media mkdir data\media
if not exist logs mkdir logs

set "ML_PRELOAD=1"
set "DATA_DIR=%CD%\data"
set "ML_DIR=%CD%\backend_ml"
set "SAMPLES_DIR=%CD%\demo_samples"
set "YOLO_AUTOINSTALL=False"
set "YOLO_OFFLINE=1"
set "ULTRALYTICS_OFFLINE=1"
set "MPLBACKEND=Agg"
set "HF_HUB_OFFLINE=1"
set "TRANSFORMERS_OFFLINE=1"
set "TOKENIZERS_PARALLELISM=false"
set "OMP_NUM_THREADS=4"
set "MKL_NUM_THREADS=4"
set "PYTHONUNBUFFERED=1"
set "PYTHONDONTWRITEBYTECODE=1"

echo Starting SkyRescue on http://localhost:8000 ...
echo First start takes about 5-10 seconds to load the models.
echo Leave this window open. Closing it stops the demo.
echo.
.venv\Scripts\python.exe -X faulthandler ops\skyrescue_launch.py
pause
