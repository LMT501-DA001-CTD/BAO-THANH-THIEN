#!/usr/bin/env bash
# Install the CPU-only Python stack for the no-Docker SkyRescue runtime.
# Installs into the user site (~/.local), so no sudo is needed.
set -euo pipefail

PIP="python3 -m pip"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found" >&2
  exit 1
fi

BASE_ARGS="--user --break-system-packages"

echo "--- CPU torch/torchvision (PyTorch index) ---"
$PIP install $BASE_ARGS torch torchvision --index-url https://download.pytorch.org/whl/cpu

echo "--- server + ML stack ---"
$PIP install $BASE_ARGS \
  "fastapi>=0.115" "uvicorn>=0.32" "python-multipart>=0.0.20" "Pillow" \
  "numpy" "scipy" "pandas" "httpx" "pytest"

echo "--- opencv headless (avoid GUI/libGL) ---"
$PIP uninstall -y --break-system-packages opencv-python opencv-python-headless 2>/dev/null || true
$PIP install $BASE_ARGS --force-reinstall --no-deps opencv-python-headless

$PIP install $BASE_ARGS "ultralytics"

echo "--- sanity check ---"
python3 - <<'PY'
import cv2, numpy, pandas, torch, torchvision, ultralytics
print("torch", torch.__version__)
print("torchvision", torchvision.__version__)
print("cv2", cv2.__version__)
print("ultralytics", ultralytics.__version__)
print("yolo available:", torch.cuda.is_available() is False)
PY
