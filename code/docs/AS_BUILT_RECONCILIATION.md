# As-built reconciliation — 05 November 2026 (+ 08 November 2026 addendum)

This page is the authoritative delta between the final reference set
(`SkyRescue_Requirements_Specification_v1_0.docx`, `SkyRescue_Relational_Schema.docx`,
`GROUP5_DATA_DICTIONARY.docx`) and the demo that is actually running. Where they differ,
this page describes the demo. The reference set remains useful as orientation; it should
be read together with these deltas.

## Demo scope

- **Dataset:** national Vietnam dataset with **7 province views** — Ho Chi Minh City,
  Ha Noi, Da Nang, Can Tho, Khanh Hoa, Lam Dong and Quang Nam.
- **Seed:** 20 `EXT01`–`EXT20` incidents at their real EXIF coordinates; 15 open
  (11 verified + 4 in the Review Inbox) and 5 in Resolved Cases.
- **Teams:** **18** rescue units across **21** administrative sectors.
- **Map:** five hazard-type filters (Fire, Flood, Building Collapse, Traffic Accident,
  Unclassified), national province clusters, province drill-down, viewport-culled
  individual markers, and an offline fallback. Markers are coloured by hazard type.
  Rescue-team base locations are listed in C7, not plotted on the map.
- **Dispatch:** one verified incident is assigned to **one primary team**. One Dispatch
  row per Report (`UNIQUE(report_id)`); there is no `team_role`, support team or
  coalition allocation.
- **Upload limit:** **35 MB** (JPEG/PNG, magic-byte checked).
- **Layer 1:** EXIF GPS first, browser geolocation fallback, 30-minute freshness,
  SHA-256 duplicate check, national bounding-box geofence, and registered-UAV plus
  camera/source checks for drone-mode uploads.
- **Severity:** the coordinator may edit the operational severity. It is stored in
  `predictions.final_severity_score`; `predictions.ai_severity_score` stays immutable.
  The server AHP/TOPSIS snapshot uses the operational severity.
- **Finalize & Resolve:** status change only — incident `Resolved`, Dispatch
  `Completed`, team `Available`, audited. There are no casualty-tally or debrief fields.
- **AHP:** weights **0.648 / 0.230 / 0.122**. Direction locked on 03/11: farther
  nearest-team distance and fewer free teams raise priority. Weights are fixed in code and shown in DSS Trace; they are not editable in Configuration.
- **RescueTeam.capacity:** headcount. AHP derives deployable units as
  `floor(capacity / 4)`, or uses an explicit `deployableUnits` value when present.
- **Tags and rules:** the six tags are seeded and read-only in the demo
  (`narrow_entrance`, `detected_people_count`, `access_terrain`, `population_density`,
  `vehicle_type`, `heavy_debris_gear`). HC-02/03/04 are evaluated in code; their Rule
  rows are projection mirrors for the UI. SC-01/03/04 are editable soft rules. The
  demo supports one-sided custom equality rules (`CR-xx`) over the seeded tag catalog.
- **Status/type vocabulary:** the running database uses display labels
  (`Building Collapse`, `Traffic Accident`) and `on_mission`; the UI shows “On Mission”.
  UI `Non-Upright` is stored as `Other`. `seeded_sample` is a valid `img_source`.
- **Physical schema:** 15 logical tables / 130 logical attributes plus **54
  implementation/projection columns** (`*_json`, public codes, overrides, audit detail).
  `server/schema.sql` is the as-built physical model; the Data Dictionary is the logical
  orientation.

## 08–09 November 2026 — feedback 1.1/1.2

The team review of the 06/11 plan moved the demo from “100% manual review” to a
**hybrid trust** workflow. The as-built behaviour is now:

- **Auto-verification:** trusted sources (registered UAV, verified Specialist/CTV,
  verified identified Reporter) auto-verify after a valid AI emergency result
  (confidence ≥ 85%, no `needsReview`, no contradiction, no GPS conflict, no
  near-duplicate). **Unverified Citizen reports always require Coordinator review;
  they are never auto-verified, with or without a second report.** Normal,
  Unclassified, AI-failed and flagged reports never auto-verify. Auto-verification
  never dispatches.
- **Reporter Portal:** the scene-type dropdown, victim-count input and hint checkboxes
  are gone. The reporter supplies one optional free-text field note; AI performs the
  classification and counting. The old declaration-vs-AI conflict flag is removed.
- **Unified Triage Workspace:** C2 has a Queue/Workspace toggle. The workspace shows
  the active queue on the left, and evidence + AI gates + top eligible team + ETA on
  the right. A single **Verify & Confirm Dispatch** (or **Confirm Dispatch**) button
  records the human decision and creates the Dispatch order in one `Store.update`.
  C3/C4/C5 remain as detailed drill-down/fallback screens.
- **Code Red:** the Reinforced Code Red Fast Track uses 3 defense layers:
  (1) **High-Confidence Gate** — ≥ 1 `Non-Upright` victim with confidence ≥ 0.70, or
  ≥ 3 victims (MCI) with confidence ≥ 0.75; (2) **Hazard Context Gate** — the incident
  must be a confirmed Fire, Flood, Building Collapse or Traffic Accident, so Normal and
  Unclassified are locked out; (3) **Golden Hour Escalation** — any unassigned incident
  with victims waiting ≥ 45 min is forced to Code Red with the reason
  `Golden Hour Escalation: Nạn nhân chờ quá 45 phút`. The 30–45 min band shows an amber
  warning and plays the configured audio alert. Code Red is pinned above the normal AHP
  order and labelled `#CR-n`; the AHP score/rank is still computed and displayed. The
  seed has 14/15 active cases as Code Red.
- **AHP severity:** criterion C1 uses the **raw** incident severity
  (`final_severity_score` / `severityScore`). There is **no life-adjusted multiplier**.
  The Reinforced Code Red track is an operational pin above the AHP order. The 3×3
  matrix, weights **0.648 / 0.230 / 0.122** and CR **0.003** are unchanged.
- **Edit Type guardrail:** when a Coordinator clicks **Edit Type** on an Auto-Verified
  incident, the incident and report return to `Unverified`, the reviewed type is
  cleared, audit event `REPORT_REOPENED_FOR_REVERIFICATION` is written, and the UI
  routes to C9R. Matching and dispatch stay locked until the report is re-verified.
- **Near-duplicate reset safety:** dHash comparison only considers uploads still
  referenced by the current state, so a demo reset cannot create a false
  `nearDuplicate` flag. Sub-pixel detections are clamped before the person-detection
  insert so a CHECK constraint cannot abort the ML job.

## Reference corrections

When updating the reference documents, change these statements first:

1. Requirements §1.3, §1.5 and FR-MIS-03: 7 province views, 18 teams, 21 sectors.
2. Requirements FR-INT-01 and NFR-SEC-02: 35 MB, not 15 MB.
3. Requirements §1.4, Relational Schema §4 and Data Dictionary §4.9: single-team
   dispatch; remove support-team/`team_role` wording.
4. Requirements FR-DSP-03 and Data Dictionary §5.2: keep `final_severity_score` as the
   coordinator-edited operational score; AHP consumes it.
5. Requirements §1.3: Finalize & Resolve is status-only; remove casualty tallies and
   debrief remarks.
6. Data Dictionary §4.4: `RescueTeam.capacity` is headcount; AHP derives sub-units.
7. Data Dictionary §4.10/§5.3: HC rows are projection mirrors; the predicates are
   code-only. Custom rules are one-sided tag equality.
8. Data Dictionary §4.13/§6: describe the actual `system_config` projection
   (`region_meta`, `settings`, `counters`, `rule_engine_meta`) and `settings.matchConfig`.
9. FR-MIS-04: fixed AHP weights, read-only in Configuration.
10. FR-MIS-01: hazard-type colours; team bases in C7.
11. Update the 15-table/130-attribute baseline to note the 54 implementation columns.
12. Mark the v2 context/use-case/swimlane diagrams and the v2.0 Word guides as historical.
    They still show Rescue Team as an actor, support teams, Surge, Golden Hour, the 0.97
    Normal gate and `REP ID`.
13. Requirements/reporting flow: replace “every report is manually verified” with
    “trusted sources auto-verify; all citizen reports require Coordinator review;
    every dispatch is confirmed by a human”. Delete the 2-source corroboration rule.
14. Reporter Portal figures/spec: remove the scene-type, victim-count and hint inputs;
    the only reporter input is an optional field note.
15. Workflow figures: C2 is now a split-view workspace; C3/C4/C5 are drill-down/fallback;
    Edit Type on an Auto-Verified incident returns to C9R for re-verification.
16. AHP section: C1 uses **raw severity** (no multiplier). Code Red is the 3-layer
    operational fast track above the AHP order; weights and CR are unchanged. Remove
    the old life-adjusted table and add the Code Red gate table.
17. Test counts: 49 pytest relational + 49 pytest JSON + 10 Node + E2E PASS, not the old
    45 + 45 + 5.
