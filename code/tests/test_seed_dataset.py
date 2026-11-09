"""Release gate for the national demo seed: images, provinces, coverage, queue split."""
import json
from pathlib import Path

from server import ahp_priority, config

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "server" / "seed_state.json"
NATIONAL_BOUNDS = {"minLat": 8.55, "maxLat": 23.39, "minLng": 102.14, "maxLng": 109.47}


def _seed():
    return json.loads(SEED.read_text(encoding="utf-8"))


def test_national_seed_has_twenty_images_and_seven_provinces():
    state = _seed()
    assert len(state["incidents"]) == 20
    assert len(state["reports"]) == 20
    assert len(state["teams"]) == 18
    assert len(state["dispatchOrders"]) == 10
    provinces = {item["location"]["province"] for item in state["incidents"]}
    assert provinces == {"Ho Chi Minh City", "Ha Noi", "Da Nang", "Can Tho", "Khanh Hoa", "Lam Dong", "Quang Nam"}
    assert all(item["image"].startswith("/samples/EXT") for item in state["incidents"])
    assert all(not item["image"].endswith(".svg") for item in state["incidents"])
    for item in state["incidents"]:
        assert (config.SAMPLES_DIR / Path(item["image"]).name).is_file()
        assert item["location"]["district"]
        assert NATIONAL_BOUNDS["minLat"] <= item["location"]["latitude"] <= NATIONAL_BOUNDS["maxLat"]
        assert NATIONAL_BOUNDS["minLng"] <= item["location"]["longitude"] <= NATIONAL_BOUNDS["maxLng"]


def test_queue_split_is_fifteen_open_and_five_resolved():
    state = _seed()
    statuses = {}
    for item in state["incidents"]:
        statuses[item["status"]] = statuses.get(item["status"], 0) + 1
    assert statuses == {"Unverified": 4, "Matching Team": 4, "In Progress": 7, "Resolved": 5}


def test_every_dispatchable_incident_has_a_free_matching_team():
    state = _seed()
    payload = ahp_priority.rank_state(state, "all")
    assert not payload.get("error"), payload.get("error")
    rows = {row["incidentId"]: row for row in payload["rows"]}
    for incident in state["incidents"]:
        if incident["status"] not in ("Unverified", "Matching Team"):
            continue
        if incident["originalType"] in ("Normal", "Unclassified"):
            continue
        row = rows.get(incident["id"])
        assert row is not None, incident["id"]
        assert row["noTeamFlag"] is False, (incident["id"], row)
        assert row["nearestTeamId"] not in (None, ""), (incident["id"], row)


def test_one_dispatch_per_incident_and_team_coverage_rows_exist():
    state = _seed()
    incident_ids = {item["id"] for item in state["incidents"]}
    dispatch_ids = [item["incidentId"] for item in state["dispatchOrders"]]
    assert len(dispatch_ids) == len(set(dispatch_ids))
    assert set(dispatch_ids) <= incident_ids
    for team in state["teams"]:
        assert isinstance(team.get("coverage"), list) and team["coverage"], team["id"]
