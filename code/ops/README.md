# Project-local runtime for SkyRescue (no Docker)

Everything needed to run the demo on a normal machine. The Windows share package
uses Python 3.12. The Linux/WSL setup is unpinned, so newer Python versions can work
(tested on 3.14).

## Windows share package

- **Python 3.12 (64-bit) is required.** The pinned `torch==2.5.1+cpu` and
  `torchvision==0.20.1+cpu` wheels have no Windows build for Python 3.13.
- Recipients run `ops\setup_windows.bat` once, then `ops\run_windows.bat`.
- `START_HERE.md` is the recipient guide.
- VS Code / terminal users can create a 3.12 venv, install `requirements.txt`, and run
  `python ops\skyrescue_launch.py`. Do not use plain `uvicorn` with a newer PyTorch:
  the launcher patches `torch.load` for the bundled checkpoints.
- `DATA_BACKEND=relational` is the default: the SQLite tables in `server/schema.sql`
  are the source of truth. `DATA_BACKEND=json` keeps the legacy JSON demo as a fallback.

## Linux / WSL

### First-time setup

```bash
ops/setup_local.sh        # installs CPU torch, ultralytics, pandas, opencv-headless into ~/.local
```

### Run

```bash
ops/run_local.sh --wait   # start detached; --wait waits for ML readiness
```

- Open: `http://localhost:8000/` (Dispatch: `/dispatch/`, Reporter: `/reporter/`)
- Demo login: `DISPATCH` / `Dispatch#2025`
- Health check: `http://localhost:8000/api/health` → `"ml": {"loaded": true}`

### Stop

```bash
ops/stop_local.sh
```

Logs and pidfile live in `logs/`, demo state in `data/` (both ignored by Git).

## Build a clean share zip

```bash
python ops/package_share_zip.py
# or on Windows: ops\package_share_zip.bat
# -> dist/skyrescue-demo-YYYYMMDD.zip
```

The builder includes `START_HERE.md`, the model weights, the 20 `demo_samples/EXT*`
images, `docs/`, `ops/`, `server/`, `web/` and `tests/`. It excludes `data/`, `logs/`, `.venv/`, caches,
`node_modules/`, and the old `proto_*` folders. Always test a new zip on a clean
Windows machine before sending it.

## Notes

- `run_local.sh` exports offline flags for Ultralytics/Hugging Face so nothing tries to
  download models over the network.
- `skyrescue_launch.py` patches `torch.load(..., weights_only=False)` because the bundled
  checkpoints are full pickle checkpoints; data loading stays local to this project.
- To re-run only the ranks: `ML_PRELOAD=0 ops/run_local.sh --wait` starts fast, without models
  (predictions fail-safe to `Unclassified`).
- The Dispatch basemap uses online OpenStreetMap tiles. Without internet it shows a static
  fallback map; the rest of the demo, including ML, works offline.
