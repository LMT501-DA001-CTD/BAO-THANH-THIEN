FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    YOLO_OFFLINE=1 \
    DATA_DIR=/data \
    PORT=8000

WORKDIR /app
COPY requirements.txt .
# ultralytics pulls opencv-python (needs libGL). Replace it with the headless build.
RUN pip install --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple -r requirements.txt \
 && pip uninstall -y opencv-python \
 && pip install --force-reinstall --no-deps opencv-python-headless==4.10.0.84

COPY backend_ml/ backend_ml/
COPY server/ server/
COPY web/ web/
COPY demo_samples/ demo_samples/
COPY tests/ tests/

RUN useradd --create-home app && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
