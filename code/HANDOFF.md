# HANDOFF
Language rule: write all messages, comments and docs in ASD-STE100 Simplified Technical English.

## Status: Phase 8/8 — complete (local demo). See `README.md` for run, deploy, accounts and the demo script.
## Latest rebuild: two actors, national 7-province dataset, 20 demo incidents, 18 teams, single-unit dispatch, four-state incident lifecycle, 35 MB uploads, router 0.70/0.50 tiers, relational SQLite target model, one-sided CR-xx rules, seeded read-only tag catalog.
## Complete
- Phase 1: one FastAPI origin gives `/`, `/reporter/`, `/dispatch/`. Shared files are in `web/common/`.
- Phase 2: `server/ml_service.py` wraps `backend_ml/` (no change to its files). `/api/health` shows each weight file and the load status.
- Phase 3: SQLite 15-table domain model in `server/schema.sql` + append-only audit + server sessions. The server projects the JSON API for the existing frontend; `SkyRescueStore` still syncs through `sync-client.js`. SSE + 2 s polling.
- Phase 4: server Layer 1 check (`api_reports.py`): EXIF GPS, geofence (bounds ± 0.5°), capture time ≤ 30 min, UAV serial/make, browser GPS only as a fallback when EXIF GPS is missing, SHA-256 duplicate. DEMO_MODE presets are labelled `demo_preset`. Server citizen registration.
- Phase 5: report sync with an `uploadToken` starts a background ML job (`ml_jobs.py`). The server writes `aiResult`, image, metadata and the incident AI fields. Dispatch: live badges, Evidence Viewer with real boxes, DSS Trace (`web/dispatch/dss-trace.js`), "Re-run AI".
- Phase 6: two-actor single-unit lifecycle. C5 confirmation → incident `In Progress`, one team `On Mission`, dispatch order `Confirmed`. Dispatch "Finalize & Resolve" changes the incident to `Resolved`, the dispatch order to `Completed`, releases the team, and writes an audit event. The former rescue login and RT1–RT3 screens are removed.
- Phase 7: the national dataset and 7 province views switch on server data and both portals follow (tested). The map has the five document hazard-type filters, aggregates by province at national zoom, drills into a province, and plots only in-view incident markers. No layer toggles. All 20 images stay reachable in the queue (11 verified, 4 Review Inbox, 5 Resolved). Seed reports have the label "Seeded sample". VI entries for the new strings. The Reporter has no horizontal scroll at 390 px.
- Phase 8: `README.md`, AHP/EXIF/formula tests, national seed gate, E2E smoke, upload rate limit, measured RAM/latency.
- Phase 9: final demo hardening. The default queue tab is `Verified Incident Queue`. The Configuration rule modal creates one-sided `CR-xx` equality rules over the seeded tag catalog; the tag catalog is read-only and the misleading normalization text is removed. The reference delta is in `docs/AS_BUILT_RECONCILIATION.md`.
- Phase 10: feedback 1.1. Hybrid trust auto-verifies registered UAV/verified Specialist/CTV/identified Reporter after a valid high-confidence AI emergency; citizen reports always require Coordinator verification. Reporter Portal is note-only. C2 has a Unified Triage Workspace with one-click Verify & Confirm Dispatch and an Edit Type re-verification guardrail. Code Red uses 3 defense layers (confidence gates, disaster context, Golden Hour escalation at 45 min); AHP C1 keeps raw severity and the weights 0.648/0.230/0.122 and CR 0.003 are unchanged. Regression: 49 pytest relational + 49 pytest JSON + 10 Node + E2E PASS.

## Technical decisions
- No git and no commits. The user keeps the code local only.
- Deploy target: local Docker + Cloudflare Quick Tunnel (demo only, not 24/7). Quick Tunnel blocks SSE, so polling always runs.
- HF Docker Spaces need PRO since 07/2026. Do not use them.
- Default `DATA_BACKEND=relational`: the 15 domain tables in `server/schema.sql` are the as-built physical model; the final Data Dictionary/ERD is the logical orientation, reconciled in `docs/AS_BUILT_RECONCILIATION.md`. The server projects the existing JSON API for the frontend. `DATA_BACKEND=json` keeps the legacy one-document state as a separate fallback.
- The relational backend seeds its tables from `server/seed_state.json` on first start. `server/seed_state.json` was generated from `Demo.buildInitialState()`.
- Uploads and ML results are keyed by the upload token, not by the report id, because DEMO_RESET reuses report ids.
- A token binds one time, to one report id, for the user who uploaded it. The server overlays the server-owned fields on each write.
- AHP follows the 03/11 patch: farther nearest-team distance and fewer free teams raise priority. The JS `priorityScore` is a preview; the server AHP/TOPSIS snapshot is authoritative. AHP matches exact specialty and uses explicit TeamCoverage rows plus the 10 km rule. Golden Hour, clustering, coalition and equipment trimming are retired.
- Rate limits (in memory, 1 worker): login failures 10/min/IP, uploads 30/min/IP. `CF-Connecting-IP` is trusted only from localhost.
- torch 2.5.1 CPU: torch >= 2.6 changes the `torch.load` default (`weights_only=True`). The wrappers call `torch.load` without that argument.
- One inference at a time (semaphore). Timeout 60 s gives `status=failed`, `incidentType=Unclassified`.
- Remote SSE/polling updates wake both portals through `Sync.setRemoteHandler`; without it, the data refreshed but the DOM did not re-render.
- Pillow 11.0.0 (pinned) does not save sub-IFDs that `get_ifd()` made on a new image. The test helper `jpeg()` assigns the IFDs as dicts.

## File map
- `server/main.py` → app, lifespan (DB, model preload, ML worker), static mounts
- `server/config.py` → environment settings, ML weight paths
- `server/db.py` → backend switch, SQLite domain/auth/infra access, ops merge, audit, sessions, uploads, ML results
- `server/auth.py` → login/logout/register, session lookup, rate-limit counters
- `server/api_state.py` → `/api/boot.js`, `/api/state`, `/api/version`, `/api/sync`, `/api/events`
- `server/api_reports.py` → `/api/uploads` (Layer 1), `/media/{name}`, `/api/samples`, `/api/ml/rerun`
- `server/live_reports.py` → server-owned fields of live reports, token binding, AI → incident
- `server/ml_jobs.py` → background ML queue; `server/ml_service.py` → model load, `build_ai_result`, `predict`
- `server/exif.py` → EXIF reader
- `web/common/js/sync-client.js` → server sync adapter; `shared-state.js` → Store
- `server/schema.sql` → the 15-table target schema + infrastructure tables
- `server/relational.py` → SQLite relational repository and JSON projection/import
- `web/reporter/reporter.js` → upload, declaration, My Reports; `web/dispatch/dispatch.js` + `dss-trace.js`
- `tests/` → pytest (`test_api.py`, `test_reports.py`, `test_ml_contract.py`, `test_router_thresholds.py`, `test_ahp_priority.py`, `test_seed_dataset.py`), `test_formulas.test.mjs` (node), `e2e_smoke.mjs` (Playwright)
- `docs/ARCHITECTURE_RECONCILIATION.md` → target 15-table model vs JSON state, AHP doctrine, capacity, explicit TeamCoverage, override, finalization, national geofence and upload rules

## How to run and test
```
docker compose up -d --build                         # http://localhost:8000
docker compose exec app python -m pytest -q tests    # 49 passed (real models)
node --test 'tests/*.test.mjs'                       # 10 passed (AHP/EXIF/formulas/policy)
NODE_PATH=tests/e2e/node_modules node tests/e2e_smoke.mjs   # PASS (resets demo data)
cloudflared tunnel --url http://localhost:8000       # public demo URL
```

## Known problems and next steps
- A Reporter session can read all reports and can write all state keys. A role filter is necessary before real users.
  Decision for the user: the seed report owners (`USR-UAV-07`, ...) do not match the sign-in ids, so "My Reports" filtering changes the demo.
- `demo_samples/` contains the 20 `EXT01`–`EXT20` images. They seed 20 national incidents across 7 provinces. Their fixed EXIF times are stale; the Reporter sample picker keeps the EXIF GPS and labels only the simulated capture-time/source fields.
- `tryReverseGeocodeOnline` sends coordinates to Nominatim (prototype behaviour).
- The old tables `uploads` and `ml_jobs` stay in the existing Docker volume. They are not used.
- No `favicon.ico` (the prototype also has none).
