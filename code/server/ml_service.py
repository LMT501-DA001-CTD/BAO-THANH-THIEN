"""Wrapper around backend_ml/. Do not change the files in backend_ml/ (PROMPT §5.1)."""
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

from starlette.concurrency import run_in_threadpool

from . import config

log = logging.getLogger("skyrescue.ml")

if str(config.ML_DIR) not in sys.path:
    sys.path.insert(0, str(config.ML_DIR))

TYPE_MAP = {
    "Collapsed": "Building Collapse",
    "Traffic": "Traffic Accident",
    "Fire": "Fire",
    "Flood": "Flood",
    "Normal": "Normal",
}
MODEL_NAMES = {"m1": "aider_classifier.pth", "m2": "v8m_up2_best.pt"}
WEIGHT_ENV = ("MODEL1_PATH", "MODEL2_PATH", "FIRE_MODEL_PATH", "COLLAPSED_MODEL_PATH")

_status = {"loaded": False, "error": None, "model2Classes": None, "loadSeconds": None}
# NOTE: one inference at a time. torch already uses all CPU cores for one image.
# Increase the semaphore only on a machine with more cores than one inference can use.
_gate = asyncio.Semaphore(1)


def _jsonable(value):
    """Convert numpy and other values to plain JSON types."""
    return json.loads(json.dumps(value, default=lambda v: v.item() if hasattr(v, "item") else str(v)))


def weights_status():
    files = {}
    for key in WEIGHT_ENV:
        path = Path(os.environ[key])
        files[path.name] = {"exists": path.exists(), "sizeMB": round(path.stat().st_size / 1e6, 1) if path.exists() else None}
    return files


def health():
    return {**_status, "weights": weights_status()}


def load_models():
    """Load all models one time, then run one warm-up image."""
    started = time.perf_counter()
    try:
        import model1_inference, model2_inference, fire_inference, collapsed_inference  # noqa: E401
        from PIL import Image

        model1_inference._load()
        model2 = model2_inference._get_model()
        _status["model2Classes"] = dict(model2.names)
        log.info("Model 2 classes: %s", model2.names)
        fire_inference.get_fire_model()
        collapsed_inference.get_collapsed_model()
        warmup = config.DATA_DIR / "warmup.jpg"
        warmup.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (640, 480), (90, 110, 130)).save(warmup)
        model1_inference.run_incident_classification(str(warmup))
        model2_inference.detect_people(str(warmup))
        _status.update(loaded=True, error=None)
    except Exception as exc:  # the server must start; health shows the error
        log.exception("ML model load failed")
        _status.update(loaded=False, error=f"{type(exc).__name__}: {exc}")
    _status["loadSeconds"] = round(time.perf_counter() - started, 1)


def pose_label(cls_name):
    return "Upright" if cls_name == "Upright" else "Non-Upright"


def build_ai_result(route, detections, image_size, latency_ms):
    """Map the router output to the aiResult contract (PROMPT §5.4)."""
    classifier = route["classifier"]
    assessment = route.get("assessment") or {}
    details = assessment.get("details") or {}
    stopped = bool(route.get("stopped"))
    # Model 1 top-1 is below UNCLASSIFIED_BELOW: send "Unclassified" so Verify stays locked in Dispatch.
    unclassified = bool(route.get("unclassified"))
    incident_type = "Unclassified" if unclassified else TYPE_MAP[route["incident_type"]]
    boxes = [
        {"id": f"D{i + 1}", "box": [d["x1"], d["y1"], d["x2"], d["y2"]], "conf": d["conf"], "pose": pose_label(d["cls"])}
        for i, d in enumerate(detections)
    ]
    p_normal = route.get("p_normal")
    if stopped:
        p_normal = (classifier.get("probs") or {}).get("Normal", classifier.get("confidence"))
    return _jsonable({
        "status": "stopped_normal" if stopped else "completed",
        "incidentType": incident_type,
        "aiConfidence": round(float(classifier["confidence"]) * 100, 1),
        "severityScore": round(float(assessment["severity_score"]) * 100, 1) if assessment else 0.0,
        "severityLevel": "Normal" if stopped else assessment.get("severity_level"),
        "needsReview": unclassified or bool(assessment.get("needs_review", False)),
        "routedByReview": bool(route.get("routed_by_review", False)),
        "pNormal": p_normal,
        "contradiction": bool(details.get("contradiction", False)),
        "detectedPeopleCount": len(boxes),
        "nonUprightCount": sum(1 for b in boxes if b["pose"] == "Non-Upright"),
        "poseConfidence": round(sum(b["conf"] for b in boxes) / len(boxes) * 100, 1) if boxes else 0.0,
        "detections": boxes,
        "imageSize": list(image_size),
        "probs": classifier.get("probs") or {},
        "details": details,
        "models": MODEL_NAMES,
        "latencyMs": latency_ms,
        "source": "live-inference",
    })


def failed_result(error, latency_ms=0):
    return {
        "status": "failed",
        "incidentType": "Unclassified",  # keeps the Verify lock on in Dispatch
        "error": error,
        "needsReview": True,
        "models": MODEL_NAMES,
        "latencyMs": latency_ms,
        "source": "live-inference",
    }


def _predict_sync(image_path, prediction_id):
    import model2_inference
    import severity_router

    started = time.perf_counter()
    # Flood must use model2 boxes: the C2A annotation folder is not in the image (PROMPT §5.3.3).
    route = severity_router.route_severity(str(image_path), prediction_id=prediction_id, flood_bbox_source="model2")
    detections, width, height = model2_inference.detect_people_with_size(str(image_path))
    latency_ms = round((time.perf_counter() - started) * 1000)
    return build_ai_result(route, detections, (width, height), latency_ms)


async def predict(image_path, prediction_id):
    """Run the full pipeline for one image. Never raises: errors give a failed aiResult."""
    if prediction_id is None:
        raise ValueError("prediction_id must not be None")  # Fire does not add the key itself
    if not _status["loaded"]:
        return failed_result(f"Models are not loaded: {_status['error']}")
    started = time.perf_counter()
    async with _gate:
        try:
            return await asyncio.wait_for(run_in_threadpool(_predict_sync, image_path, prediction_id), config.ML_TIMEOUT_S)
        except asyncio.TimeoutError:
            return failed_result(f"Inference timeout after {config.ML_TIMEOUT_S:.0f} s", round((time.perf_counter() - started) * 1000))
        except Exception as exc:
            log.exception("Inference failed for %s", prediction_id)
            return failed_result(f"{type(exc).__name__}: {exc}", round((time.perf_counter() - started) * 1000))
