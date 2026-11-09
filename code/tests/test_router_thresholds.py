"""Model 1 confidence tiers in severity_router (top-1 is an incident class). No torch needed."""
import sys
import types

import pytest

from server import config, ml_service

sys.path.insert(0, str(config.ML_DIR))
severity_router = pytest.importorskip("severity_router")


def _install(monkeypatch, top, conf, normal=0.0):
    """Put fake Model 1 and Fire modules in sys.modules."""
    probs = {"Fire": 0.0, "Flood": 0.0, "Collapsed": 0.0, "Traffic": 0.0, "Normal": normal}
    probs[top] = conf
    classifier = {"prediction_id": "P", "incident_type": top, "confidence": conf, "is_normal": top == "Normal",
                  "probs": probs, "needs_review": False}
    model1 = types.SimpleNamespace(run_incident_classification=lambda path, prediction_id=None: dict(classifier))
    fire = types.SimpleNamespace(run_fire_assessment=lambda path, prediction_id=None: {
        "prediction_id": prediction_id, "incident_type": "Fire", "severity_level": "Severe",
        "severity_score": 0.8, "confidence": 0.9, "needs_review": False, "details": {}})
    monkeypatch.setitem(sys.modules, "model1_inference", model1)
    monkeypatch.setitem(sys.modules, "fire_inference", fire)


@pytest.mark.parametrize("conf, review, unclassified", [
    (0.95, False, False),
    (0.70, False, False),   # equal to the limit keeps the type (>=)
    (0.6999, True, False),
    (0.50, True, False),
    (0.4999, True, True),
])
def test_tiers(monkeypatch, conf, review, unclassified):
    _install(monkeypatch, "Fire", conf)
    result = severity_router.route_severity("x.jpg", prediction_id="P")
    assert severity_router.check_router_result(result)
    assert result["assessment"]["needs_review"] is review
    assert bool(result.get("unclassified")) is unclassified
    assert result["incident_type"] == "Fire"
    ai = ml_service.build_ai_result(result, [], (10, 10), 1)
    assert ai["incidentType"] == ("Unclassified" if unclassified else "Fire")
    assert ai["needsReview"] is review
    assert ai["severityScore"] == 80.0  # severity of the top class still runs


def test_unclassified_without_severity(monkeypatch):
    _install(monkeypatch, "Fire", 0.4)
    monkeypatch.setattr(severity_router, "UNCLASSIFIED_RUN_SEVERITY", False)
    result = severity_router.route_severity("x.jpg", prediction_id="P")
    assert severity_router.check_router_result(result)
    assert result["assessment"] is None
    ai = ml_service.build_ai_result(result, [], (10, 10), 1)
    assert ai["incidentType"] == "Unclassified" and ai["needsReview"] is True and ai["severityScore"] == 0.0


def test_normal_reroute_is_not_unclassified(monkeypatch):
    # Top-1 is Normal at 0.4: the old rule routes to the best incident class. The new tiers do not apply.
    _install(monkeypatch, "Normal", 0.4, normal=0.4)
    classifier = sys.modules["model1_inference"].run_incident_classification("x.jpg")
    classifier["probs"]["Fire"] = 0.35
    sys.modules["model1_inference"].run_incident_classification = lambda path, prediction_id=None: dict(classifier)
    result = severity_router.route_severity("x.jpg", prediction_id="P")
    assert result["routed_by_review"] is True and not result.get("unclassified")
    assert result["incident_type"] == "Fire"
