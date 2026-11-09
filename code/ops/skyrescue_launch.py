"""SkyRescue no-Docker launcher.

Starts `server.main:app` with uvicorn and patches `torch.load` so the bundled full
checkpoints (YOLO .pt / .pth) load on CPU. Run it through ops/run_local.sh, which sets
the environment; APP_DIR defaults to the parent of the ops folder.
"""
import os
import sys

app_dir = os.environ.get(
    "APP_DIR",
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
)
if app_dir not in sys.path:
    sys.path.insert(0, app_dir)

try:
    import torch
    import torch.serialization

    _orig_load = torch.serialization.load

    def _patched_load(*args, **kwargs):
        # Demo models are full checkpoints; force legacy pickle loading.
        kwargs["weights_only"] = False
        return _orig_load(*args, **kwargs)

    torch.serialization.load = _patched_load
    torch.load = _patched_load
except Exception as exc:
    print(f"WARNING: could not patch torch.load: {exc}", file=sys.stderr)

import uvicorn


def _pidfile():
    """Write the server PID so ops/stop_local.sh can stop it."""
    pidfile = os.environ.get("SKYRESCUE_PIDFILE")
    if not pidfile:
        return
    try:
        os.makedirs(os.path.dirname(pidfile), exist_ok=True)
        with open(pidfile, "w", encoding="utf-8") as fh:
            fh.write(str(os.getpid()))
    except OSError:
        pass


if __name__ == "__main__":
    _pidfile()
    uvicorn.run(
        "server.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
        log_level="info",
    )
