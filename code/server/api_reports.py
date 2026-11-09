"""Report uploads with the server Layer 1 check, media files, demo samples and AI re-run."""
import hashlib
import io
import json
import math
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel

from . import auth, config, db, exif, live_reports, ml_jobs
from .api_ml import image_suffix

router = APIRouter()
GEOFENCE_MARGIN_DEG = 0.5  # same margin as the client check in reporter.js
MAX_AGE = timedelta(minutes=30)
CLOCK_SKEW = timedelta(seconds=60)
DEMO_KEYS = ("latitude", "longitude", "captureTime", "cameraMake", "cameraModel", "uavSerialNumber")
MEDIA_NAME = re.compile(r"^[0-9a-f]{32}\.(jpg|png)$")
UPLOAD_LIMIT = 30  # uploads per client IP per minute (PROMPT §8)
USER_UPLOAD_LIMIT = 40  # uploads per authenticated account per minute (secondary to the IP cap)
GPS_CONFLICT_METERS = 300  # EXIF vs live GPS disagreement worth a reviewer flag
DHASH_HAMMING_THRESHOLD = 6  # near-duplicate (re-encoded/replayed) image tolerance


def _number(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_time(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _haversine_m(lat1, lng1, lat2, lng2):
    """Distance in metres between two WGS-84 points."""
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def _dhash_hex(data):
    """64-bit difference hash. Cheap, explainable near-duplicate signal; not a signature."""
    try:
        image = Image.open(io.BytesIO(data)).convert("L").resize((9, 8))
        pixels = list(image.getdata())
    except Exception:
        return None
    bits = 0
    for row in range(8):
        for col in range(8):
            left = pixels[row * 9 + col]
            right = pixels[row * 9 + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:016x}"


def _gps_conflict(exif_meta, claims):
    """Flag an EXIF/live-GPS disagreement without changing which value is authoritative."""
    live = claims.get("liveGps") or {}
    exif_lat, exif_lng = _number(exif_meta.get("latitude")), _number(exif_meta.get("longitude"))
    live_lat, live_lng = _number(live.get("latitude")), _number(live.get("longitude"))
    if None in (exif_lat, exif_lng, live_lat, live_lng):
        return None
    meters = _haversine_m(exif_lat, exif_lng, live_lat, live_lng)
    if meters <= GPS_CONFLICT_METERS:
        return None
    return {
        "distanceMeters": round(meters, 1),
        "exif": {"latitude": exif_lat, "longitude": exif_lng},
        "live": {"latitude": live_lat, "longitude": live_lng, "source": str(live.get("source") or "Browser geolocation")[:80]},
    }


def _near_duplicate(dhash, state=None):
    """Compare with images already bound to reports in the current state.

    media_uploads is not cleared by a demo reset, so a token that is no longer
    referenced by a state report must not block a fresh upload.
    """
    if not dhash or dhash in ("0000000000000000", "ffffffffffffffff"):
        return None  # degenerate (flat) hash cannot support a reliable comparison
    active_tokens = {
        report.get("uploadToken")
        for report in (state or {}).get("reports") or []
        if report.get("uploadStatus") == "Uploaded" and report.get("uploadToken")
    }
    target = int(dhash, 16)
    closest = None
    for token, upload in db.bound_uploads().items():
        if state is not None and token not in active_tokens:
            continue
        other = (upload.get("metadata") or {}).get("dhash")
        if not other:
            continue
        try:
            distance = (target ^ int(other, 16)).bit_count()
        except (TypeError, ValueError):
            continue
        if distance <= DHASH_HAMMING_THRESHOLD and (closest is None or distance < closest["hamming"]):
            closest = {"ofToken": token, "hamming": distance}
    return closest


def build_metadata(exif_meta, claims, demo_mode):
    """Merge the metadata: EXIF first, then live browser GPS (personal mode), then a demo preset (DEMO_MODE only)."""
    meta = {k: exif_meta.get(k) for k in DEMO_KEYS}
    source = "exif"
    live = claims.get("liveGps") or {}
    # EXIF GPS is authoritative. Browser geolocation is a fallback for ground/personal
    # uploads whose image carries no usable GPS coordinates.
    if (
        claims.get("mode") == "personal"
        and (meta.get("latitude") is None or meta.get("longitude") is None)
        and _number(live.get("latitude")) is not None
        and _number(live.get("longitude")) is not None
    ):
        meta.update(latitude=_number(live["latitude"]), longitude=_number(live["longitude"]), gpsSource=str(live.get("source") or "Browser geolocation")[:80])
        source = "browser_gps"
    demo = claims.get("demoMetadata")
    if demo_mode and isinstance(demo, dict):
        meta.update({k: demo.get(k) for k in DEMO_KEYS if k in demo})
        meta["latitude"], meta["longitude"] = _number(meta["latitude"]), _number(meta["longitude"])
        source = "demo_preset"
    return meta, source


def layer1_errors(state, claims, meta, image_ok, fingerprint, now=None):
    """Return the failed check keys, in the order of the client checklist. The keys match ERRORS in reporter.js."""
    now = now or datetime.now(timezone.utc)
    errors = [] if image_ok else ["img"]
    if claims.get("mode") == "drone":
        uav = next((u for u in state.get("uavs") or [] if u.get("id") == claims.get("uavId") and u.get("registered")), None)
        if not uav:
            errors.append("uav")
        if not uav or meta.get("uavSerialNumber") != uav.get("serial") or str(meta.get("cameraMake") or "").upper() != str(uav.get("make")).upper():
            errors.append("source")
    else:
        # Browser geolocation is required only when the image itself has no GPS.
        live = claims.get("liveGps") or {}
        if meta.get("latitude") is None or meta.get("longitude") is None:
            if _number(live.get("latitude")) is None or _number(live.get("longitude")) is None:
                errors.append("liveGps")
    bounds = (state.get("regionMeta") or {}).get("coverageBounds") or {}
    lat, lng = meta.get("latitude"), meta.get("longitude")
    inside = (lat is not None and lng is not None and all(k in bounds for k in ("minLat", "maxLat", "minLng", "maxLng"))
              and bounds["minLat"] - GEOFENCE_MARGIN_DEG <= lat <= bounds["maxLat"] + GEOFENCE_MARGIN_DEG
              and bounds["minLng"] - GEOFENCE_MARGIN_DEG <= lng <= bounds["maxLng"] + GEOFENCE_MARGIN_DEG)
    if not inside:
        errors.append("gps")
    taken = _parse_time(meta.get("captureTime"))
    if taken is None or taken > now + CLOCK_SKEW or now - taken > MAX_AGE:
        errors.append("time")
    used = {r.get("fingerprint") for r in state.get("reports") or [] if r.get("uploadStatus") == "Uploaded"}
    if fingerprint in used:
        errors.append("duplicate")
    return errors


@router.post("/api/uploads")
async def upload(request: Request, image: UploadFile = File(...), claims: str = Form("{}")):
    """Check one image (Layer 1). Keep it only if all checks pass. The client then sends the report with the token."""
    user = auth.require_user(request, portal="reporter")
    # NOTE: in-memory window, correct only with 1 worker. For more workers, keep the counters in the DB.
    bucket = f"upload:{auth.client_ip(request)}"
    if auth._recent_failures(bucket) >= UPLOAD_LIMIT:
        raise HTTPException(429, "Too many uploads. Wait one minute.")
    auth._record_failure(bucket)  # here each upload counts, not only failures
    user_bucket = f"upload-user:{user['id']}"
    if auth._recent_failures(user_bucket) >= USER_UPLOAD_LIMIT:
        raise HTTPException(429, "Too many uploads from this account. Wait one minute.")
    auth._record_failure(user_bucket)
    try:
        claims = json.loads(claims)
        assert isinstance(claims, dict)
    except (ValueError, AssertionError):
        raise HTTPException(422, "claims must be a JSON object")
    limit = int(config.MAX_UPLOAD_MB * 1024 * 1024)
    data = await image.read(limit + 1)
    suffix = image_suffix(data[:8])
    exif_meta = exif.read_metadata(data, int(_number(claims.get("tzOffsetMin")) or 0)) if suffix else None
    image_ok = bool(suffix and exif_meta and len(data) <= limit)
    fingerprint = hashlib.sha256(data).hexdigest()
    meta, source = build_metadata(exif_meta or {}, claims, config.DEMO_MODE)
    dhash = _dhash_hex(data) if image_ok else None
    if dhash:
        meta["dhash"] = dhash
    gps_conflict = _gps_conflict(exif_meta or {}, claims)
    _, state = db.read_state(include_audit=False)
    near_duplicate = _near_duplicate(dhash, state)
    errors = layer1_errors(state or {}, claims, meta, image_ok, fingerprint)
    result = {
        "ok": not errors,
        "errors": errors,
        "fingerprint": fingerprint,
        "metadata": meta,
        "metadataSource": source,
        "metadataFlags": {"gpsConflict": gps_conflict},
        "nearDuplicate": near_duplicate,
    }
    if errors:
        return result
    token = secrets.token_hex(16)
    name = f"{token}{suffix}"
    config.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    (config.MEDIA_DIR / name).write_bytes(data)
    db.add_upload(token, user["id"], fingerprint, name, meta, source)
    return {**result, "uploadToken": token, "image": f"/media/{name}"}


@router.get("/media/{name}")
def media(name: str):
    # The 128-bit random name is the access key. Only names of this exact form are served.
    if not MEDIA_NAME.match(name) or not (config.MEDIA_DIR / name).is_file():
        raise HTTPException(404)
    return FileResponse(config.MEDIA_DIR / name, headers={"Cache-Control": "private, max-age=86400"})


@router.get("/api/samples")
def samples():
    """List the demo images in demo_samples/ (see manifest.json there)."""
    manifest = config.SAMPLES_DIR / "manifest.json"
    entries = json.loads(manifest.read_text(encoding="utf-8")) if manifest.is_file() else []
    return [e for e in entries if (config.SAMPLES_DIR / e.get("file", "")).is_file() and image_suffix((config.SAMPLES_DIR / e["file"]).read_bytes()[:8])]


class RerunBody(BaseModel):
    reportId: str


@router.post("/api/ml/rerun")
def rerun(body: RerunBody, request: Request):
    user = auth.require_user(request, portal="dispatch")
    _, state = db.read_state(include_audit=False)
    uploads = db.bound_uploads()
    report = next((r for r in (state or {}).get("reports") or [] if r.get("id") == body.reportId), None)
    upload = live_reports.live_upload(report or {}, uploads)
    if not upload:
        raise HTTPException(404, "Only live uploads have an image for the models")
    db.set_job(upload["token"], "Queued")
    db.mutate(lambda state: live_reports.overlay(state), {"event": "AI_RERUN", "detail": body.reportId, "changes": []},
              {"id": user["id"], "name": user["name"], "role": user["role"]})
    ml_jobs.enqueue(upload["token"])
    return {"queued": body.reportId}
