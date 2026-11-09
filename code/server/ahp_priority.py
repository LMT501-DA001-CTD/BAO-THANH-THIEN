"""Adapter between the demo's shared state document and backend_ml/ahp_topsis.py.

The bundled AHP/TOPSIS module expects database-style frames (RescueTeam + TeamCoverage).
The demo stores camelCase incidents, reports and teams in SQLite, so this module derives
the missing columns at request time instead of migrating saved state:

  - team_type   inferred from team id/name/equipment
  - team_lat    team HQ latitude from the dataset (district centroid fallback)
  - team_lng    team HQ longitude from the dataset (district centroid fallback)
  - capacity    deployable sub-units, derived from headcount // 4 (at least 1)
  - coverage    team x district rows within COVERAGE_RADIUS_KM of the team HQ

The relational target model defines RescueTeam.capacity as headcount. The demo's
`members` field is that headcount; AHP still needs a concurrent-assignment limit, so
it derives `deployableUnits` (or headcount // 4) at read time.

Everything here is read-only with respect to the shared state.
"""
from __future__ import annotations

import logging
import math
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import config

if str(config.ML_DIR) not in sys.path:
    sys.path.insert(0, str(config.ML_DIR))

try:
    import ahp_topsis  # noqa: E402  (path is prepared above)
except Exception as exc:  # the demo must still start without pandas/numpy
    ahp_topsis = None
    _AHP_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
else:
    _AHP_IMPORT_ERROR = None

log = logging.getLogger("skyrescue.ahp")

DIST = "distance_to_nearest_team_km"
EARTH_KM = 6371.0088

# How far a team is assumed to cover around its headquarters. The demo has 7 teams and
# 22 districts, so a stricter one-district rule would leave most reports with no team.
COVERAGE_RADIUS_KM = 10.0

TYPE_MAP = {
    "fire": "Fire",
    "flood": "Flood",
    "building collapse": "Collapsed",
    "collapsed": "Collapsed",
    "traffic accident": "Traffic",
    "traffic": "Traffic",
}
RANGE_SECONDS = {"24h": 24 * 3600, "7d": 7 * 24 * 3600, "30d": 30 * 24 * 3600}


def _number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def _incident_type(incident):
    raw = incident.get("reviewedType") or incident.get("originalType") or incident.get("type") or ""
    return TYPE_MAP.get(str(raw).strip().lower())


def _parse_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _within_range(created_at, time_range):
    if not time_range or time_range in ("all", "All"):
        return True
    seconds = RANGE_SECONDS.get(str(time_range))
    if seconds is None:
        return True
    created = _parse_time(created_at)
    return created is None or created >= datetime.now(timezone.utc) - timedelta(seconds=seconds)


def _sector_centres(state):
    """name -> (lat, lng) for every district known to the active region."""
    centres = {}
    for sector in (state.get("regionMeta") or {}).get("sectors") or []:
        name = sector.get("name")
        lat = _number(sector.get("latitude", sector.get("lat")))
        lng = _number(sector.get("longitude", sector.get("lng")))
        if name and lat is not None and lng is not None:
            centres[str(name)] = (lat, lng)
    return centres


def _incident_coordinates(incident, reports):
    location = incident.get("location") or {}
    lat, lng = _number(location.get("latitude")), _number(location.get("longitude"))
    if lat is not None and lng is not None:
        return lat, lng
    report = reports.get(incident.get("reportId")) or {}
    metadata = report.get("metadata") or {}
    return _number(metadata.get("latitude")), _number(metadata.get("longitude"))


def _team_is_free(team, state):
    if str(team.get("status") or "").strip().lower() != "available":
        return False
    team_id = team.get("id")
    for order in state.get("dispatchOrders") or []:
        if not isinstance(order, dict):
            continue
        if order.get("status") in ("Completed", "Cancelled"):
            continue
        if order.get("teamId") == team_id:
            return False
    return True


def _team_type(team):
    text = " ".join(str(team.get(key) or "") for key in ("id", "name", "equipment", "area")).lower()
    if any(word in text for word in ("pccc", "fire", "chữa cháy", "chua chay")):
        return "fire"
    if any(word in text for word in ("traffic", "highway", "giao thông", "giao thong")):
        return "traffic_rescue"
    if any(word in text for word in ("water", "flood", "boat", "waterway", "ngập", "ngap", "thủy", "thuy")):
        return "water_rescue"
    return "urban_sar"


def _team_frames(state, centres):
    """Build the RescueTeam frame plus inferred coverage rows.

    ahp_topsis treats team ids as integers (`int(team_id)`), while the demo uses ids like
    "SAR-01". The adapter therefore hands the module small numeric surrogates and maps
    them back before returning anything to the client.
    """
    region = state.get("regionMeta") or {}
    fallback = region.get("center") or [16.0544, 108.2022]
    fallback_lat, fallback_lng = _number(fallback[0]), _number(fallback[1])

    team_rows = []
    coverage = []
    team_types = {}
    team_id_map = {}
    for index, team in enumerate(state.get("teams") or [], start=1):
        if not isinstance(team, dict) or not team.get("id"):
            continue
        team_id = str(team["id"])
        area = str(team.get("area") or "")
        team_lat, team_lng = _number(team.get("latitude")), _number(team.get("longitude"))
        hq = (team_lat, team_lng) if team_lat is not None and team_lng is not None else (centres.get(area) or (fallback_lat, fallback_lng))
        if hq[0] is None or hq[1] is None:
            continue
        team_type = _team_type(team)
        members = _number(team.get("members")) or 0
        # RescueTeam.capacity is headcount in the target model. AHP still needs a
        # concurrent-assignment limit, so use the explicit deployableUnits field when
        # present, otherwise derive one sub-unit per four officers (at least one).
        headcount = _number(team.get("capacity"))
        if headcount is None:
            headcount = members
        deployable = _number(team.get("deployableUnits"))
        if deployable is None:
            deployable = max(1, int(headcount) // 4)
        team_rows.append({
            "team_id": index,
            "team_type": team_type,
            "team_lat": hq[0],
            "team_lng": hq[1],
            "status": "available" if _team_is_free(team, state) else "busy",
            "capacity": max(1, int(deployable)),
        })
        team_types[team_id] = team_type
        team_id_map[index] = team_id
        # TeamCoverage: explicit provincial coverage first, then the 10 km seed rule.
        explicit = team.get("coverage") or []
        if isinstance(explicit, str):
            explicit = [explicit]
        for name in explicit:
            name = str(name or "").strip()
            if name:
                coverage.append({"team_id": index, "location_id": name})
        for location_id, (lat, lng) in centres.items():
            if location_id == area or _haversine_km(hq[0], hq[1], lat, lng) <= COVERAGE_RADIUS_KM:
                coverage.append({"team_id": index, "location_id": location_id})
        if area and area not in centres:
            coverage.append({"team_id": index, "location_id": area})

    # A team can cover several districts; duplicate rows break the coverage join.
    coverage = [
        {"team_id": team_id, "location_id": location_id}
        for team_id, location_id in {(row["team_id"], row["location_id"]) for row in coverage}
    ]
    return pd.DataFrame(team_rows), pd.DataFrame(coverage), team_types, team_id_map


def _build_inputs(state, incidents):
    reports = {report.get("id"): report for report in state.get("reports") or [] if isinstance(report, dict)}
    centres = _sector_centres(state)
    skipped = []

    severity_results, geo_rows = [], []
    for incident in incidents:
        incident_id = incident.get("id")
        if not incident_id:
            continue
        incident_type = _incident_type(incident)
        severity = _number(incident.get("severityScore"))
        if incident_type is None or severity is None:
            skipped.append(incident_id)
            continue
        lat, lng = _incident_coordinates(incident, reports)
        district = str((incident.get("location") or {}).get("district") or "").strip()
        if lat is None or lng is None or not district:
            skipped.append(incident_id)
            continue
        centres.setdefault(district, (lat, lng))
        severity_results.append({
            "prediction_id": incident_id,
            "incident_type": incident_type,
            "severity_score": max(0.0, min(1.0, severity / 100.0)),
            "needs_review": incident.get("verificationStatus") != "verified",
        })
        geo_rows.append({
            "prediction_id": incident_id,
            "gps_lat": lat,
            "gps_lng": lng,
            "location_id": district,
        })

    teams, coverage, team_types, team_id_map = _team_frames(state, centres)
    return severity_results, pd.DataFrame(geo_rows), teams, coverage, team_types, team_id_map, skipped


def _clean(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return value.item()
        except (ValueError, AttributeError):
            pass
    return value


def rank_state(state, time_range="7d"):
    """Rank every active emergency incident with the bundled AHP/TOPSIS module.

    Verified and unverified incidents share one queue. Normal and Unclassified
    rows stay visible in the queue but are skipped by the adapter because they have
    no dispatchable emergency type. Dispatch still requires coordinator verification.
    """
    if not isinstance(state, dict):
        return {"range": time_range, "rows": [], "skipped": [], "error": "No shared state yet"}

    incidents = [
        incident for incident in state.get("incidents") or []
        if isinstance(incident, dict)
        and incident.get("status") != "Resolved"
        and _within_range(incident.get("createdAt"), time_range)
    ]
    severity_results, geo, teams, coverage, team_types, team_id_map, skipped = _build_inputs(state, incidents)

    base = {
        "range": time_range,
        "scope": "joint",
        "coverageRadiusKm": COVERAGE_RADIUS_KM,
        "teamTypes": team_types,
        "skipped": skipped,
    }
    if not severity_results:
        return {**base, "rows": [], "weights": {}, "consistencyRatio": None}
    if ahp_topsis is None:
        return {**base, "rows": [], "weights": {}, "consistencyRatio": None, "error": f"AHP module unavailable: {_AHP_IMPORT_ERROR}"}

    try:
        ranked = ahp_topsis.rank_router_outputs(
            severity_results, geo, teams, coverage, ahp_topsis.AHPConfig(), scope="joint",
        )
    except Exception as exc:  # keep the demo usable if the adapter data is incomplete
        log.warning("AHP ranking failed: %s", exc)
        return {**base, "rows": [], "weights": {}, "consistencyRatio": None, "error": f"{type(exc).__name__}: {exc}"}

    rows = []
    for record in ranked.to_dict("records"):
        nearest = _clean(record.get("nearest_team_id"))
        assigned = _clean(record.get("assigned_team_id"))
        rows.append({
            "incidentId": record.get("prediction_id"),
            "predictionId": record.get("prediction_id"),
            "incidentType": record.get("incident_type"),
            "severityScore": _clean(record.get("severity_score")),
            "needsReview": bool(record.get("needs_review")),
            "locationId": record.get("location_id"),
            "nearestTeamId": team_id_map.get(int(nearest)) if nearest is not None else None,
            "distanceToNearestTeamKm": _clean(record.get(DIST)),
            "freeTeams": _clean(record.get("free_teams")),
            "priorityScore": _clean(record.get("priority_score")),
            "priorityRank": _clean(record.get("priority_rank")),
            "assignedTeamId": team_id_map.get(int(assigned)) if assigned is not None else None,
            "noTeamFlag": bool(record.get("no_team_flag")),
            "priorityComputedAt": _clean(record.get("priority_computed_at")),
        })
    rows.sort(key=lambda row: (row["priorityRank"] is None, row["priorityRank"] or 0))

    attrs = ranked.attrs
    return {
        **base,
        "rows": rows,
        "weights": attrs.get("ahp_weights") or {},
        "consistencyRatio": attrs.get("ahp_cr"),
        "freeTeamsBenefit": attrs.get("free_teams_benefit"),
        "distanceBenefit": attrs.get("distance_benefit"),
        "skippedNotIncident": attrs.get("skipped_not_incident") or [],
    }
