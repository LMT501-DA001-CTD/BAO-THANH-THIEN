"""ML wrapper contract (Phase 2). The live tests need torch and the weights (run them in Docker)."""
import asyncio

import pytest

from server import ml_service

AI_KEYS = {
    "status", "incidentType", "aiConfidence", "severityScore", "severityLevel", "needsReview", "routedByReview",
    "pNormal", "contradiction", "detectedPeopleCount", "nonUprightCount", "poseConfidence", "detections",
    "imageSize", "probs", "details", "models", "latencyMs", "source",
}
DETS = [
    {"x1": 1, "y1": 2, "x2": 30, "y2": 80, "conf": 0.9, "cls": "Upright"},
    {"x1": 5, "y1": 6, "x2": 40, "y2": 20, "conf": 0.5, "cls": "Other"},
]


def test_normal_stop_maps_to_stopped_normal():
    route = {"incident_type": "Normal", "stopped": True, "assessment": None,
             "classifier": {"confidence": 0.95, "probs": {"Normal": 0.95, "Fire": 0.05}}}
    result = ml_service.build_ai_result(route, [], (640, 480), 12)
    assert result["status"] == "stopped_normal" and result["incidentType"] == "Normal"
    assert result["pNormal"] == 0.95 and set(result) == AI_KEYS


def test_incident_maps_names_poses_and_review_flags():
    route = {"incident_type": "Collapsed", "stopped": False, "routed_by_review": True, "p_normal": 0.6,
             "classifier": {"confidence": 0.6, "probs": {"Normal": 0.6, "Collapsed": 0.3}},
             "assessment": {"severity_score": 0.5, "severity_level": "Damaged", "needs_review": True,
                            "details": {"contradiction": False}}}
    result = ml_service.build_ai_result(route, DETS, (640, 480), 12)
    assert result["incidentType"] == "Building Collapse" and result["severityScore"] == 50.0
    assert result["routedByReview"] is True and result["needsReview"] is True
    assert [d["pose"] for d in result["detections"]] == ["Upright", "Non-Upright"]
    assert result["nonUprightCount"] == 1 and result["poseConfidence"] == 70.0


def test_flood_uses_model2_boxes(monkeypatch, tmp_path):
    severity_router = pytest.importorskip("severity_router")
    model2_inference = pytest.importorskip("model2_inference")
    seen = {}

    def fake_route(path, prediction_id=None, **kwargs):
        seen.update(kwargs, prediction_id=prediction_id)
        return {"incident_type": "Flood", "stopped": False, "classifier": {"confidence": 0.9, "probs": {}},
                "assessment": {"severity_score": 1.0, "severity_level": "Unknown", "needs_review": True, "details": {}}}

    monkeypatch.setattr(severity_router, "route_severity", fake_route)
    monkeypatch.setattr(model2_inference, "detect_people_with_size", lambda p: ([], 10, 10))
    result = ml_service._predict_sync(tmp_path / "x.jpg", "REP-1")
    assert seen == {"flood_bbox_source": "model2", "prediction_id": "REP-1"}
    assert result["incidentType"] == "Flood"


@pytest.fixture(scope="module")
def loaded_models():
    pytest.importorskip("torch")
    ml_service.load_models()
    if not ml_service.health()["loaded"]:
        pytest.fail(f"Models did not load: {ml_service.health()['error']}")


def test_live_inference_returns_the_contract(loaded_models, tmp_path):
    from PIL import Image

    path = tmp_path / "scene.jpg"
    Image.effect_noise((640, 480), 60).convert("RGB").save(path)
    result = asyncio.run(ml_service.predict(path, "REP-TEST"))
    assert result["status"] in {"completed", "stopped_normal"}, result
    assert set(result) == AI_KEYS
    assert 0 <= result["severityScore"] <= 100
    assert result["imageSize"] == [640, 480]


def test_unreadable_image_gives_failed_result(loaded_models, tmp_path):
    path = tmp_path / "broken.jpg"
    path.write_bytes(b"\xff\xd8\xff not a real jpeg")
    result = asyncio.run(ml_service.predict(path, "REP-BAD"))
    assert result["status"] == "failed" and result["incidentType"] == "Unclassified"
