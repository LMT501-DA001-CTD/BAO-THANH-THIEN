"""SQLite relational backend for the SkyRescue target model.

The 15 domain tables are the physical source of truth. The frontend still speaks the
existing JSON-state API, so this module projects those tables into the same camelCase
shape and imports a full projection back after each mutation. The `payload_json`
columns keep demo/UI-only fields without adding more tables.

This module is deliberately small and synchronous: the demo has a single worker and a
few dozen reports, so a full projection rewrite per mutation is acceptable and keeps
the relational and logical views from drifting.
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SEED_STATE_PATH = Path(__file__).with_name("seed_state.json")
SEED_USERS_PATH = Path(__file__).with_name("seed_users.json")
EARTH_KM = 6371.0088
COVERAGE_RADIUS_KM = 10.0

_conn: sqlite3.Connection | None = None
_lock = threading.RLock()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json(value):
    return json.dumps(value, ensure_ascii=False)


def _loads(value, default=None):
    try:
        return json.loads(value) if value else (default if default is not None else {})
    except (TypeError, ValueError):
        return default if default is not None else {}


def _slug(value):
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return text or "item"


def _haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def _norm_status(value):
    text = str(value or "").strip()
    mapping = {
        "Not Reviewed": "Unverified",
        "Pending Verification": "Unverified",
        "Under Review": "Unverified",
        "Verified Normal": "Resolved",
        "Team Matched": "In Progress",
        "Assigned": "In Progress",
        "Dispatched": "In Progress",
        "Enroute": "In Progress",
        "Result Submitted": "In Progress",
        "Partial — Action Required": "In Progress",
    }
    return mapping.get(text, text if text in ("Unverified", "Matching Team", "In Progress", "Resolved") else "Unverified")


def _team_specialty(team):
    text = " ".join(str(team.get(k) or "") for k in ("id", "name", "equipment", "area")).lower()
    if any(w in text for w in ("pccc", "fire", "chữa cháy", "chua chay")):
        return "fire"
    if any(w in text for w in ("traffic", "highway", "giao thông", "giao thong")):
        return "traffic_rescue"
    if any(w in text for w in ("water", "flood", "boat", "waterway", "ngập", "ngap", "thủy", "thuy")):
        return "water_rescue"
    return "urban_sar"


def _team_status(value):
    text = str(value or "").strip().lower().replace(" ", "_")
    if text in ("on_mission", "busy"):
        return "on_mission"
    if text == "offline":
        return "offline"
    return "available"


def _dispatch_status(value):
    text = str(value or "").strip().lower()
    if text in ("completed", "cancelled", "pending_confirmation", "confirmed"):
        return text
    if text in ("sent", "accepted", "assigned", "enroute", "in progress"):
        return "confirmed"
    return "confirmed"


def _storefront_status(value):
    return str(value or "").strip().lower()


def _bbox(det):
    box = det.get("bbox") or [0, 0, 0, 0]
    if len(box) >= 4 and all(isinstance(v, (int, float)) for v in box[:4]):
        x, y, w, h = box[:4]
        x1, y1 = max(0, int(round(x))), max(0, int(round(y)))
        # The DB CHECK requires a strict positive width/height. A sub-pixel
        # detection must not abort the whole ML job.
        return x1, y1, max(x1 + 1, int(round(x + w))), max(y1 + 1, int(round(y + h)))
    return 0, 0, 1, 1


def _prediction_payload(incident, report):
    ai = (report or {}).get("aiResult") or {}
    return {
        "status": ai.get("status") or incident.get("aiStatus") or "Completed",
        "incidentType": ai.get("incidentType") or incident.get("originalType"),
        "aiConfidence": ai.get("aiConfidence", incident.get("aiConfidence")),
        "severityScore": ai.get("severityScore", incident.get("severityScore")),
        "severityLevel": ai.get("severityLevel"),
        "needsReview": bool(ai.get("needsReview", incident.get("needsReview", False))),
        "detectedPeopleCount": ai.get("detectedPeopleCount", incident.get("detectedPeopleCount", 0)),
        "nonUprightCount": ai.get("nonUprightCount", incident.get("nonUprightCount", 0)),
        "poseConfidence": ai.get("poseConfidence", incident.get("poseConfidence", 0)),
        "detections": ai.get("detections") or incident.get("detections") or [],
        "probs": ai.get("probs") or {},
        "details": ai.get("details") or {},
        "latencyMs": ai.get("latencyMs"),
        "models": ai.get("models") or {},
    }


def init(conn: sqlite3.Connection):
    global _conn
    _conn = conn
    _conn.execute("PRAGMA foreign_keys = ON")
    _conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _conn.execute("INSERT OR IGNORE INTO app_meta(key, value) VALUES('version', '0')")
    _conn.execute("INSERT OR IGNORE INTO app_meta(key, value) VALUES('updated_at', ?)", (now_iso(),))
    _seed_users()
    if not _conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0]:
        seed = _loads(SEED_STATE_PATH.read_text(encoding="utf-8"), {})
        if seed:
            import_state(seed)
            # Keep a seed audit record so the UI has an initial event.
            for record in (seed.get("audit") or [])[:20]:
                _insert_audit_record(record)


def _seed_users():
    seed = _loads(SEED_USERS_PATH.read_text(encoding="utf-8"), [])
    for user in seed:
        code = str(user.get("id") or "")
        role = "dispatch_admin" if user.get("portal") == "dispatch" else "reporter"
        hashes = user.get("passwordHashes") or []
        _conn.execute(
            """INSERT OR IGNORE INTO users
               (user_code, username, password_hash, full_name, role, portal, trust_tier, verified, phone, created_at, record_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (code, code.lower(), hashes[0] if hashes else None, user.get("name") or code, role,
             user.get("portal") or "reporter", user.get("trustTier"), 1 if user.get("verified") else 0,
             user.get("phone"), now_iso(), _json(user)),
        )


def all_users():
    return [_loads(row[0], {}) for row in _conn.execute("SELECT record_json FROM users ORDER BY user_id")]


def add_user(record):
    code = str(record.get("id") or "").strip() or f"CIT-{_slug(record.get('phone', 'user')).upper()}"
    hashes = record.get("passwordHashes") or []
    role = "dispatch_admin" if record.get("portal") == "dispatch" else "reporter"
    _conn.execute(
        """INSERT INTO users
           (user_code, username, password_hash, full_name, role, portal, trust_tier, verified, phone, created_at, record_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (code, code.lower(), hashes[0] if hashes else None, record.get("name") or code, role,
         record.get("portal") or "reporter", record.get("trustTier"), 1 if record.get("verified") else 0,
         record.get("phone"), now_iso(), _json(record)),
    )


def version():
    row = _conn.execute("SELECT value FROM app_meta WHERE key='version'").fetchone()
    return int(row[0]) if row and str(row[0]).isdigit() else 0


def _bump_version():
    value = version() + 1
    _conn.execute("UPDATE app_meta SET value=? WHERE key='version'", (str(value),))
    _conn.execute("INSERT OR REPLACE INTO app_meta(key, value) VALUES('updated_at', ?)", (now_iso(),))
    return value


def _config(key, default=None):
    row = _conn.execute("SELECT config_value FROM system_config WHERE config_key=?", (key,)).fetchone()
    if not row:
        return default
    return _loads(row[0], default)


def _write_config(key, value, description=""):
    _conn.execute(
        "INSERT OR REPLACE INTO system_config(config_key, config_value, description, updated_at) VALUES (?, ?, ?, ?)",
        (key, _json(value), description, now_iso()),
    )


def _insert_audit_record(record):
    actor = record.get("actor") or {}
    user_code = actor.get("id")
    user_id = None
    if user_code:
        row = _conn.execute("SELECT user_id FROM users WHERE user_code=?", (str(user_code),)).fetchone()
        user_id = row[0] if row else None
    changes = record.get("changes") or []
    entity = changes[0].get("entity") if changes else "System"
    entity_id = str(changes[0].get("id")) if changes else ""
    _conn.execute(
        """INSERT INTO audit_log
           (user_id, action, entity_type, entity_id, old_value, new_value, created_at, detail, changes_json, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, record.get("event") or "EVENT", entity or "System", entity_id,
         _json(changes[0].get("from")) if changes else None,
         _json(changes[0].get("to")) if changes else None,
         record.get("at") or now_iso(), record.get("detail") or "",
         _json(changes), _json(record)),
    )


def _audit_rows(limit=1000):
    rows = _conn.execute(
        """SELECT log_id, action, created_at, detail, changes_json, payload_json, user_id
           FROM audit_log ORDER BY log_id DESC LIMIT ?""", (limit,)
    ).fetchall()
    output = []
    for log_id, action, created_at, detail, changes_json, payload_json, user_id in rows:
        record = _loads(payload_json, {})
        if not record:
            record = {"id": f"AUD-{log_id:05d}", "event": action, "detail": detail or "",
                      "at": created_at, "changes": _loads(changes_json, [])}
        record.setdefault("id", f"AUD-{log_id:05d}")
        record.setdefault("event", action)
        record.setdefault("detail", detail or "")
        record.setdefault("at", created_at)
        record.setdefault("changes", _loads(changes_json, []))
        if not record.get("actor") and user_id:
            u = _conn.execute("SELECT user_code, full_name, role FROM users WHERE user_id=?", (user_id,)).fetchone()
            if u:
                record["actor"] = {"id": u[0], "name": u[1], "role": u[2]}
        output.append(record)
    return output


def import_state(state: dict):
    """Rewrite all domain rows from one JSON projection. Infrastructure tables stay."""
    state = state or {}
    with _lock:
        _conn.execute("BEGIN IMMEDIATE")
        try:
            for table in ("entity_tags", "person_detections", "predictions", "dispatches",
                          "reports", "team_coverage", "rescue_teams", "locations", "uavs",
                          "tags", "rules"):
                _conn.execute(f"DELETE FROM {table}")

            region = state.get("regionMeta") or {}
            region_code = region.get("regionId") or _slug(region.get("operatingArea") or "region")
            province = region.get("operatingArea") or region.get("province") or ""
            location_ids = {}
            for sector in region.get("sectors") or []:
                name = str(sector.get("name") or "")
                if not name:
                    continue
                lat = float(sector.get("latitude", sector.get("lat", 0)) or 0)
                lng = float(sector.get("longitude", sector.get("lng", 0)) or 0)
                code = f"{region_code}-{_slug(name)}"
                cur = _conn.execute(
                    """INSERT INTO locations(location_code, area_name, center_lat, center_lng, radius_km,
                                             province, region_code, created_at, payload_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (code, name, lat, lng, 2.0, province, region_code, now_iso(), _json(sector)),
                )
                location_ids[name] = cur.lastrowid

            _write_config("region_meta", region, "Active region projection metadata")
            _write_config("settings", state.get("settings") or {}, "System settings projection")
            _write_config("counters", state.get("counters") or {}, "ID counters")
            _write_config("rule_engine_meta", {
                "version": ((state.get("settings") or {}).get("ruleEngine") or {}).get("version"),
                "updatedAt": ((state.get("settings") or {}).get("ruleEngine") or {}).get("updatedAt"),
                "missingDataPolicy": ((state.get("settings") or {}).get("ruleEngine") or {}).get("missingDataPolicy"),
                "conflictPolicy": ((state.get("settings") or {}).get("ruleEngine") or {}).get("conflictPolicy"),
            }, "Rule engine metadata")

            uav_ids = {}
            for uav in state.get("uavs") or []:
                code = str(uav.get("id") or "")
                if not code:
                    continue
                cur = _conn.execute(
                    """INSERT INTO uavs(uav_code, serial_number, make_model, make, status, registered_at, payload_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (code, uav.get("serial") or code, uav.get("model"), uav.get("make"),
                     "registered" if uav.get("registered", True) else "inactive", now_iso(), _json(uav)),
                )
                uav_ids[code] = cur.lastrowid

            team_ids = {}
            for team in state.get("teams") or []:
                code = str(team.get("id") or "")
                if not code:
                    continue
                area = str(team.get("area") or "")
                lat = team.get("latitude")
                lng = team.get("longitude")
                if lat is None or lng is None:
                    loc = next((s for s in (region.get("sectors") or []) if s.get("name") == area), None)
                    if loc:
                        lat, lng = loc.get("latitude", loc.get("lat")), loc.get("longitude", loc.get("lng"))
                if lat is None or lng is None:
                    lat, lng = region.get("center") or [0, 0]
                headcount = int(team.get("capacity") or team.get("members") or 1)
                cur = _conn.execute(
                    """INSERT INTO rescue_teams
                       (team_code, team_name, leader_name, team_lat, team_lng, status, specialty,
                        capacity, equipment, updated_at, created_at, payload_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (code, team.get("name") or code, team.get("commander"), float(lat), float(lng),
                     _team_status(team.get("status")), _team_specialty(team), max(1, headcount),
                     team.get("equipment"), now_iso(), team.get("createdAt") or now_iso(), _json(team)),
                )
                team_id = cur.lastrowid
                team_ids[code] = team_id
                # Target TeamCoverage: primary area plus the 10 km seed rule.
                covered = set()
                if area in location_ids:
                    covered.add(location_ids[area])
                for name, loc_id in location_ids.items():
                    loc = next((s for s in (region.get("sectors") or []) if s.get("name") == name), None)
                    if not loc:
                        continue
                    llat = float(loc.get("latitude", loc.get("lat", 0)) or 0)
                    llng = float(loc.get("longitude", loc.get("lng", 0)) or 0)
                    if _haversine_km(float(lat), float(lng), llat, llng) <= COVERAGE_RADIUS_KM:
                        covered.add(loc_id)
                for loc_id in covered:
                    _conn.execute("INSERT OR IGNORE INTO team_coverage(team_id, location_id) VALUES (?, ?)", (team_id, loc_id))
                # Explicit provincial coverage (TeamCoverage rows supplied by the seed),
                # independent of the 10 km seed rule.
                for cover_name in team.get("coverage") or []:
                    cover_loc = location_ids.get(str(cover_name))
                    if cover_loc:
                        _conn.execute("INSERT OR IGNORE INTO team_coverage(team_id, location_id) VALUES (?, ?)", (team_id, cover_loc))

            # Tags and rules.
            tag_ids = {}
            for tag in state.get("customTagSchema") or []:
                key = str(tag.get("key") or "")
                if not key:
                    continue
                name = tag.get("label") or key
                value_type = str(tag.get("dataType") or "string").lower()
                if value_type not in ("string", "number", "boolean"):
                    value_type = "string"
                cur = _conn.execute(
                    """INSERT INTO tags(tag_key, tag_name, value_type, color, created_at, payload_json)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (key, name, value_type, tag.get("color"), now_iso(), _json(tag)),
                )
                tag_ids[key] = cur.lastrowid
            rules = ((state.get("settings") or {}).get("ruleEngine") or {}).get("rules") or []
            for rule in rules:
                rule_type = "hard" if str(rule.get("category")).lower() == "hard" else "soft"
                origin = "system" if str(rule.get("id", "")).startswith(("HC", "SC")) else "custom"
                _conn.execute(
                    """INSERT INTO rules
                       (rule_code, rule_name, description, rule_type, rule_origin, condition_summary,
                        target_entity_type, custom_tag_key, expected_value, weight_delta, context_weights,
                        reason_text, is_active, created_at, updated_at, payload_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (str(rule.get("id") or ""), rule.get("name") or rule.get("id") or "rule",
                     rule.get("description"), rule_type, origin, rule.get("conditionSummary"),
                     rule.get("targetEntity"), rule.get("customTagKey"), rule.get("expectedValue"),
                     rule.get("weightDelta"), _json(rule.get("contextWeights") or {}),
                     rule.get("reasonText") or rule.get("failureReason"), 1 if rule.get("enabled", True) else 0,
                     now_iso(), now_iso(), _json(rule)),
                )

            reports_by_incident = {}
            for report in state.get("reports") or []:
                incident_id = report.get("incidentId")
                if incident_id:
                    reports_by_incident.setdefault(incident_id, report)
            report_id_by_code = {}
            failed_reports = []
            for incident in state.get("incidents") or []:
                code = str(incident.get("id") or "")
                if not code:
                    continue
                report = reports_by_incident.get(code) or next(
                    (r for r in (state.get("reports") or []) if r.get("incidentId") == code), None
                ) or {}
                report_payload = dict(report)
                report_payload["id"] = code
                report_payload["incidentId"] = code
                incident_payload = dict(incident)
                incident_payload["reportId"] = code
                location = incident.get("location") or {}
                loc_name = str(location.get("district") or "")
                loc_id = location_ids.get(loc_name)
                if loc_id is None and loc_name:
                    sector = {"name": loc_name, "latitude": location.get("latitude", 0), "longitude": location.get("longitude", 0)}
                    cur = _conn.execute(
                        """INSERT INTO locations(location_code, area_name, center_lat, center_lng, radius_km,
                                                 province, region_code, created_at, payload_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (f"{region_code}-{_slug(loc_name)}", loc_name, float(location.get("latitude", 0) or 0),
                         float(location.get("longitude", 0) or 0), 2.0, province, region_code, now_iso(), _json(sector)),
                    )
                    loc_id = cur.lastrowid
                    location_ids[loc_name] = loc_id
                reporter_code = (report.get("reporter") or {}).get("id")
                uav_code = (report.get("uav") or {}).get("id")
                cur = _conn.execute(
                    """INSERT INTO reports
                       (report_code, reporter_id, location_id, uav_id, img_path, img_source, gps_lat, gps_lng,
                        captured_at, status, verified_by_user_id, verified_at, created_at, original_type,
                        reviewed_type, severity_score, ai_severity_score, ai_confidence, detected_people_count,
                        ai_detected_people_count, non_upright_count, pose_confidence, verification_status,
                        upload_status, processing_status, image_url, metadata_source, fingerprint, report_json, incident_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (code, None, loc_id, uav_ids.get(str(uav_code)) if uav_code else None,
                     report.get("image") or incident.get("image"),
                     "live_upload" if report.get("dataOrigin") == "Live upload" else "seeded_sample",
                     location.get("latitude"), location.get("longitude"),
                     (report.get("metadata") or {}).get("captureTime") or incident.get("createdAt"),
                     _norm_status(incident.get("status")), None, incident.get("verifiedAt"), incident.get("createdAt") or now_iso(),
                     incident.get("originalType"), incident.get("reviewedType"), incident.get("severityScore"),
                     incident.get("aiSeverityScore", incident.get("severityScore")), incident.get("aiConfidence"),
                     incident.get("detectedPeopleCount"), incident.get("aiDetectedPeopleCount"),
                     incident.get("nonUprightCount"), incident.get("poseConfidence"), incident.get("verificationStatus"),
                     report.get("uploadStatus"), report.get("processingStatus"),
                     report.get("image") or incident.get("image"), report.get("metadataSource"), report.get("fingerprint"),
                     _json(report_payload), _json(incident_payload)),
                )
                report_pk = cur.lastrowid
                report_id_by_code[code] = report_pk

                prediction = _prediction_payload(incident, report)
                snapshot = incident.get("prioritySnapshot") or {}
                final_type = incident.get("reviewedType") or incident.get("originalType") or "Unclassified"
                ai_type = prediction.get("incidentType") or final_type
                ai_sev = incident.get("aiSeverityScore", incident.get("severityScore")) or 0
                final_sev = incident.get("severityScore") or 0
                cur = _conn.execute(
                    """INSERT INTO predictions
                       (report_id, ai_incident_type, final_incident_type, incident_confidence,
                        ai_severity_score, final_severity_score, ai_severity_label, final_severity_label,
                        needs_review, ai_people_count, final_people_count, nearest_team_id,
                        distance_to_nearest_team_km, free_teams, priority_score, priority_computed_at,
                        no_team_flag, model1_version, model2_version, predicted_at, payload_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (report_pk, ai_type, final_type, incident.get("aiConfidence"),
                     ai_sev, final_sev, prediction.get("severityLevel"), incident.get("severityLabel"),
                     1 if prediction.get("needsReview") else 0,
                     int(prediction.get("detectedPeopleCount") or 0),
                     int(incident.get("detectedPeopleCount") or 0),
                     team_ids.get(str(snapshot.get("nearestTeamId") or "")),
                     snapshot.get("distanceToNearestTeamKm"), int(snapshot.get("freeTeams") or 0),
                     float(snapshot.get("score") or 0), snapshot.get("computedAt"),
                     1 if snapshot.get("noTeamFlag") else 0,
                     (prediction.get("models") or {}).get("m1"), (prediction.get("models") or {}).get("m2"),
                     incident.get("createdAt"), _json(prediction)),
                )
                prediction_pk = cur.lastrowid
                for det in prediction.get("detections") or []:
                    x1, y1, x2, y2 = _bbox(det)
                    pose = "Other" if det.get("pose") == "Non-Upright" else det.get("pose")
                    _conn.execute(
                        """INSERT INTO person_detections
                           (prediction_id, detection_code, bbox_x1, bbox_y1, bbox_x2, bbox_y2,
                            pose, confidence_score, payload_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (prediction_pk, det.get("id"), x1, y1, x2, y2, pose,
                         (float(det.get("confidence", 0)) / 100.0) if det.get("confidence") is not None else None,
                         _json(det)),
                    )

                order = next((o for o in (state.get("dispatchOrders") or []) if o.get("incidentId") == code), None)
                if order:
                    order_team_code = str(order.get("teamId") or "")
                    order_team_id = team_ids.get(order_team_code)
                    if order_team_id is None and order_team_code:
                        # Seeded historical orders may reference teams that are not in the
                        # active roster. Keep a minimal legacy team row so the FK is valid.
                        lat, lng = (region.get("center") or [0, 0])[:2]
                        cur = _conn.execute(
                            """INSERT INTO rescue_teams
                               (team_code, team_name, leader_name, team_lat, team_lng, status, specialty,
                                capacity, equipment, updated_at, created_at, payload_json)
                               VALUES (?, ?, NULL, ?, ?, 'offline', 'urban_sar', 1, NULL, ?, ?, ?)""",
                            (order_team_code, order_team_code, float(lat), float(lng), now_iso(), now_iso(),
                             _json({"id": order_team_code, "name": order_team_code, "status": "Offline",
                                    "members": 1, "capacity": 1, "area": province})),
                        )
                        order_team_id = cur.lastrowid
                        team_ids[order_team_code] = order_team_id
                    _conn.execute(
                        """INSERT INTO dispatches
                           (dispatch_code, report_id, team_id, dispatch_status, match_score,
                            dispatched_at, confirmed_at, completed_at, override_reason,
                            priority_snapshot_json, rule_evaluation_json, payload_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (str(order.get("id") or f"DSP-{report_pk}"), report_pk,
                         order_team_id, _dispatch_status(order.get("status")),
                         order.get("matchScore"), order.get("createdAt") or now_iso(),
                         order.get("confirmedAt") or order.get("acceptedAt"), order.get("completedAt"),
                         order.get("overrideReason"), _json(order.get("prioritySnapshot") or {}),
                         _json(order.get("ruleEvaluation") or {}), _json(order)),
                    )

                # Successful upload attempt (one per report in the demo).
                upload_token = report.get("uploadToken")
                attempt_code = f"ATT-{str(upload_token)[:10].upper()}" if upload_token else f"ATT-{report_pk}"
                _conn.execute(
                    """INSERT OR REPLACE INTO upload_attempts
                       (attempt_code, report_id, file_name, result, error_code, attempted_at,
                        upload_token, media_name, fingerprint, metadata_json, metadata_source, payload_json)
                       VALUES (?, ?, ?, 'success', NULL, ?, ?, ?, ?, ?, ?, ?)""",
                    (attempt_code, report_pk, report.get("filename") or f"{code}.jpg",
                     report.get("createdAt") or now_iso(), report.get("uploadToken"),
                     (report.get("image") or "").split("/")[-1], report.get("fingerprint"),
                     _json(report.get("metadata") or {}), report.get("metadataSource"), _json(report)),
                )

            # Failed uploads become UploadAttempt rows, not Reports.
            for report in state.get("reports") or []:
                if report.get("incidentId"):
                    continue
                if report.get("uploadStatus") != "Failed":
                    continue
                errors = report.get("validationErrors") or []
                _conn.execute(
                    """INSERT OR REPLACE INTO upload_attempts
                       (attempt_code, user_id, uav_id, report_id, file_name, result, error_code,
                        attempted_at, upload_token, media_name, fingerprint, metadata_json, metadata_source, payload_json)
                       VALUES (?, NULL, ?, NULL, ?, 'failed', ?, ?, NULL, NULL, ?, ?, ?, ?)""",
                    (str(report.get("id") or f"ATT-{len(report_id_by_code)+len(failed_reports)+1}"),
                     uav_ids.get(str((report.get("uav") or {}).get("id") or "")),
                     report.get("filename") or "upload.jpg", errors[0] if errors else "ERR_UNKNOWN",
                     report.get("createdAt") or now_iso(), report.get("fingerprint"),
                     _json(report.get("metadata") or {}), report.get("metadataSource"), _json(report)),
                )
                failed_reports.append(report)

            # Entity tags for report/team/location attributes.
            for incident in state.get("incidents") or []:
                report_pk = report_id_by_code.get(str(incident.get("id") or ""))
                if not report_pk:
                    continue
                attrs = incident.get("customAttributes") or {}
                for key, entry in attrs.items():
                    tag_id = tag_ids.get(key)
                    if not tag_id:
                        continue
                    value = entry.get("value") if isinstance(entry, dict) else entry
                    _conn.execute(
                        """INSERT OR IGNORE INTO entity_tags(tag_id, entity_type, entity_id, tag_value, tagged_at)
                           VALUES (?, 'Report', ?, ?, ?)""",
                        (tag_id, report_pk, str(value) if value is not None else None, now_iso()),
                    )
            for team in state.get("teams") or []:
                team_pk = team_ids.get(str(team.get("id") or ""))
                if not team_pk:
                    continue
                attrs = team.get("customAttributes") or {}
                for key, entry in attrs.items():
                    tag_id = tag_ids.get(key)
                    if not tag_id:
                        continue
                    value = entry.get("value") if isinstance(entry, dict) else entry
                    _conn.execute(
                        """INSERT OR IGNORE INTO entity_tags(tag_id, entity_type, entity_id, tag_value, tagged_at)
                           VALUES (?, 'RescueTeam', ?, ?, ?)""",
                        (tag_id, team_pk, str(value) if value is not None else None, now_iso()),
                    )

            _conn.execute("COMMIT")
        except Exception:
            _conn.execute("ROLLBACK")
            raise


def _state_from_db(include_audit=True):
    region = _config("region_meta", {}) or {}
    settings = _config("settings", {}) or {}
    rule_meta = _config("rule_engine_meta", {}) or {}
    counters = _config("counters", {}) or {}

    sectors = []
    for row in _conn.execute("SELECT payload_json, area_name, center_lat, center_lng FROM locations ORDER BY location_id"):
        payload = _loads(row[0], {})
        if not payload:
            payload = {"name": row[1], "latitude": row[2], "longitude": row[3]}
        sectors.append(payload)
    if sectors:
        region = {**region, "sectors": sectors}

    uavs = [_loads(row[0], {}) for row in _conn.execute("SELECT payload_json FROM uavs ORDER BY uav_id")]
    teams = []
    for row in _conn.execute("SELECT team_id, payload_json, team_code, team_name, team_lat, team_lng, status, capacity, equipment FROM rescue_teams ORDER BY team_id"):
        payload = _loads(row[1], {})
        if not payload:
            status = str(row[6] or "available")
            payload = {"id": row[2], "name": row[3], "latitude": row[4], "longitude": row[5],
                       "status": "On Mission" if status == "on_mission" else status.title(),
                       "members": row[7], "equipment": row[8]}
        payload.setdefault("id", row[2])
        payload.setdefault("name", row[3])
        payload.setdefault("latitude", row[4])
        payload.setdefault("longitude", row[5])
        payload.setdefault("members", row[7])
        payload.setdefault("capacity", row[7])
        teams.append(payload)

    reports = []
    incidents = []
    for row in _conn.execute("SELECT report_json, incident_json FROM reports ORDER BY report_id"):
        report = _loads(row[0], {})
        incident = _loads(row[1], {})
        if report:
            reports.append(report)
        if incident:
            incidents.append(incident)
    for row in _conn.execute("SELECT payload_json FROM upload_attempts WHERE result='failed' ORDER BY attempt_id"):
        payload = _loads(row[0], {})
        if payload:
            reports.append(payload)

    dispatch_orders = []
    for row in _conn.execute("SELECT payload_json, dispatch_code, report_id, dispatch_status, match_score, dispatched_at, confirmed_at, completed_at, override_reason, priority_snapshot_json, rule_evaluation_json FROM dispatches ORDER BY dispatch_id"):
        payload = _loads(row[0], {})
        if not payload:
            report = _conn.execute("SELECT report_code FROM reports WHERE report_id=?", (row[2],)).fetchone()
            payload = {"id": row[1], "incidentId": report[0] if report else None,
                       "status": row[3].title(), "matchScore": row[4], "createdAt": row[5],
                       "confirmedAt": row[6], "completedAt": row[7], "overrideReason": row[8],
                       "prioritySnapshot": _loads(row[9], {}), "ruleEvaluation": _loads(row[10], {})}
        dispatch_orders.append(payload)

    tags = [_loads(row[0], {}) for row in _conn.execute("SELECT payload_json FROM tags ORDER BY tag_id")]
    rules = [_loads(row[0], {}) for row in _conn.execute("SELECT payload_json FROM rules ORDER BY rule_id")]
    settings["ruleEngine"] = {**(rule_meta or {}), "rules": rules}

    state = {
        "schemaVersion": 2,
        "regionMeta": region,
        "uavs": uavs,
        "reports": reports,
        "incidents": incidents,
        "teams": teams,
        "dispatchOrders": dispatch_orders,
        "settings": settings,
        "customTagSchema": tags,
        "counters": counters,
        "updatedAt": _conn.execute("SELECT value FROM app_meta WHERE key='updated_at'").fetchone()[0] if _conn.execute("SELECT value FROM app_meta WHERE key='updated_at'").fetchone() else now_iso(),
        "audit": _audit_rows() if include_audit else [],
    }
    state["auditSeq"] = len(state["audit"])
    return state


def state_from_db(include_audit=True):
    # Serialize projections with imports so a concurrent reader never sees a
    # half-rewritten domain table.
    with _lock:
        return _state_from_db(include_audit)


def read_state(include_audit=True):
    return state_from_db(include_audit)


def mutate(change, audit=None, actor=None):
    with _lock:
        state = state_from_db(include_audit=False)
        if change(state) is False:
            return version(), None
        import_state(state)
        new_version = _bump_version()
        record = None
        if audit:
            actor = actor or {"id": "SYSTEM", "name": "System", "role": "System"}
            changes = list(audit.get("changes") or [])[:40]
            record = {
                "id": "",
                "event": str(audit.get("event") or "STATE_UPDATED")[:80],
                "detail": str(audit.get("detail") or "")[:500],
                "at": now_iso(),
                "actor": actor,
                "changes": changes,
            }
            _insert_audit_record(record)
            log_id = _conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            record["id"] = f"AUD-{log_id:05d}"
            _conn.execute("UPDATE audit_log SET payload_json=?, changes_json=? WHERE log_id=?",
                          (_json(record), _json(changes), log_id))
        return new_version, record


def apply_ops(ops, audit=None, actor=None, enforce=None):
    def change(state):
        for op in ops:
            key = op.get("key")
            if key in ("audit", "auditSeq", "updatedAt"):
                continue
            if op.get("op") == "set":
                state[key] = op.get("value")
                continue
            items = state.setdefault(key, [])
            if not isinstance(items, list):
                raise ValueError(f"{key} is not a collection")
            pos = next((i for i, item in enumerate(items) if isinstance(item, dict) and item.get("id") == op.get("id")), None)
            if op.get("op") == "delete":
                if pos is not None:
                    items.pop(pos)
            elif op.get("op") == "upsert":
                if pos is not None:
                    items[pos] = op.get("value")
                else:
                    items.insert(min(max(int(op.get("index", len(items))), 0), len(items)), op.get("value"))
            else:
                raise ValueError(f"Unknown op {op.get('op')!r}")
        if enforce:
            enforce(state)
    return mutate(change, audit, actor)
