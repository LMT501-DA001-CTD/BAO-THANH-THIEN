"""Layer 1 server check, upload token flow and the automatic ML job (Phases 4-5). ML models are not loaded here."""
import io
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from server import api_reports, exif, ml_service
from server.main import app

UAV = {"id": "AEGIS-UAV-07", "make": "DJI", "model": "DJI Mavic 3 Enterprise", "serial": "1581F5FJD22A0007", "registered": True}
BOUNDS = {"minLat": 8.55, "maxLat": 23.39, "minLng": 102.14, "maxLng": 109.47}
STATE = {"uavs": [UAV], "regionMeta": {"coverageBounds": BOUNDS}, "reports": [], "incidents": []}


def _dms(value):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    return (d, m, round((value - d - m / 60) * 3600, 4))


def jpeg(lat=10.80172, lng=106.71212, taken=None, make="DJI", serial=UAV["serial"], seed=0):
    """Make a JPEG with EXIF GPS, capture time (with offset) and camera fields."""
    image = Image.new("RGB", (320, 240), (seed % 255, 80, 120))
    tags = image.getexif()
    tags[271], tags[272] = make, "DJI Mavic 3 Enterprise"
    taken = taken or datetime.now(timezone.utc) - timedelta(minutes=5)
    # Assign the sub-IFDs as dicts. Pillow 11 does not save sub-IFDs that get_ifd() made on a new image.
    tags[0x8769] = {36867: taken.strftime("%Y:%m:%d %H:%M:%S"), 36881: "+00:00", 42033: serial}
    if lat is not None:
        tags[0x8825] = {1: "N" if lat >= 0 else "S", 2: _dms(lat), 3: "E" if lng >= 0 else "W", 4: _dms(lng)}
    out = io.BytesIO()
    image.save(out, "JPEG", exif=tags)
    return out.getvalue()


def noise_jpeg(seed=0, quality=90):
    """Make a textured JPEG (dHash needs real pixel variation, unlike a flat test colour)."""
    import random
    rng = random.Random(seed)
    image = Image.new("L", (160, 120))
    image.putdata([rng.randrange(256) for _ in range(160 * 120)])
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality)
    return out.getvalue()


def test_bundled_demo_samples_manifest_and_files():
    from server import config
    entries = json.loads((config.SAMPLES_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert len(entries) == 20
    for entry in entries:
        path = config.SAMPLES_DIR / entry["file"]
        assert path.is_file(), entry["file"]
        assert path.read_bytes().startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n"))


def test_upload_limit_is_35_mb():
    from server import config
    assert config.MAX_UPLOAD_MB == 35


def test_exif_reader_gets_gps_time_and_serial():
    meta = exif.read_metadata(jpeg())
    assert abs(meta["latitude"] - 10.80172) < 1e-4 and abs(meta["longitude"] - 106.71212) < 1e-4
    assert meta["uavSerialNumber"] == UAV["serial"] and meta["cameraMake"] == "DJI"
    assert datetime.now(timezone.utc) - datetime.fromisoformat(meta["captureTime"].replace("Z", "+00:00")) < timedelta(minutes=6)


@pytest.mark.parametrize("kwargs, error", [
    ({"lat": None}, "gps"),                                   # no GPS
    ({"lat": 13.7563, "lng": 100.5018}, "gps"),              # Bangkok: outside the national geofence
    ({"taken": datetime.now(timezone.utc) - timedelta(hours=2)}, "time"),   # older than 30 minutes
    ({"serial": "F2LXK9Q1N0", "make": "Apple"}, "source"),    # wrong UAV serial and make
])
def test_layer1_rejects(kwargs, error):
    data = jpeg(**kwargs)
    meta, _ = api_reports.build_metadata(exif.read_metadata(data), {"mode": "drone"}, demo_mode=False)
    errors = api_reports.layer1_errors(STATE, {"mode": "drone", "uavId": UAV["id"]}, meta, True, "fp")
    assert errors == [error]


def test_layer1_accepts_hanoi_inside_national_bounds():
    data = jpeg(lat=21.0285, lng=105.8542)
    meta, _ = api_reports.build_metadata(exif.read_metadata(data), {"mode": "drone"}, demo_mode=False)
    errors = api_reports.layer1_errors(STATE, {"mode": "drone", "uavId": UAV["id"]}, meta, True, "fp-hanoi")
    assert errors == []


def test_demo_preset_is_used_only_in_demo_mode():
    claims = {"mode": "drone", "demoMetadata": {"latitude": 50.0, "longitude": 8.0}}
    _, source = api_reports.build_metadata(exif.read_metadata(jpeg()), claims, demo_mode=False)
    assert source == "exif"
    meta, source = api_reports.build_metadata(exif.read_metadata(jpeg()), claims, demo_mode=True)
    assert source == "demo_preset" and meta["latitude"] == 50.0


def test_browser_gps_is_only_a_fallback_for_missing_exif():
    live = {"liveGps": {"latitude": 10.9, "longitude": 106.9, "source": "Browser geolocation"}}
    # EXIF GPS exists: keep it, even when the browser has a live fix.
    meta, source = api_reports.build_metadata(exif.read_metadata(jpeg()), {"mode": "personal", **live}, demo_mode=False)
    assert source == "exif" and abs(meta["latitude"] - 10.80172) < 1e-4
    # No EXIF GPS: use the live browser fallback.
    meta, source = api_reports.build_metadata(exif.read_metadata(jpeg(lat=None)), {"mode": "personal", **live}, demo_mode=False)
    assert source == "browser_gps" and meta["latitude"] == 10.9 and meta["longitude"] == 106.9


def test_gps_conflict_flags_exif_vs_live_gps_over_300m():
    meta = exif.read_metadata(jpeg())
    same = api_reports._gps_conflict(meta, {"liveGps": {"latitude": 10.80172, "longitude": 106.71212}})
    assert same is None
    far = api_reports._gps_conflict(meta, {"liveGps": {"latitude": 10.81172, "longitude": 106.71212}})
    assert far is not None and far["distanceMeters"] > api_reports.GPS_CONFLICT_METERS
    assert far["exif"]["latitude"] == pytest.approx(10.80172, abs=1e-4)


def test_dhash_survives_recompression_and_separates_different_images():
    first = api_reports._dhash_hex(noise_jpeg(seed=1, quality=90))
    recompressed = api_reports._dhash_hex(noise_jpeg(seed=1, quality=45))
    other = api_reports._dhash_hex(noise_jpeg(seed=2, quality=90))
    assert (int(first, 16) ^ int(recompressed, 16)).bit_count() <= api_reports.DHASH_HAMMING_THRESHOLD
    assert (int(first, 16) ^ int(other, 16)).bit_count() > api_reports.DHASH_HAMMING_THRESHOLD


def test_near_duplicate_returns_the_closest_bound_upload(monkeypatch):
    target = api_reports._dhash_hex(noise_jpeg(seed=3))
    monkeypatch.setattr(api_reports.db, "bound_uploads", lambda: {"tok-1": {"metadata": {"dhash": target}}})
    assert api_reports._near_duplicate(target) == {"ofToken": "tok-1", "hamming": 0}
    other = api_reports._dhash_hex(noise_jpeg(seed=4))
    monkeypatch.setattr(api_reports.db, "bound_uploads", lambda: {"tok-2": {"metadata": {"dhash": other}}})
    assert api_reports._near_duplicate(target) is None


@pytest.fixture(scope="module")
def portals():
    # These tests check the fail-safe path. test_ml_contract can load the real models earlier in the same process.
    loaded = ml_service._status["loaded"]
    ml_service._status["loaded"] = False
    with TestClient(app) as reporter, TestClient(app) as dispatch:
        for portal, client, user, pw in (("reporter", reporter, "REPORTER", "Reporter#2025"), ("dispatch", dispatch, "DISPATCH", "Dispatch#2025")):
            client.post("/api/login", json={"identifier": user, "password": pw, "portal": portal})
            client.headers["X-Portal"] = portal
        dispatch.post("/api/sync", json={"ops": [{"op": "set", "key": k, "value": v} for k, v in STATE.items()]})
        yield reporter, dispatch
    ml_service._status["loaded"] = loaded


def _upload(client, data, claims=None):
    claims = claims or {"mode": "drone", "uavId": UAV["id"]}
    return client.post("/api/uploads", files={"image": ("scene.jpg", data, "image/jpeg")}, data={"claims": json.dumps(claims)}).json()


def _wait(client, check, seconds=5):
    end = time.time() + seconds
    while time.time() < end:
        state = client.get("/api/state").json()["state"]
        if check(state):
            return state
        time.sleep(0.1)
    raise AssertionError("condition not met")


def test_upload_then_report_starts_ml_job_and_server_owns_fields(portals):
    reporter, dispatch = portals
    data = jpeg(seed=1)
    res = _upload(reporter, data)
    assert res["ok"] and res["metadataSource"] == "exif", res
    assert res["metadataFlags"] == {"gpsConflict": None} and res["nearDuplicate"] is None, res
    report = {"id": "INC-LIVE-1", "incidentId": "INC-LIVE-1", "uploadToken": res["uploadToken"], "uploadStatus": "Uploaded",
              "aiResult": {"incidentType": "Fire", "severityScore": 99}, "image": "assets/fake.svg"}
    incident = {"id": "INC-LIVE-1", "reportId": "INC-LIVE-1", "originalType": "Unclassified", "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}
    reporter.post("/api/sync", json={"ops": [
        {"op": "upsert", "key": "reports", "id": "INC-LIVE-1", "index": 0, "value": report},
        {"op": "upsert", "key": "incidents", "id": "INC-LIVE-1", "index": 0, "value": incident}]})

    # The models are marked as not loaded (fixture), so the job must end as Failed + Unclassified (fail-safe).
    state = _wait(dispatch, lambda s: s["reports"][0].get("processingStatus") == "Failed")
    live = state["reports"][0]
    assert live["dataOrigin"] == "Live upload" and live["image"] == res["image"] and live["aiResult"]["status"] == "failed"
    assert state["incidents"][0]["originalType"] == "Unclassified"
    assert any(a["event"] == "AI_FAILED" and a["actor"]["id"] == "SYSTEM" for a in state["audit"])
    assert reporter.get(res["image"]).content == data

    # A client cannot change the AI result of a live report.
    reporter.post("/api/sync", json={"ops": [{"op": "upsert", "key": "reports", "id": "INC-LIVE-1", "value": {**live, "aiResult": {"incidentType": "Fire"}}}]})
    assert dispatch.get("/api/state").json()["state"]["reports"][0]["aiResult"]["status"] == "failed"

    # The same photo again is a duplicate.
    assert _upload(reporter, data)["errors"] == ["duplicate"]


def test_upload_token_works_one_time_and_only_for_its_owner(portals):
    reporter, dispatch = portals
    token = _upload(reporter, jpeg(seed=2))["uploadToken"]
    for rid in ("INC-A", "INC-B"):
        reporter.post("/api/sync", json={"ops": [
            {"op": "upsert", "key": "reports", "id": rid, "index": 0,
             "value": {"id": rid, "incidentId": rid, "uploadToken": token, "uploadStatus": "Uploaded"}},
            {"op": "upsert", "key": "incidents", "id": rid, "index": 0,
             "value": {"id": rid, "reportId": rid, "status": "Unverified",
                       "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}}]})
    reports = {r["id"]: r for r in dispatch.get("/api/state").json()["state"]["reports"]}
    assert reports["INC-A"]["dataOrigin"] == "Live upload" and reports["INC-B"]["dataOrigin"] == "Seeded sample"


def test_upload_rejects_non_images_and_bad_media_names(portals):
    reporter, _ = portals
    res = _upload(reporter, b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    assert "img" in res["errors"] and "uploadToken" not in res
    assert reporter.get("/media/..%2Fskyrescue.db").status_code == 404


def test_report_id_used_again_after_reset_gets_its_own_upload_and_job(portals):
    """DEMO_RESET resets the id counters, so a new report can get the id of an old live report."""
    reporter, dispatch = portals
    first = _upload(reporter, jpeg(seed=3))
    reporter.post("/api/sync", json={"ops": [
        {"op": "upsert", "key": "reports", "id": "INC-SAME", "index": 0,
         "value": {"id": "INC-SAME", "incidentId": "INC-SAME", "uploadToken": first["uploadToken"], "uploadStatus": "Uploaded"}},
        {"op": "upsert", "key": "incidents", "id": "INC-SAME", "index": 0,
         "value": {"id": "INC-SAME", "reportId": "INC-SAME", "status": "Unverified",
                   "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}}]})
    _wait(dispatch, lambda s: next(r for r in s["reports"] if r["id"] == "INC-SAME").get("processingStatus") == "Failed")
    dispatch.post("/api/sync", json={"ops": [{"op": "delete", "key": "incidents", "id": "INC-SAME"}]})  # like DEMO_RESET

    second = _upload(reporter, jpeg(seed=4))
    reporter.post("/api/sync", json={"ops": [
        {"op": "upsert", "key": "reports", "id": "INC-SAME", "index": 0,
         "value": {"id": "INC-SAME", "incidentId": "INC-SAME", "uploadToken": second["uploadToken"], "uploadStatus": "Uploaded"}},
        {"op": "upsert", "key": "incidents", "id": "INC-SAME", "index": 0,
         "value": {"id": "INC-SAME", "reportId": "INC-SAME", "status": "Unverified",
                   "location": {"district": "Alpha", "latitude": 10.8, "longitude": 106.7}}}]})
    report = next(r for r in dispatch.get("/api/state").json()["state"]["reports"] if r["id"] == "INC-SAME")
    assert report["image"] == second["image"]
    assert report["processingStatus"] in ("Queued", "Running", "Failed")
    _wait(dispatch, lambda s: next(r for r in s["reports"] if r["id"] == "INC-SAME").get("aiResult") is not None)


def test_uploads_are_rate_limited_per_client(portals):
    from server import auth
    reporter, _ = portals
    auth._attempts.clear()
    svg = ("x.jpg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/jpeg")
    codes = [reporter.post("/api/uploads", files={"image": svg}, data={"claims": "{}"}).status_code for _ in range(api_reports.UPLOAD_LIMIT + 1)]
    auth._attempts.clear()
    assert codes[:-1] == [200] * api_reports.UPLOAD_LIMIT and codes[-1] == 429
