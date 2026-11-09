"""SkyRescue severity router: Model 1 -> Fire/Collapsed/Traffic/Flood assessment."""
from importlib import import_module

ASSESSMENT_DISPATCH = {
    "Fire": ("fire_inference", "run_fire_assessment"),
    "Collapsed": ("collapsed_inference", "run_collapsed_assessment"),
    "Traffic": ("traffic_inference", "run_traffic_assessment"),
    "Flood": ("flood_inference", "run_flood_assessment"),
}
REQUIRED_KEYS = {
    "prediction_id", "incident_type", "severity_level",
    "severity_score", "confidence", "needs_review",
}

# Các nhánh áp dụng quy tắc mâu thuẫn: nếu được định tuyến vào Fire hoặc Collapsed
# nhưng mô hình đánh giá mức độ lại trả về severity_score == 0.0 (No Flame / No Smoke
# hoặc Intact) thì ép needs_review = True và ghi details["contradiction"] = True.
CONTRADICTION_TYPES = {"Fire", "Collapsed"}

# Ảnh Model 1 xếp Normal chỉ bị DỪNG khi P(Normal) >= NORMAL_STOP_MIN. Dưới ngưỡng này router
# không dừng: nó chuyển sang lớp sự cố có xác suất cao nhất (bỏ Normal) và ép needs_review = True,
# vì bỏ sót sự cố thật nguy hiểm hơn là bắt người xem thừa.
# Đặt ở router, KHÔNG dùng REVIEW_BELOW của model1_inference vì REVIEW_BELOW cũng gắn cờ cả ảnh
# được đoán là sự cố nhưng có confidence thấp.
# Số đo của nhóm: ngưỡng 0.9 bắt lại 11/11 sự cố bị đoán Normal trên test AIDER (review thừa
# 46/630 ảnh Normal, 7.3%) và 44/60 trên C2A. Còn 16/60 ca C2A vẫn lọt; trong đó 5 ca có
# P(Normal) >= 0.99 (như R18) thì không ngưỡng hợp lý nào bắt được.
# Xác suất của Model 1 đã làm tròn 4 chữ số; P(Normal) đúng bằng ngưỡng vẫn dừng (so sánh >=).
NORMAL_STOP_MIN = 0.9

# Ba mức theo xác suất top-1 của Model 1 khi top-1 là MỘT LỚP SỰ CỐ (Fire, Flood, Collapsed, Traffic):
#   top-1 >= INCIDENT_REVIEW_BELOW                       -> giữ loại sự cố như hiện tại
#   UNCLASSIFIED_BELOW <= top-1 < INCIDENT_REVIEW_BELOW  -> giữ loại sự cố, needs_review = True
#   top-1 < UNCLASSIFIED_BELOW                           -> result["unclassified"] = True; ml_service
#                                                           trả incidentType "Unclassified" (khoá Verify)
# Model có 5 lớp nên top-1 tối thiểu là 0.2; dưới 0.5 thường nghĩa là không lớp nào áp đảo.
# 0.7 và 0.5 là điểm khởi đầu hợp lý, CHƯA được kiểm chứng. Cần quét ngưỡng trên test AIDER và C2A
# (độ chính xác của ảnh trên ngưỡng, tỉ lệ ảnh bị đẩy sang Unclassified) rồi chốt số.
# Không áp dụng cho ảnh Normal bị đẩy sang lớp sự cố (routed_by_review): ở đó top-1 là Normal,
# P(Normal) < NORMAL_STOP_MIN và ca đã luôn có needs_review = True.
INCIDENT_REVIEW_BELOW = 0.7
UNCLASSIFIED_BELOW = 0.5
# True: ca Unclassified VẪN chạy severity của lớp top-1 (điểm severity vẫn vào điểm ưu tiên, Dispatcher
# thấy phỏng đoán). False: dừng sau Model 1, assessment = None, severity = 0.
UNCLASSIFIED_RUN_SEVERITY = True


def _validate_assessment(result, expected_type, prediction_id):
    if not isinstance(result, dict):
        raise TypeError(f"{expected_type} assessment must return a dict")
    missing = REQUIRED_KEYS - result.keys()
    if missing:
        raise KeyError(f"{expected_type} assessment missing keys: {sorted(missing)}")
    if result["incident_type"] != expected_type:
        raise ValueError(
            f"Expected incident_type={expected_type!r}, got {result['incident_type']!r}"
        )
    try:
        score = float(result["severity_score"])
    except (TypeError, ValueError) as exc:
        raise TypeError("severity_score must be numeric") from exc
    if not 0.0 <= score <= 1.0:
        raise ValueError(f"severity_score outside [0, 1]: {score}")
    if not isinstance(result["needs_review"], bool):
        raise TypeError("needs_review must be bool")
    if result["prediction_id"] != prediction_id:
        raise ValueError(
            f"prediction_id mismatch: expected {prediction_id!r}, "
            f"got {result['prediction_id']!r}"
        )
    result["severity_score"] = score
    return result


def _p_normal(classifier):
    """P(Normal) từ Model 1. Gọi khi top-1 là Normal nên confidence cũng chính là P(Normal)."""
    probs = classifier.get("probs")
    if isinstance(probs, dict) and probs.get("Normal") is not None:
        return float(probs["Normal"])
    conf = classifier.get("confidence")
    return None if conf is None else float(conf)


def _best_incident_from_probs(probs):
    """Lớp sự cố có xác suất cao nhất trong probs, bỏ Normal."""
    candidates = {
        name: float(p) for name, p in (probs or {}).items()
        if name in ASSESSMENT_DISPATCH and p is not None
    }
    if not candidates:
        raise ValueError(
            "Model 1 probs has no incident class; cannot re-route a low-confidence Normal"
        )
    return max(candidates, key=candidates.get)


def _run_branch(incident_type, image_path, prediction_id, flood_bbox_source):
    module_name, function_name = ASSESSMENT_DISPATCH[incident_type]
    assessment_fn = getattr(import_module(module_name), function_name)
    if incident_type == "Flood":
        return assessment_fn(
            str(image_path), prediction_id=prediction_id,
            bbox_source=flood_bbox_source
        )
    return assessment_fn(str(image_path), prediction_id=prediction_id)


def route_severity(image_path, prediction_id=None, *, flood_bbox_source="annotation"):
    """Run Model 1, then dispatch to the matching severity wrapper.

    - Top-1 là lớp sự cố: dispatch như bình thường.
    - Top-1 là Normal và P(Normal) >= NORMAL_STOP_MIN: dừng (stopped=True, assessment=None).
    - Top-1 là Normal nhưng P(Normal) < NORMAL_STOP_MIN: KHÔNG dừng; dispatch theo lớp sự cố
      có xác suất cao nhất trong probs, ép assessment["needs_review"] = True và thêm vào kết quả
      routed_by_review=True, p_normal. incident_type của kết quả là lớp được chọn thay thế;
      classifier giữ nguyên (vẫn ghi Normal) để QA tra lại.
    - Top-1 là lớp sự cố nhưng xác suất < INCIDENT_REVIEW_BELOW: giữ loại, ép needs_review = True,
      thêm low_confidence=True. Nếu < UNCLASSIFIED_BELOW: thêm unclassified=True (ml_service đổi
      incidentType thành "Unclassified"). Với UNCLASSIFIED_RUN_SEVERITY=False, ca này dừng sau Model 1
      (incident_type="Unclassified", assessment=None); với True, severity của lớp top-1 vẫn chạy.
    - Quy tắc mâu thuẫn (Contradiction rule): nếu nhánh được chọn là Fire hoặc Collapsed
      (kể cả routed_by_review) nhưng wrapper trả về severity_score == 0.0 (No Flame / No Smoke
      hoặc Intact) thì ép assessment["needs_review"] = True và gán
      assessment["details"]["contradiction"] = True.

    Không sửa ngưỡng hay đầu ra của Model 1.
    """
    classifier_module = import_module("model1_inference")
    classifier = classifier_module.run_incident_classification(
        str(image_path), prediction_id=prediction_id
    )
    if not isinstance(classifier, dict):
        raise TypeError("run_incident_classification() must return a dict")

    incident_type = classifier.get("incident_type")
    is_normal = classifier.get("is_normal") is True or incident_type == "Normal"
    routed_by_review = False
    p_normal = None

    if is_normal:
        p_normal = _p_normal(classifier)
        if p_normal is None:
            raise ValueError(
                "Model 1 classified Normal but returned neither probs['Normal'] nor confidence"
            )
        if p_normal >= NORMAL_STOP_MIN:
            return {
                "prediction_id": prediction_id,
                "incident_type": "Normal",
                "stopped": True,
                "classifier": classifier,
                "assessment": None,
                "message": "Model 1 classified this image as Normal; severity routing stopped.",
            }
        incident_type = _best_incident_from_probs(classifier.get("probs"))
        routed_by_review = True

    low_confidence = False
    unclassified = False
    if not is_normal and incident_type in ASSESSMENT_DISPATCH:
        top1 = classifier.get("confidence")
        if top1 is not None:
            top1 = float(top1)
            low_confidence = top1 < INCIDENT_REVIEW_BELOW
            unclassified = top1 < UNCLASSIFIED_BELOW
        if unclassified and not UNCLASSIFIED_RUN_SEVERITY:
            return {
                "prediction_id": prediction_id,
                "incident_type": "Unclassified",
                "stopped": False,
                "unclassified": True,
                "low_confidence": True,
                "classifier": classifier,
                "assessment": None,
                "message": "Model 1 top-1 is below UNCLASSIFIED_BELOW; severity routing skipped.",
            }

    if incident_type not in ASSESSMENT_DISPATCH:
        raise ValueError(
            f"Unsupported incident_type from Model 1: {incident_type!r}. "
            f"Expected one of: {', '.join(ASSESSMENT_DISPATCH)} or Normal."
        )

    assessment = _run_branch(incident_type, image_path, prediction_id, flood_bbox_source)
    assessment = _validate_assessment(assessment, incident_type, prediction_id)

    # Áp dụng quy tắc mâu thuẫn cho Fire và Collapsed khi severity_score == 0.0
    if incident_type in CONTRADICTION_TYPES and assessment["severity_score"] == 0.0:
        assessment["needs_review"] = True
        if not isinstance(assessment.get("details"), dict):
            assessment["details"] = {}
        assessment["details"]["contradiction"] = True

    result = {
        "prediction_id": prediction_id,
        "incident_type": incident_type,
        "stopped": False,
        "classifier": classifier,
        "assessment": assessment,
    }
    if routed_by_review:
        assessment["needs_review"] = True
        result["routed_by_review"] = True
        result["p_normal"] = p_normal
    if low_confidence:
        assessment["needs_review"] = True
        result["low_confidence"] = True
    if unclassified:
        result["unclassified"] = True
    return result


route_incident = route_severity


def check_router_result(result):
    required = {"prediction_id", "incident_type", "stopped", "classifier", "assessment"}
    missing = required - result.keys()
    if missing:
        raise KeyError(f"Router result missing keys: {sorted(missing)}")
    if result["incident_type"] == "Normal":
        assert result["stopped"] is True
        assert result["assessment"] is None
    elif result["incident_type"] == "Unclassified":
        assert result["stopped"] is False
        assert result["unclassified"] is True
        assert result["assessment"] is None
    else:
        assert result["stopped"] is False
        _validate_assessment(
            result["assessment"], result["incident_type"], result["prediction_id"]
        )
        if result.get("routed_by_review"):
            assert result["assessment"]["needs_review"] is True
            assert result["p_normal"] < NORMAL_STOP_MIN
        if result.get("low_confidence"):
            assert result["assessment"]["needs_review"] is True
        if result.get("unclassified"):
            assert result["low_confidence"] is True
        if (
            result["incident_type"] in CONTRADICTION_TYPES
            and result["assessment"]["severity_score"] == 0.0
        ):
            assert result["assessment"]["needs_review"] is True
            assert isinstance(result["assessment"].get("details"), dict)
            assert result["assessment"]["details"].get("contradiction") is True
    return True


if __name__ == "__main__":
    import argparse
    import json
    parser = argparse.ArgumentParser(description="SkyRescue severity router")
    parser.add_argument("image", help="Path to input image")
    parser.add_argument("--prediction-id", default=None)
    parser.add_argument(
        "--flood-bbox-source", choices=("annotation", "model2"), default="annotation"
    )
    args = parser.parse_args()
    result = route_severity(
        args.image, prediction_id=args.prediction_id,
        flood_bbox_source=args.flood_bbox_source
    )
    check_router_result(result)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))