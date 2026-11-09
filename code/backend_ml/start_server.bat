@echo off
chcp 65001 > nul
echo ============================================================
echo   🚀 KHỞI ĐỘNG SKYRESCUE AI FULLSTACK WEB SERVER
echo ============================================================
echo Đang kiểm tra thư viện...
python -m pip install -r requirements.txt
echo.
echo Đang khởi chạy máy chủ FastAPI tại http://localhost:8000 ...
python app.py
pause
