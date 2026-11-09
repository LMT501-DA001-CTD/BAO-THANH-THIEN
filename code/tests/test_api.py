"""State sync, sessions and audit (Phase 3). The ML models are not loaded here."""
import pytest
from fastapi.testclient import TestClient

from server.main import app

PASSWORDS = {"reporter": ("REPORTER", "Reporter#2025"), "dispatch": ("DISPATCH", "Dispatch#2025")}


@pytest.fixture(scope="module")
def clients():
    with TestClient(app) as reporter, TestClient(app) as dispatch:
        for portal, client in (("reporter", reporter), ("dispatch", dispatch)):
            user, password = PASSWORDS[portal]
            assert client.post("/api/login", json={"identifier": user, "password": password, "portal": portal}).status_code == 200
            client.headers["X-Portal"] = portal
        yield reporter, dispatch


def test_login_rejects_bad_password_and_wrong_portal():
    with TestClient(app) as client:
        assert client.post("/api/login", json={"identifier": "REPORTER", "password": "wrong", "portal": "reporter"}).status_code == 401
        assert client.post("/api/login", json={"identifier": "REPORTER", "password": "Reporter#2025", "portal": "dispatch"}).status_code == 403


def test_sync_needs_a_session():
    with TestClient(app) as client:
        res = client.post("/api/sync", headers={"X-Portal": "dispatch"}, json={"ops": []})
        assert res.status_code == 401


def test_change_from_one_portal_shows_in_the_other(clients):
    reporter, dispatch = clients
    seed = {"op": "set", "key": "incidents", "value": [{"id": "INC-1", "reportId": "INC-1", "status": "Unverified", "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}]}
    reporter.post("/api/sync", json={"ops": [seed, {"op": "set", "key": "reports", "value": []}]})
    before = dispatch.get("/api/version").json()["version"]

    new_report = {"op": "upsert", "key": "incidents", "id": "INC-2", "index": 0, "value": {"id": "INC-2", "reportId": "INC-2", "status": "Unverified", "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}}
    res = reporter.post("/api/sync", json={"ops": [new_report], "audit": {"event": "REPORT_SUBMITTED", "changes": []}})
    assert res.status_code == 200

    assert dispatch.get("/api/version").json()["version"] == before + 1
    state = dispatch.get("/api/state").json()["state"]
    assert {r["id"] for r in state["incidents"]} == {"INC-1", "INC-2"}


def test_entity_merge_keeps_both_writers(clients):
    reporter, dispatch = clients
    dispatch.post("/api/sync", json={"ops": [{"op": "upsert", "key": "incidents", "id": "INC-1", "value": {"id": "INC-1", "reportId": "INC-1", "status": "Resolved", "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}}]})
    reporter.post("/api/sync", json={"ops": [{"op": "upsert", "key": "incidents", "id": "INC-3", "index": 0, "value": {"id": "INC-3", "reportId": "INC-3", "status": "Unverified", "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}}]})
    incidents = {r["id"]: r["status"] for r in dispatch.get("/api/state").json()["state"]["incidents"]}
    assert incidents["INC-1"] == "Resolved" and incidents["INC-3"] == "Unverified"


def test_audit_actor_comes_from_the_session(clients):
    reporter, dispatch = clients
    fake = {"event": "REPORT_SUBMITTED", "detail": "x", "changes": [], "actor": {"id": "DISPATCH"}}
    record = reporter.post("/api/sync", json={"ops": [], "audit": fake}).json()["audit"]
    assert record["actor"]["id"] == "REPORTER"
    audit = dispatch.get("/api/state").json()["state"]["audit"]
    assert audit[0]["id"] == record["id"] and audit[0]["actor"]["id"] == "REPORTER"


def test_reporter_cannot_read_audit_or_write_server_keys(clients):
    reporter, _ = clients
    reporter.post("/api/sync", json={"ops": [{"op": "set", "key": "audit", "value": [{"id": "FAKE"}]}]})
    assert reporter.get("/api/state").json()["state"]["audit"] == []


def test_ml_predict_is_dispatch_only_and_checks_magic_bytes(clients):
    reporter, dispatch = clients
    svg = ("x.jpg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/jpeg")
    assert reporter.post("/api/ml/predict", files={"image": svg}).status_code == 403
    assert dispatch.post("/api/ml/predict", files={"image": svg}).status_code == 415


def test_citizen_registration_makes_an_unverified_reporter_account():
    with TestClient(app) as client:
        body = {"name": "Test Citizen", "phone": "0900 555 123", "password": "Secret#123"}
        res = client.post("/api/register", json=body)
        assert res.status_code == 200
        user = res.json()["user"]
        assert user["role"] == "Citizen" and user["verified"] is False and user["portal"] == "reporter"
        assert client.get("/api/version", headers={"X-Portal": "reporter"}).status_code == 200  # signed in
        assert client.post("/api/register", json=body).status_code == 409
        assert client.post("/api/register", json={**body, "phone": "0900555999", "password": "short"}).status_code == 422
        login = {"identifier": "0900555123", "password": "Secret#123"}
        assert client.post("/api/login", json={**login, "portal": "reporter"}).status_code == 200
        assert client.post("/api/login", json={**login, "portal": "dispatch"}).status_code == 403


@pytest.mark.parametrize("user, password", [("citizen", "Citizen#2025"), ("uav07", "Uav07#2025"), ("ctv01", "Ctv01#2025")])
def test_demo_reporter_accounts_sign_in(user, password):
    with TestClient(app) as client:
        res = client.post("/api/login", json={"identifier": user, "password": password, "portal": "reporter"})
        assert res.status_code == 200, res.text


@pytest.fixture
def clean_rate_limit():
    from server import auth
    auth._attempts.clear()
    yield
    auth._attempts.clear()


def test_login_rate_limit_blocks_after_ten_failures(clean_rate_limit):
    with TestClient(app) as client:
        bad = {"identifier": "DISPATCH", "password": "wrong", "portal": "dispatch"}
        codes = [client.post("/api/login", json=bad).status_code for _ in range(11)]
        assert codes[:10] == [401] * 10 and codes[10] == 429
