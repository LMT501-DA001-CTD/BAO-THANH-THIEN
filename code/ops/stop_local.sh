#!/usr/bin/env bash
# Stop the locally running SkyRescue demo server.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
PIDFILE="${SKYRESCUE_PIDFILE:-$LOG_DIR/server.pid}"
PORT="${PORT:-8000}"

stopped_any=0

if [ -f "$PIDFILE" ]; then
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
    stopped_any=1
  fi
  rm -f "$PIDFILE"
fi

# Also clear anything else already listening on the demo port.
for pid in $(ss -Hlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
  kill -9 "$pid" 2>/dev/null || true
  stopped_any=1
done

[ "$stopped_any" = 1 ] && echo "stopped" || echo "was not running"
