#!/usr/bin/env bash
# Start the SkyRescue demo without Docker (real ML models, CPU only).
# Usage: ops/run_local.sh [--wait [seconds]]
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
LOG="$LOG_DIR/server.log"
PIDFILE="$LOG_DIR/server.pid"
PORT="${PORT:-8000}"

export APP_DIR="$ROOT"
export SKYRESCUE_PIDFILE="$PIDFILE"
export PORT="$PORT"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

export PYTHONUNBUFFERED=1
export PYTHONDONTWRITEBYTECODE=1
export ML_PRELOAD="${ML_PRELOAD:-1}"
export DATA_DIR="$ROOT/data"
export ML_DIR="$ROOT/backend_ml"
export SAMPLES_DIR="$ROOT/demo_samples"

# CPU-only, fully offline stack for the ML models.
export YOLO_AUTOINSTALL=False
export YOLO_OFFLINE=1
export ULTRALYTICS_OFFLINE=1
export MPLBACKEND=Agg
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export TOKENIZERS_PARALLELISM=false
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-4}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-4}"

mkdir -p "$LOG_DIR" "$DATA_DIR" "$DATA_DIR/media"

port_pids() {
  ss -Hlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true
}

running() {
  [ -f "$PIDFILE" ] || return 1
  kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null
}

healthy() {
  local out
  out=$(curl -fsS --max-time 5 "http://localhost:$PORT/api/health" 2>/dev/null) || return 1
  python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if (d.get("ml") or {}).get("loaded") else 1)' <<<"$out"
}

if healthy; then
  echo "already ready on :$PORT"
  exit 0
fi

if running; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 2
fi
for pid in $(port_pids); do
  kill -9 "$pid" 2>/dev/null || true
done

: > "$LOG"
rm -f "$PIDFILE"

# Replace ourselves only after readiness checks: run the server far away from this
# shell so closing the terminal (or this script) cannot kill it.
setsid nohup env \
  ML_PRELOAD="$ML_PRELOAD" DATA_DIR="$DATA_DIR" ML_DIR="$ML_DIR" SAMPLES_DIR="$SAMPLES_DIR" \
  YOLO_AUTOINSTALL=False YOLO_OFFLINE=1 ULTRALYTICS_OFFLINE=1 MPLBACKEND=Agg \
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 TOKENIZERS_PARALLELISM=false \
  OMP_NUM_THREADS="$OMP_NUM_THREADS" MKL_NUM_THREADS="$MKL_NUM_THREADS" \
  PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
  SKYRESCUE_PIDFILE="$PIDFILE" APP_DIR="$ROOT" PORT="$PORT" \
  python3 -u -X faulthandler "$ROOT/ops/skyrescue_launch.py" \
  >>"$LOG" 2>&1 </dev/null &
disown || true

if [ "${1:-}" = "--wait" ]; then
  timeout="${2:-240}"
  for _ in $(seq 1 "$timeout"); do
    if healthy; then
      echo "READY: pid $(cat "$PIDFILE" 2>/dev/null || echo '?') on :$PORT"
      exit 0
    fi
    sleep 1
  done
  echo "TIMEOUT waiting for ML readiness; log: $LOG"
  tail -n 60 "$LOG"
  exit 1
fi

echo "starting on :$PORT (log: $LOG)"
echo "wait with: $0 --wait"
