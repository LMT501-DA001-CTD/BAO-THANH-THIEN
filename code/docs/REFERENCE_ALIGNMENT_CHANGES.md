# Reference Alignment Checklist — SkyRescue demo (05 Nov 2026 + 08 Nov 2026 addendum)

The running demo is the as-built truth. The reference documents are orientation. Use this checklist to make the reference describe the demo, not to change the demo back to the old reference.

Status key:

- `[x]` already applied in `all_finalize_aligned_20261105.zip`
- `[ ]` still to apply

Paths:

- `all_finalize.zip/all_v2/SkyRescue_Requirements_Specification_v1_0.docx`
- `all_finalize.zip/all_v2/SkyRescue_Relational_Schema.docx`
- `all/GROUP5_DATA_DICTIONARY.docx`
- `all/Context_diagram_v2.png`, `all/usecase_v2.png`, `all/Swimlane Dispatch Decision Update.png`
- `all/SkyRescue_DFD_Level1_Level2_v4.pdf`
- `HuongDan_ChucNang_Web_Dispatch.docx`, `HuongDan_ChucNang_Web_Reporter.docx`
- `MoTaBackEnd.docx`, `Stakeholder_Requirements_Scope_v0.3.docx`
- `SkyResc/SKYRESCUE_CLAUDE_CODE_PROMPT.md`

---

## A. Requirements Specification

File: `all_finalize.zip/all_v2/SkyRescue_Requirements_Specification_v1_0.docx`

### A1. Add the as-built addendum `[x]`

Insert before “1. System Scope Statement”:

> As-built reconciliation — 05 November 2026
>
> This section supersedes older wording where it differs. It describes the demo that is actually running.

Include the deltas from `docs/AS_BUILT_RECONCILIATION.md`: 7 province views, 18 teams, 21 sectors, 35 MB, single-team dispatch, `final_severity_score`, status-only finalize, headcount capacity, fixed AHP weights, hazard-type map colours, seeded read-only tags, one-sided `CR-xx` rules, 15 logical tables + 54 implementation columns.

### A2. §1.3 — upload limit `[x]`

- Current: `Uploading original JPEG/PNG images (up to 15 MB)`
- Change to: `Uploading original JPEG/PNG images (up to 35 MB)`

### A3. §1.3 — region/dataset and AHP wording `[x]`

- Current: `Interactive Tactical Map, regional dataset switching (5 operational regions), AHP weight configuration, and official Digital Dossier generation.`
- Change to: `Interactive Tactical Map, national dataset plus 7 province views, fixed AHP weights shown in DSS Trace, and official Digital Dossier generation.`

### A4. §1.3 — Finalize wording `[x]`

- Current: `supported by field casualty tallies and operational debrief remarks.`
- Change to: `supported by the audit trail; the demo implements a status-only change.`

### A5. §1.5 — rescue-team scale `[x]`

- Current: `Rescue team data is simulated (96 teams across 8 municipal sectors per region); each team is stationed at a fixed location.`
- Change to: `Rescue team data is simulated (18 teams across 21 municipal sectors); each team is stationed at a fixed location.`

### A6. FR-INT-01 table row `[x]`

- Current: `accepting standard JPEG and PNG images up to 15 MB in payload size.`
- Change to: `accepting standard JPEG and PNG images up to 35 MB in payload size.`

### A7. FR-INT-04 table row `[ ]`

- Current: `invalid image format or >15 MB (ERR_IMAGE_INVALID_OR_MISSING)`
- Change to: `invalid image format or >35 MB (ERR_IMAGE_INVALID_OR_MISSING)`
- Also add the two drone-mode checks that the code enforces:
  - `ERR_UAV_NOT_CONNECTED` — no registered UAV is linked.
  - `ERR_SOURCE_NOT_UAV` — camera make/serial do not match the connected UAV.
- If you want to keep four errors only, add: “Drone mode adds registered-UAV and camera/source checks.”

### A8. FR-MIS-01 table row `[x]`

- Current: `plotting active incidents, severity color codes, and rescue unit station locations across the active operational region.`
- Change to: `plotting active incidents with hazard-type colour codes; rescue unit station locations are listed in C7.`

### A9. FR-MIS-03 table row `[x]`

- Current: `configure the operating region (5 supported areas), regional coverage bounds, alert thresholds, and rate limits.`
- Change to: `configure the operating region (national dataset and 7 province views), regional coverage bounds, alert thresholds, and rate limits.`
- Recommended clarification: coverage bounds are read from the active dataset; rate limits are deployment settings.

### A10. FR-MIS-04 table row `[x]`

- Current: `adjust AHP decision weights (severity, distance, free teams) and restore default baselines without code changes.`
- Change to: `display the fixed AHP decision weights (severity, distance, free teams) and the consistency ratio; weights are not editable in the demo.`

### A11. NFR-SEC-02 table row `[x]`

- Current: `≤ 15 MB`
- Change to: `≤ 35 MB`

### A12. NFR-USA-04 `[ ]`

- Current: `The system shall be deployable locally ... with zero mandatory external internet services.`
- Change to: `The system and ML pipeline run locally without external services. The optional Dispatch basemap uses online OpenStreetMap tiles; without internet it shows a static fallback map.`

### A13. NFR-PERF-01 `[ ]`

- Current: `complete within ≤ 1.0 second per image on standard CPU hardware (measured: 368–431 ms).`
- Change to one of:
  - `measured on the demo host: approximately 0.9–1.5 s`, or
  - keep the 1.0 s target but state the host and that the demo machine may exceed it.
- Do not keep the 368–431 ms claim for the current machine.

---

## B. Relational Schema

File: `all_finalize.zip/all_v2/SkyRescue_Relational_Schema.docx`

### B1. Add the as-built addendum `[x]`

Same section as A1, inserted before “1. Overview of the Relational Schema”.

### B2. §2 — Prediction relation `[ ]`

Current relation text:

> `Prediction(prediction_id, report_id, ai_incident_type, final_incident_type, incident_confidence, ai_severity_score, ai_severity_label, final_severity_label, needs_review, ...)`

Add `final_severity_score` after `final_severity_label`:

> `Prediction(..., ai_severity_score, ai_severity_label, final_severity_label, final_severity_score, needs_review, ...)`

State: `final_severity_score` is the coordinator-edited operational severity; `ai_severity_score` remains immutable.

### B3. §2 — Dispatch relation `[ ]`

Current relation text contains `team_role`:

> `Dispatch(dispatch_id, report_id, team_id, confirmed_by_user_id, dispatch_status, team_role, match_score, ...)`

Change to:

> `Dispatch(dispatch_id, report_id, team_id, confirmed_by_user_id, dispatch_status, match_score, dispatched_at, confirmed_at, completed_at)`

Add: `report_id UNIQUE` and `one Dispatch per Report`.

### B4. §3 relationship table `[x]`

Current row:

> `Report → Dispatch | 1:N | Dispatch.report_id → Report.report_id`

Change to:

> `Report → Dispatch | 1:0..1 | Dispatch.report_id UNIQUE → Report.report_id`

### B5. §4 — support-team rule `[x]`

- Current: `A report can have at most one active primary and up to two active support assignments.`
- Change to: `A report has exactly one active primary assignment; the demo does not use support teams or team_role.`

### B6. §4 — final severity `[x]`

- Current: `no final_severity_score field is defined.`
- Change to: `final_severity_score stores the coordinator-edited operational score; ai_severity_score remains immutable.`

### B7. §4 — controlled vocabulary `[ ]`

- Current: `Dispatch status and team role`
- Change to: `Dispatch status`
- Remove `team_role` from the listed Dispatch vocabulary.

### B8. §4 — cross-row business rules `[ ]`

The paragraph after B5 still says coordinator edits do not overwrite AI values and may mention support assignments. Check it and keep only:

> One active primary assignment per Report. Coordinator-only verification and resolution, Unclassified verification blocking, coverage eligibility and team matching are enforced by application/transaction logic.

---

## C. Data Dictionary

File: `all/GROUP5_DATA_DICTIONARY.docx`

### C1. Add the as-built addendum `[x]`

Same section as A1, inserted before “1 Conventions and authority”.

### C2. Table 0 — baseline `[x]`

- Current: `15 tables / 130 attributes`
- Change to: `15 logical tables / 130 logical attributes plus 54 implementation/projection columns`

### C3. §4.4 — capacity note `[x]`

- Current: `capacity counts concurrently deployable sub-units. Live free capacity must account for active allocations; do not equate capacity with team.members.`
- Change to: `capacity stores headcount in the demo. AHP derives deployable units as floor(capacity / 4), or uses an explicit deployableUnits value when present.`

### C4. §4.7 — Prediction table `[ ]`

Add this row after `ai_severity_score`:

| Field | Type | Constraint | Description |
|---|---|---|---|
| `final_severity_score` | `FLOAT` | `NULL, CHECK (1..100)` | Coordinator-edited operational severity; initialized from `ai_severity_score`; AHP/TOPSIS consumes this value. |

Change existing descriptions:

- `ai_severity_score`: remove “Used as the severity input in AHP/TOPSIS”; say “Seed value; preserved; AHP uses `final_severity_score`.”
- `priority_score`: change “computed from ai_severity_score” to “computed from final_severity_score (or its seed value).”
- `final_severity_label`: remove “there is no final_severity_score column” wording if present.

### C5. §4.7 — incident-type values `[ ]`

The demo stores display labels. Change the Prediction CHECK constraints:

- Current: `CHECK IN ('Fire','Flood','Collapsed','Traffic','Normal','Unclassified')`
- Change to: `CHECK IN ('Fire','Flood','Building Collapse','Traffic Accident','Normal','Unclassified')`
- Update examples `Collapsed` → `Building Collapse`, `Traffic` → `Traffic Accident`.

If you prefer canonical DB labels, change the code instead; do not leave the reference and DB different.

### C6. §4.9 — Dispatch table `[ ]`

- `report_id`: add `UNIQUE` to the constraint.
- Remove the `team_role` row entirely, or mark it `not used in the demo`.
- Change the note to: `Exactly one active primary assignment per report; no support teams or team_role.`

### C7. §4.10 — Rule table `[ ]`

- `rule_code` description: change “Built-in HC codes are not persisted” to “HC rows are projection mirrors in the demo; predicates are evaluated in code.”
- `rule_type` description: change “Built-in Hard Constraints remain code-only” to “Built-in Hard Constraints are evaluated in code; the demo mirrors them as Rule rows for the UI.”
- `rule_origin` description: change “code-only built-ins have no row” to “seeded HC rows are projection mirrors.”
- `context_weights`: change canonical labels to the display labels used by the demo (`Fire`, `Flood`, `Building Collapse`, `Traffic Accident`), or state the mapping.
- Note: custom rules are one-sided `CR-xx` equality rules over `targetEntity` / `customTagKey` / `expectedValue`.

### C8. §4.11 — Tag catalog `[ ]`

Add a note:

> The six tags are seeded with the dataset and are read-only in the demo. Dataset import can extend the catalog. The demo does not expose an Admin tag editor.

### C9. §4.13 and §6 — SystemConfig `[ ]`

The demo stores config as JSON projections, not standalone rows:

- `region_meta`
- `settings` (including `settings.matchConfig`)
- `counters`
- `rule_engine_meta`

Change Table 15 example from `match_distance_divisor_km` to `settings` (or `region_meta`) and describe it as a JSON projection.

Change §6 / Table 23 wording:

- Keep the three match values `5`, `15`, `10`.
- State that they live in `system_config.settings.matchConfig`, not in three separate `system_config` rows.
- Keep `flood_person_conf_min` and `capture_max_age_min` only if you add them to the code; otherwise mark them as planned or remove them.

### C10. §5.2 — severity/AHP `[x]`

- `There is no final_severity_score column.` → `final_severity_score stores the coordinator-edited operational score; ai_severity_score remains immutable.`
- `AHP/TOPSIS consumes ai_severity_score numerically ...` → `AHP/TOPSIS consumes final_severity_score numerically (the seed equals ai_severity_score until the coordinator edits it); a label-only correction does not change that score.`

### C11. §5.3 — hard constraints `[x]`

- Current: `Hard Constraints HC-02, HC-03 and HC-04 are fixed in code and are not stored here.`
- Change to: `HC-02/03/04 are evaluated in code; the demo also keeps projection-mirror Rule rows for the UI.`

### C12. §5.6 — Match and Dispatch `[ ]`

Search for any remaining support-team/team-role wording and change it to single primary team. At minimum:

- `At most one active primary and two active support assignments per report` → `Exactly one active primary assignment per report`
- Remove `support is proposed only when the primary cannot meet the rescue requirement`.

### C13. Vocabulary and nullability notes `[ ]`

Add a short note under “Implementation clarifications”:

- `RescueTeam.status` uses `on_mission` in the DB; the UI shows “On Mission”.
- `PersonDetection.pose` stores `Other`; the UI label is “Non-Upright”.
- `Report.img_source` also accepts `seeded_sample`.
- Seeded `Report.reporter_id` and `UploadAttempt.user_id` may be NULL in the demo; if the reference keeps `NOT NULL`, populate these columns in the seed instead.
- The physical schema has 184 columns; the 130 attributes are the logical baseline.

---

## D. Diagrams

### D1. Context diagram

File: `all/Context_diagram_v2.png` and `all_finalize.zip/all_v2/context_diagram.png`

- `ranked team recommendations (primary + support)` → `ranked team recommendation (primary team)`
- Remove `Surge clusters (add-on)`.
- `Dispatch order (primary + support teams)` → `Dispatch order (primary team)`.
- Keep `Registered UAV` as an operational resource; it is not a login actor.

### D2. Use case diagram

File: `all/usecase_v2.png` and `all_finalize.zip/all_v2/use_case_diagram.png`

- Remove the `Rescue Team (fixed location)` actor; the demo has two actors (Reporter, SAR Coordinator/Admin).
- `Assign Team(s) & Confirm Dispatch` → `Assign Team & Confirm Dispatch`.
- `Match Teams (Team Match + Support Teams)` → `Match Team (Team Match)`.
- Remove `View Surge Clusters (add-on)`.
- Keep `Connect Registered UAV`; drone mode still uses it.

### D3. Swimlane

File: `all/Swimlane Dispatch Decision Update.png` and `all_finalize.zip/all_v2/swimlane_diagram.png`

- Remove the `Rescue Team` lane.
- `REP ID` → `INC-XXXX`.
- `Normal and P >= 0.97` → `Normal and P >= 0.90`.
- `Extract EXIF, validate 6 rules, log` → `Validate Layer 1 checks (registered UAV/camera, image, GPS, time, duplicate), log`.
- Remove `(Add-on) Group nearby incidents into Surge clusters`.
- Remove `Add 1 to 2 support teams (greedy, max gain)`.
- `Review ranked teams, select primary (+ support)` → `Review ranked teams, select primary team`.
- Final `Mark incident Resolved` must sit in the Dispatcher lane, not the Rescue Team lane; label `Coordinator Finalize & Resolve`.

### D4. DFD

File: `all/SkyRescue_DFD_Level1_Level2_v4.pdf` and the DFD PNG/JPG exports.

- Process `6.2 Match & select teams` → `6.2 Match & select team`.
- Data flow `selected teams` → `selected team`.
- Data flow `teams, selection` → `team, selection`.
- Process `1.1 Validate UAV, image, GPS` is still correct for drone mode; keep it.
- Do not add clustering, Surge or support-team data stores.

---

## E. Old guides and prompt

These are historical. Either delete them from the final submission or put a cover note on each:

> Historical v2.0 document. Superseded by the as-built Requirements, Relational Schema and Data Dictionary (05 Nov 2026). It describes clustering, coalition, Golden Hour and Surge, which are not part of the demo.

Files:

- `HuongDan_ChucNang_Web_Dispatch.docx`
  - Remove/replace sections 2 (DBSCAN/Ptriage), 6 (Golden Hour), 7 (Surge), 8 (coalition/equipment), and the 0.60/0.25/0.15 AHP formula.
  - Update map colours and team-base wording.
- `HuongDan_ChucNang_Web_Reporter.docx`
  - Update `REP ID` → `INC-XXXX`, `Verified` → `Matching Team`, remove California, keep 35 MB.
- `MoTaBackEnd.docx`
  - Remove clustering, Golden Hour, coalition, equipment trimming; update AHP weights and direction.
- `Stakeholder_Requirements_Scope_v0.3.docx`
  - Mark `Superseded by Requirements v1.0`.
- `SkyResc/SKYRESCUE_CLAUDE_CODE_PROMPT.md`
  - Mark `Historical build prompt`; it still requires clustering, Surge and coalition.

---

## F. Feedback 1.1/1.2 addendum (08–09 November 2026)

Add this section to the reference set; do not rewrite the 05/11 pages.

- **Requirements:** replace “every report is manually verified” with hybrid trust:
  trusted UAV/CTV/identified Reporter auto-verify after a valid high-confidence AI
  emergency; **all citizen reports require Coordinator review and are never
  auto-verified**; every dispatch is confirmed by a human.
- **Reporter Portal:** remove the scene-type dropdown, victim-count input and hint
  checkboxes. The only reporter input is an optional field note.
- **Workflow:** C2 is a split-view Unified Triage Workspace (queue + evidence + AI +
  recommended team + one-click dispatch). C3/C4/C5 remain drill-down/fallback.
  Edit Type on an Auto-Verified incident routes back to C9R for re-verification.
- **AHP:** criterion C1 uses **raw severity** (no multiplier). Weights
  `0.648 / 0.230 / 0.122` and CR `0.003` are unchanged.
- **Code Red:** use the 3 defense layers from `SafeGuardMechanic.docx`:
  (1) ≥ 1 Non-Upright victim with confidence ≥ 0.70, or ≥ 3 victims with confidence
  ≥ 0.75; (2) confirmed disaster context (Normal/Unclassified locked out);
  (3) Golden Hour escalation at ≥ 45 min without team assignment. Pin `#CR-n` above
  the AHP order; the AHP score/rank remains visible. Add the 30–45 min amber warning
  and audio alert.
- **Testing:** 49 pytest relational + 49 pytest JSON + 10 Node + E2E PASS.

---

## G. Final check

After editing the reference, verify:

- [ ] No occurrence of `15 MB`, `5 operational regions`, `96 teams`, `5 supported areas`.
- [ ] No occurrence of `team_role` outside the “not used” note.
- [ ] No occurrence of `no final_severity_score` or “AHP consumes ai_severity_score” without the operational-score clarification.
- [ ] No occurrence of `capacity counts concurrently deployable sub-units`.
- [ ] No diagram shows Rescue Team as an actor, support teams, Surge, Golden Hour, 0.97 Normal gate or `REP ID`.
- [ ] The addendum is the first section a reader sees.
- [ ] The Requirements, Schema and Data Dictionary all say the same values: 7 province views, 18 teams, 21 sectors, 35 MB, single team, status-only finalize.
- [ ] The 08/11 addendum covers hybrid auto-verify (citizens always manual), note-only Reporter, Unified Triage Workspace, Edit Type re-verification, Code Red 3-layer defense and raw-severity AHP.
- [ ] The AHP text says C1 uses raw severity with no multiplier; the 3×3 matrix, weights 0.648/0.230/0.122 and CR 0.003 are unchanged.
