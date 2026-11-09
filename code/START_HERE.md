# SkyRescue demo — quick start (Windows)

A local disaster-response demo. Two portals run on one server, and the AI models
run for real on your computer's CPU (no Docker).

The AI models run offline after setup. The optional Dispatch basemap uses online
OpenStreetMap tiles; without internet it shows a static fallback map.

## What you need

- Windows 10 or 11, 64-bit
- **Python 3.12** — download from <https://www.python.org/downloads/>
  and tick **"Add python.exe to PATH"** during installation.
  Python 3.13 will not work with the pinned CPU PyTorch wheels.
- About 4 GB of free disk space. Setup requires an internet connection once.

## Steps

1. **Extract this zip** into a normal folder, e.g. `C:\skyrescue-demo\`.
   Do not run it from inside the zip or a cloud-sync folder.
2. Double-click **`ops\setup_windows.bat`**. One time only.
   It creates `.venv` and downloads the CPU ML stack. Expect 5–15 minutes.
3. Double-click **`ops\run_windows.bat`**. Keep the window open.
   The model load takes about 5–10 seconds, then the server is ready.
4. Open <http://localhost:8000> in your browser.
5. In the Reporter portal, choose one of the 20 bundled sample images (`EXT01`–`EXT20`)
   or upload your own JPEG/PNG. The picker keeps the EXIF GPS inside Vietnam and
   labels any simulated capture-time/source fields.

| Portal | URL |
|---|---|
| Home | <http://localhost:8000/> |
| Dispatch workbench | <http://localhost:8000/dispatch/> |
| Reporter portal | <http://localhost:8000/reporter/> |

Demo accounts (public values):

| Portal | User | Password |
|---|---|---|
| Dispatch | `DISPATCH` | `Dispatch#2025` |
| Reporter | `REPORTER` | `Reporter#2025` |
| Reporter | `UAV07` | `Uav07#2025` |
| Reporter | `CTV01` | `Ctv01#2025` |
| Reporter | `CITIZEN` | `Citizen#2025` |

## Manual setup (VS Code / terminal)

If you prefer a terminal instead of the two `.bat` files:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\activate
python -m pip install -U pip
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
python ops\skyrescue_launch.py
```

Select `.venv\Scripts\python.exe` as the VS Code interpreter. Use
`ops\skyrescue_launch.py`, not plain `uvicorn`: it patches `torch.load` for the
bundled checkpoints.

## Stopping and resetting

- To stop: close the console window (or press `Ctrl+C` in it).
- Demo data (reports, uploads, incidents) lives in the `data\` folder.
  Deleting that folder resets the demo on the next start.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Python was not found" | Install Python 3.12 and rerun setup; tick "Add python.exe to PATH". |
| Setup says Python 3.12 is required | Install Python 3.12. Python 3.13 has no Windows wheel for the pinned CPU PyTorch. |
| Dependency installation failed | Check the internet connection, delete `.venv`, and rerun setup. |
| `8000` already in use | Close the other window, or set a port: run `set PORT=8010` before run_windows.bat. |
| Browser error on first open | Give the console a few seconds; wait until `Uvicorn running on http://0.0.0.0:8000`. |
| Firewall prompt | Allow access on private networks. The demo only listens locally. |
| Models load slow first time | CPU-only models take ~5 s; slower machines may take longer. |
| Map tiles do not load | The basemap needs internet. Everything else, including ML, works offline. |

## Linux / WSL alternative

If you prefer WSL or Linux, use the shell scripts. The Linux setup is unpinned, so
Python 3.12–3.14 can work; the tested version is 3.14.

```bash
ops/setup_local.sh      # install CPU stack into ~/.local
ops/run_local.sh --wait # start, wait until ML is loaded
ops/stop_local.sh
```

## What the demo includes

- Reporter uploads → server checks (EXIF/GPS, geofence, capture time, decode, GPS
  conflict, dHash) → real ML classification + people/pose → severity wrapper
- Hybrid trust: registered UAV / verified Specialist/CTV / identified Reporter
  auto-verify after a high-confidence emergency result with no flags; citizen reports
  always wait for Coordinator verification. Every dispatch still needs one human
  click in the C2 Unified Triage Workspace.
- Code Red: 3 defense layers — high AI confidence on a non-upright casualty or MCI
  count, confirmed disaster context, and Golden Hour escalation at 45 minutes. Code
  Red cases are pinned first while AHP C1 keeps the raw severity and the weights
  0.648/0.230/0.122 and CR 0.003 stay unchanged.
- National dataset: 20 incidents across 7 provinces. The map has the five document
  hazard-type filters, aggregates by province at national zoom, drills into a province,
  and plots only in-view incident markers when zoomed. No layer toggles. All 20 images
  stay reachable in the queue (11 verified, 4 Review Inbox, 5 Resolved), plus single-team
  matching, dispatch, audit log, and the coordinator's status-only Finalize & Resolve
  action. The SQLite physical model is in `server/schema.sql`; the delta from the final
  reference documents is in `docs/AS_BUILT_RECONCILIATION.md`. See `README.md` for the
  demo script.

## Notes

- All demo accounts and credentials are public demo values, not real ones.
- The AI output is advisory: reports always start Unverified until a Dispatch admin verifies them.
- To share the demo, build a clean zip with `python ops\package_share_zip.py`
  (or `ops\package_share_zip.bat`). Do not send `data\`, `logs\`, or `.venv\`.
