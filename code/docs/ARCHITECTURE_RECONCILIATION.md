# SkyRescue architecture reconciliation

This note records the decisions for the relational demo. `server/schema.sql` is the
as-built physical model; the final Data Dictionary/ERD is the logical orientation. The
authoritative delta between the two is `docs/AS_BUILT_RECONCILIATION.md`; read it first.
The as-built JSON demo remains available with `DATA_BACKEND=json`.

## 1. Actors

There are two actors:

- **Reporter** — submits evidence through `/reporter/`.
- **SAR Coordinator / Admin** — verifies, matches, dispatches and finalizes through `/dispatch/`.

Rescue teams and UAVs are operational records, not login accounts. The former `RESCUE01`
field account and RT1–RT3 field screens are removed.

## 2. Report = operational incident

The 15-table model uses **one `Report` row per incident**. There is no separate `REP-*`
record in the relational demo. This is a documented demo limitation: the full product
would use separate evidence/submission records if multiple source reports per incident
were required.

Every public identifier uses an internal numeric primary key plus an immutable code:

| Relation | Internal key | Public code |
|---|---|---|
| `reports` | `report_id` | `report_code` (`INC-8801`) |
| `dispatches` | `dispatch_id` | `dispatch_code` (`DSP-2187`) |
| `rescue_teams` | `team_id` | `team_code` (`SAR-01`) |
| `uavs` | `uav_id` | `uav_code` (`AEGIS-UAV-07`) |

## 3. Relational tables and as-built projection

The 15 domain tables are in `server/schema.sql`:

`users`, `uavs`, `locations`, `rescue_teams`, `team_coverage`, `reports`,
`predictions`, `person_detections`, `dispatches`, `rules`, `tags`, `entity_tags`,
`system_config`, `audit_log`, `upload_attempts`.

The demo keeps its existing camelCase JSON API by projecting the tables into the same
shape. `payload_json` / `report_json` / `incident_json` columns preserve demo-only fields
without adding more domain tables. The shared `sessions` table, `media_uploads`,
`ml_results` and `app_meta` are **infrastructure**, not part of the 15-table domain model.

| Target relation | Physical source | Projection note |
|---|---|---|
| `User` | `users` | Reporter and dispatch accounts only. |
| `UAV` | `uavs` | Registered/inactive operation resource. |
| `Location` | `locations` | Sector rows; active region bounds live in `system_config`. |
| `RescueTeam` | `rescue_teams` | `capacity` is headcount; AHP derives deployable units as `floor(capacity / 4)` unless `deployableUnits` is present. |
| `TeamCoverage` | `team_coverage` | Explicit team coverage arrays for provincial units, plus the 10 km seed rule and the team's main area. |
| `Report` | `reports` | One row per operational incident; `report_code` is the public ID. |
| `Prediction` | `predictions` | 1:1 with Report; includes `final_severity_score`. |
| `PersonDetection` | `person_detections` | Pixel boxes and pose; UI `Non-Upright` is stored as target `Other`. |
| `Dispatch` | `dispatches` | One row per Report, `UNIQUE(report_id)`, no `team_role`, no completion fields. |
| `Rule` | `rules` | HC-02/03/04 and SC-01/03/04. |
| `Tag` | `tags` | Tag catalog. |
| `EntityTag` | `entity_tags` | Polymorphic report/team/location tags. |
| `SystemConfig` | `system_config` | Region, settings, counters, rule metadata. |
| `AuditLog` | `audit_log` | Append-only action history; actor from the session. |
| `UploadAttempt` | `upload_attempts` | Success/failure outcomes, error codes and media metadata. |

## 4. AHP policy

- **Input:** the coordinator-edited `severityScore` / target `final_severity_score`.
  AHP criterion C1 uses the **raw** value. `aiSeverityScore` remains immutable and no
  life-adjusted multiplier is applied.
- **Direction:** farther distance to the nearest qualifying team and fewer free qualifying
  teams both increase priority (underserved/isolated areas).
- **Scope:** all active emergency incidents, verified or unverified. `Normal` and
  `Unclassified` stay visible but are not AHP-ranked because they have no dispatchable
  emergency type.
- **Authority:** the Python AHP/TOPSIS engine is authoritative. The JavaScript linear
  formula is only an optimistic preview. At dispatch confirmation, the server snapshot is
  persisted with the dispatch and incident and is shown in the Digital Dossier.

Weights remain `0.648 / 0.230 / 0.122`; the pairwise matrix and consistency ratio are
unchanged. Code Red is a 3-layer operational pin above the AHP order:
high-confidence non-upright/MCI evidence, confirmed disaster context, and Golden Hour
escalation at 45 minutes. It does not change the AHP score or C1 input.

## 5. Team matching and dispatch

- Match score: `0.50 specialty + 0.35 distance + 0.15 capacity`.
- `capacity` is headcount; `max(4, people × 2)` is the required headcount.
- Hard constraints normally disqualify a team. The documented deadlock override is kept;
  its reason and actor are stored on the Dispatch row and in the audit log.
- **One verified incident is assigned to one primary rescue team.** No support teams,
  coalition, 550 m spatial clustering, Golden Hour decay, or equipment trimming.
- AHP matches the incident type to the exact team specialty. Dispatchable incidents must
  have an available matching team with TeamCoverage for the incident district; this is a
  release test, not an assumption.
- Confirming C5 sets the single team to `On Mission` and the incident to `In Progress`.
- Finalize & Resolve is a **status change only**: incident `Resolved`, Dispatch
  `Completed`, team `Available`, audited. There is no completion form and no saved-person
  or outcome field in Report & Export.
- Multi-hazard coalition coordination is future work.

## 6. Upload and Layer 1

- Maximum image size: **35 MB**.
- Geofence: the active region's **bounding box** (`regionMeta.coverageBounds`), with the
  existing margin. The national profile uses a coarse Vietnam bounding box. It also
  contains parts of Laos, Cambodia and China; the SRS requires a bounding box, so this is
  documented and tested (Hanoi accepted, Bangkok rejected), not presented as a precise border.
- Metadata precedence: **EXIF GPS first**; browser geolocation is only a fallback for
  missing EXIF GPS.
- Layer 1 is server-authoritative; the client checklist is a preflight preview.
- Failed attempts are written to `upload_attempts` with `error_code`; successful attempts
  link to the created Report.

## 7. Demo sample data

`demo_samples/` contains the 20 `EXT01`–`EXT20` images from the external UAV set. All 20
are JPEG (`EXT20.jpeg`; the supplied README's PNG line is stale).

The Reporter sample picker follows the agreed mixed policy:

1. keep the actual EXIF GPS when it is inside Vietnam;
2. replace only stale capture time and missing source fields, with an explicit
   **Simulated metadata (demo)** label.

The image and AI inference stay real. Uploading the file manually preserves the raw EXIF
path for integration testing.

The national seed maps one EXT image to one incident at its actual coordinates:

| Province | Images | Incidents |
|---|---|---|
| Ho Chi Minh City | EXT06, EXT13, EXT20 | 3 |
| Ha Noi | EXT04, EXT14, EXT17, EXT19 | 4 |
| Da Nang | EXT05, EXT15, EXT18 | 3 |
| Can Tho | EXT09, EXT10 | 2 |
| Khanh Hoa | EXT07, EXT08, EXT16 | 3 |
| Lam Dong | EXT01, EXT11 | 2 |
| Quang Nam | EXT02, EXT03, EXT12 | 3 |

The default queue is active-only (15 open incidents). Five resolved cases are in the
**Resolved Cases** tab. The tactical map follows the document: five hazard-type filters
(Fire, Flood, Building Collapse, Traffic Accident, Unclassified) and active non-Normal
incidents only (14). It aggregates by province while the viewport spans the country,
plots only in-view individual markers when zoomed, and drills into a province on click.
A back-to-national control clears the drill-down; zooming out also restores the national
province view. There are no layer toggles. All 20 images remain reachable in the queue:
11 verified, 4 in the Review Inbox, and 5 in Resolved Cases.

## 8. Backend selection

- `DATA_BACKEND=relational` (default) — SQLite 15-table domain model, JSON API projection.
- `DATA_BACKEND=json` — legacy JSON-document demo kept as a separate fallback.

The legacy fallback is intentionally separate; it is not evidence that the relational
schema is absent.
