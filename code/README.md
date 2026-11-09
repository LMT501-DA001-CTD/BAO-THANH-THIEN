# SkyRescue — local demo

Two web portals on one server:
- **Reporter** (`/reporter/`): UAV pilots, collaborators (CTV) and citizens send photo reports and track their status.
- **Dispatch** (`/dispatch/`): the coordinator verifies reports, matches one primary team, confirms dispatch and finalizes the case.

A photo goes through the server Layer 1 check (EXIF GPS, geofence, capture time, UAV serial, duplicate).
Then the ML pipeline in `backend_ml/` runs automatically (Model 1 scene class → Model 2 people and pose → severity wrapper).
Dispatch sees the report and the AI result without a page reload.

> **No-Docker recipients:** start with `START_HERE.md`. On Windows it needs Python 3.12 and uses
> `ops\setup_windows.bat` once, then `ops\run_windows.bat`.
>
> **Architecture decisions:** `docs/ARCHITECTURE_RECONCILIATION.md` defines the two-actor model,
> the 15-table physical model (`server/schema.sql`), the AHP doctrine and the single-unit dispatch.
> The delta between the final reference documents and the as-built demo is in
> `docs/AS_BUILT_RECONCILIATION.md`.
>
> **Backend selection:** `DATA_BACKEND=relational` is the default physical SQLite model.
> `DATA_BACKEND=json` keeps the legacy JSON-document demo as a separate fallback.

## 1. Run locally (Docker)

Requirement: Docker with Compose. Free RAM ≥ 1.5 GB.

```
docker compose up -d --build        # first build: approx. 10 min, image 2.23 GB
curl -s localhost:8000/api/health   # "loaded": true when the models are ready
```

Open http://localhost:8000. The data stays in the Docker volume `skyrescue-data` (SQLite + uploaded images).

Stop: `docker compose down`. The volume stays. To delete all data, also add `-v` (this cannot be undone).

### Run without Docker (full demo, real ML)

- **Windows:** see `START_HERE.md`. Use Python **3.12** (the pinned CPU PyTorch wheels have no
  Windows build for 3.13), run `ops\setup_windows.bat` once, then `ops\run_windows.bat`.
- **Linux / WSL:** run `ops/setup_local.sh`, then `ops/run_local.sh --wait`.
- **VS Code / manual:** use Python 3.12, install `requirements.txt`, then run
  `python ops/skyrescue_launch.py`. Do not use plain `uvicorn` with a newer PyTorch: the launcher
  patches `torch.load` for the bundled checkpoints.

To start without models (API tests only):
```
pip install fastapi==0.115.6 uvicorn==0.32.1 python-multipart==0.0.20 Pillow pytest httpx
ML_PRELOAD=0 DATA_DIR=./data python3 -m uvicorn server.main:app --port 8000
```
Without torch, each AI job ends as `Failed` → type `Unclassified` (fail-safe).

### Build a clean share zip
```
python ops/package_share_zip.py          # -> dist/skyrescue-demo-YYYYMMDD.zip
```
The builder keeps `START_HERE.md`, the model weights, the 20 demo images, `ops/`, `server/`, `backend_ml/`, `web/`, `docs/` and `tests/`.
It excludes `data/`, `logs/`, `.venv/`, caches, `node_modules/`, and the old `proto_*` folders.

### Priority ranking (AHP/TOPSIS)
Dispatch ranks all **active emergency** incidents with `backend_ml/ahp_topsis.py` through
`GET /api/ahp/priority?range=7d`. `Normal` and `Unclassified` rows stay in the queue but are not
AHP-ranked. `server/ahp_priority.py` adapts the demo's shared state to the module's database
schema: team type comes from the team name/equipment, team HQ comes from the dataset coordinates,
and a team covers every district within `COVERAGE_RADIUS_KM` (10 km) of its HQ.
The agreed 03/11 direction is used: farther nearest-team distance and fewer free teams raise priority.
The local `Store.priorityScore()` formula is an optimistic preview only; the server snapshot is
persisted at dispatch confirmation and is the score shown in the Digital Dossier.

## 2. Public demo URL (deploy)

The demo does not need 24/7 hosting. Primary method: run Docker on your computer and open a Cloudflare Quick Tunnel.
You need no Cloudflare account.

```
docker compose up -d
cloudflared tunnel --url http://localhost:8000
```
`cloudflared` shows a URL of the form `https://<random-words>.trycloudflare.com`. Send this URL to the demo users.
The URL stops when you stop `cloudflared`. Each start gives a new URL.

- Quick Tunnel does not support SSE. The app always polls `/api/version` every 2 s, so updates arrive in ≤ 2 s.
- The server trusts the `CF-Connecting-IP` header only from localhost (the tunnel). The rate limits use it.
- Optional: set `COOKIE_SECURE=1` in `docker-compose.yml` when you use only the HTTPS tunnel URL.

**Fallback: VPS with Docker** (≥ 2 GB RAM, 1 vCPU):
```
scp -r skyrescue/ user@<vps>:~/            # copy the project
ssh user@<vps> 'cd skyrescue && docker compose up -d --build'
```
Then put HTTPS in front of port 8000 (Caddy, nginx, or a named Cloudflare Tunnel) and set `COOKIE_SECURE=1`.

Hugging Face Docker Spaces need a PRO account since 07/2026. Free 512 MB hosting plans do not have sufficient RAM.

## 3. Settings (environment)

| Name | Default | Use |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `DATA_DIR` | `/data` | SQLite file and `media/` |
| `DEMO_MODE` | `true` | Allows the Demo Metadata Simulator presets (label "Simulated metadata (demo)") |
| `MAX_UPLOAD_MB` | `35` | Upload limit (JPEG/PNG only, magic-byte check) |
| `ML_PRELOAD` | `1` | Load the models at start |
| `ML_TIMEOUT_S` | `60` | Inference timeout. Timeout → `Failed` / `Unclassified` |
| `COOKIE_SECURE` | `0` | `Secure` flag on the session cookies |
| `MODEL1_PATH`, `MODEL2_PATH`, `FIRE_MODEL_PATH`, `COLLAPSED_MODEL_PATH`, `SKYRESCUE_FLOOD_CALIB_DIR` | files in `backend_ml/` | Model weights |

`SESSION_SECRET` is not necessary: sessions are random 256-bit tokens in the database, not signed cookies.

## 4. Demo accounts

These passwords are public demo values. They are also on the login pages.

| Portal | User | Password | Role |
|---|---|---|---|
| Dispatch | `DISPATCH` | `Dispatch#2025` | Dispatch admin |
| Reporter | `REPORTER` | `Reporter#2025` | UAV pilot (AEGIS-UAV-07) |
| Reporter | `UAV07` | `Uav07#2025` | Verified UAV source |
| Reporter | `CTV01` | `Ctv01#2025` | Verified collaborator |
| Reporter | `CITIZEN` | `Citizen#2025` | Unverified citizen |

The demo has two actors: Reporter and SAR Coordinator/Admin. Rescue teams and UAVs are operational
records, not login accounts; `RESCUE01` and the former RT1–RT3 field screens are removed.
Finalize & Resolve is a status change only; the database audit records it.

## 5. Demo script (approx. 10 minutes)

Use two browser windows (or two computers): Dispatch and Reporter.

1. **Dispatch** → sign in → Demo controls → "Reset Demo Data". The default is the national dataset (7 provinces); Configuration can switch to a province view.
2. **Reporter** (`REPORTER`) → R1 → Scan → connect `AEGIS-UAV-07`.
3. Upload a photo that is older than 30 minutes, or that has no GPS. The server rejects it (`UPLOAD_REJECTED` in the audit).
4. Upload a valid photo. Use one of the 20 bundled `EXT01`–`EXT20` sample images from `demo_samples/`, or a fresh JPEG/PNG of your own. The sample picker keeps the real EXIF GPS when it is inside Vietnam; stale capture time or missing source fields are clearly labelled as simulated.
5. **Dispatch** shows the report in ≤ 3 s (badge "Live upload"). The AI result arrives in approx. 1 s.
   Open "Review & Verify": the Evidence Viewer shows the real boxes, and the DSS Trace shows each pipeline tier.
6. In the C9R review screen, correct the incident type, severity and victim count, then "Verify Report".
   The incident becomes **Matching Team**. Then C4 Team Matching → select a team → C5 → confirm the dispatch.
   The incident becomes **In Progress** and the single assigned team becomes **On Mission** immediately.
7. **Dispatch** → open the incident → "Finalize & Resolve". The incident and the Reporter view show
   **Resolved**. There is no completion form or saved-person count; the status change is audited.
8. **Dispatch** → Audit Log: each step has its event and the actor from the server session. The
   Digital Dossier shows the server AHP priority snapshot and the single-unit Dispatch record.

## 6. Tests

```
docker compose exec app python -m pytest -q tests      # API, Layer 1, seed gate, upload flow, ML contract (real models)
node --test 'tests/*.test.mjs'                          # AHP priority/EXIF/formula vectors
npm install --prefix tests/e2e playwright-core@1.49.1   # one time, for the E2E smoke
NODE_PATH=tests/e2e/node_modules node tests/e2e_smoke.mjs
```
CAUTION: `e2e_smoke.mjs` resets the demo data on the target server. Use it only on a local server.
It needs `python3` with Pillow (it makes a test photo with EXIF) and Chromium (`CHROMIUM=/path/to/chromium`).

## 7. Measured values (local Docker, CPU only, WSL2)

| Item | Value |
|---|---|
| Docker image | 2.23 GB |
| Model load at start | 4.0 s |
| RAM, idle with models loaded | 592 MiB |
| RAM, after a full E2E run | 715 MiB |
| Inference for one photo (Model 1 + Model 2 + severity) | 368–431 ms |
| Upload → visible in Dispatch | 104–394 ms (SSE); ≤ 2 s with polling only |
| Upload → AI result in Dispatch | approx. 0.8 s |

These values are from one computer. Measure again on your target computer.

## 8. Model limits (read before the demo)

- **Training data.** Model 1 was trained on AIDER (aerial disaster photos). Model 2 was trained on C2A (aerial photos of people).
  Street-level or indoor photos give poor results. Example: a street photo of a bus gave Model 1 "Normal" (100 %) and 0 people.
- **Normal stop.** When P(Normal) ≥ 0.9, the pipeline stops after Model 1 (`stopped_normal`).
- **Flood fail-safe.** The flood severity needs one Upright person as a size reference. With no reference, the wrapper
  gives severity 1.0 and `needsReview`. Dispatch shows "Fail-safe · needs review". The coordinator must check the photo.
- **Traffic Accident.** The severity uses an assumed altitude of 12 m, because there is no flight telemetry.
- **Failure.** A model error or a 60 s timeout gives `status=failed` and type `Unclassified`. Verify stays locked until the
  coordinator selects a type. Dispatch can use "Re-run AI".
- The models never dispatch. Trusted sources (registered UAV, verified Specialist/CTV, verified identified Reporter) auto-verify only after a high-confidence emergency result with no review flags; citizen reports always wait for a Coordinator decision. Every dispatch still requires a human confirmation in the workspace.

## 9. Demo data

- `demo_samples/` contains the 20 `EXT01`–`EXT20` images from the external UAV set (`EXT20.jpeg`; its supplied README incorrectly says PNG). The images keep their real EXIF GPS and capture times. Do not use SVG files as ML input.
- The default dataset is national: 20 incidents across 7 provinces (Ho Chi Minh City, Ha Noi, Da Nang, Can Tho, Khanh Hoa, Lam Dong, Quang Nam). The tactical map follows the document filter set: Fire, Flood, Building Collapse, Traffic Accident and Unclassified. It shows active non-Normal incidents only (14) and aggregates by province at national zoom. Zooming in plots only the individual markers inside the viewport; clicking a province drills into it, with a back-to-national control. There are no layer toggles. All 20 images remain reachable in the queue: 11 verified, 4 unverified in the Review Inbox, and 5 in Resolved Cases.
- The queue defaults to 15 open incidents. A separate **Resolved Cases** tab holds the other 5. Every seeded incident uses the real matching EXT image.
- The rescue roster has 18 teams: 7 in Ho Chi Minh City and 11 national units. The 11 unit commanders are Le Minh Quang, Pham Chanh Phong, Nguyen Dang Khoi, Bui Huu Toan, Nguyen Huu Lam, Pham Cong Vinh, Phan Bao Long, Do Tan Tai, Nguyen Tai Loc, Tran Tuan Phat and Phung Thanh Do. TeamCoverage uses explicit province/district rows plus the 10 km seed rule.
- Configuration exposes the six seeded tags as a read-only catalog and supports one-sided `CR-xx` equality rules over those tags. AHP weights and upload/rate limits are shown read-only; the reference reconciliation is in `docs/AS_BUILT_RECONCILIATION.md`.
- The national geofence is an SRS bounding box. It also contains parts of Laos, Cambodia and China; it is not a precise national polygon. Hanoi is accepted and Bangkok is rejected in the release tests.
- Queue timestamps are relative so the demo stays fresh. The image files keep their real EXIF capture times; the two timelines are intentionally different.
- Phone numbers in the seed data are not real.

## 10. Known limits

- A Reporter session can read all reports and incidents (prototype behaviour of "My Reports"). The server owns only the
  AI, metadata and image fields of live uploads. Do not put real personal data in this demo.
- The national bounding box is coarse by design (SRS). Use a polygon or provincial union before a production deployment.
- The Reporter "reverse geocode" sends the photo coordinates to OpenStreetMap Nominatim (prototype behaviour).
- One server worker. The rate-limit counters are in memory.
