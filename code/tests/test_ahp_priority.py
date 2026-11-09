"""AHP adapter contract: all active incidents, reviewed severity, patch direction flags."""
from server import ahp_priority


def _state():
    return {
        "regionMeta": {
            "operatingArea": "Test City",
            "center": [10.80, 106.70],
            "sectors": [
                {"name": "Alpha", "latitude": 10.80, "longitude": 106.70},
                {"name": "Beta", "latitude": 10.85, "longitude": 106.75},
            ],
        },
        "teams": [
            {"id": "FIRE-01", "name": "Fire", "area": "Alpha", "members": 8, "status": "Available",
             "latitude": 10.801, "longitude": 106.701, "equipment": "fire engine"},
            {"id": "WATER-01", "name": "Water", "area": "Beta", "members": 8, "status": "Available",
             "latitude": 10.851, "longitude": 106.751, "equipment": "rescue boat"},
        ],
        "reports": [
            {"id": "REP-V", "metadata": {"latitude": 10.802, "longitude": 106.702}},
            {"id": "REP-U", "metadata": {"latitude": 10.803, "longitude": 106.703}},
        ],
        "incidents": [
            {"id": "INC-V", "reportId": "REP-V", "reviewedType": "Flood", "severityScore": 80,
             "verificationStatus": "verified", "status": "Matching Team",
             "location": {"district": "Alpha", "latitude": 10.802, "longitude": 106.702}},
            {"id": "INC-U", "reportId": "REP-U", "reviewedType": "Flood", "severityScore": 99,
             "verificationStatus": "unverified", "status": "Unverified",
             "location": {"district": "Alpha", "latitude": 10.803, "longitude": 106.703}},
        ],
    }


def test_ahp_ranks_all_active_incidents_and_uses_final_severity():
    payload = ahp_priority.rank_state(_state(), "all")
    assert "error" not in payload
    rows = {row["incidentId"]: row for row in payload["rows"]}
    assert set(rows) == {"INC-V", "INC-U"}
    assert rows["INC-V"]["severityScore"] == 0.8
    assert rows["INC-U"]["severityScore"] == 0.99
    assert payload["distanceBenefit"] is True
    assert payload["freeTeamsBenefit"] is False


def test_ahp_uses_raw_severity_and_keeps_weights():
    state = _state()
    state["incidents"][0]["detectedPeopleCount"] = 3
    state["incidents"][0]["nonUprightCount"] = 1
    payload = ahp_priority.rank_state(state, "all")
    row = {item["incidentId"]: item for item in payload["rows"]}["INC-V"]
    assert row["severityScore"] == 0.8
    assert "severityEffective" not in row
    assert "lifeMultiplier" not in row
    assert payload["weights"]["severity_score"] == 0.648
    assert payload["weights"]["distance_to_nearest_team_km"] == 0.230
    assert payload["weights"]["free_teams"] == 0.122
    assert payload["consistencyRatio"] == 0.003


def test_ahp_skips_normal_and_unclassified_even_when_active():
    state = _state()
    state["incidents"].extend([
        {"id": "INC-N", "reportId": "REP-V", "originalType": "Normal", "severityScore": 0,
         "verificationStatus": "unverified", "status": "Unverified",
         "location": {"district": "Alpha", "latitude": 10.802, "longitude": 106.702}},
        {"id": "INC-X", "reportId": "REP-U", "originalType": "Unclassified", "severityScore": 50,
         "verificationStatus": "unverified", "status": "Unverified",
         "location": {"district": "Alpha", "latitude": 10.803, "longitude": 106.703}},
    ])
    payload = ahp_priority.rank_state(state, "all")
    assert {row["incidentId"] for row in payload["rows"]} == {"INC-V", "INC-U"}
