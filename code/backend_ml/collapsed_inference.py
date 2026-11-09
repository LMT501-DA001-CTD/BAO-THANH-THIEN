import os
from pathlib import Path

import torch
import torch.nn as nn

from PIL import Image

from torchvision import transforms
from torchvision.models import mobilenet_v3_small

# CONFIG
MODEL_FILENAME = "collapsed_building_best_v2.pt"

BEST_MODEL_PATH = Path(
    os.getenv(
        "COLLAPSED_MODEL_PATH",
        Path(__file__).resolve().parent.parent / "models" / MODEL_FILENAME
    )
).expanduser()

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# CLASS CONFIG — thứ tự: nhẹ -> nặng
CLASS_NAMES = ["Intact", "Damaged", "Collapsed"]

CHECKPOINT_CLASS_NAMES = ["0_intact", "1_damaged", "2_collapsed"]

SEVERITY_SCORE = {
    "Intact": 0.0,
    "Damaged": 0.5,
    "Collapsed": 1.0,
}

# ---- Cờ needs_review: lỗi nguy hiểm là Collapsed thật bị đoán thành Intact/Damaged ----
# Cờ chỉ hiển thị cho điều phối viên, KHÔNG đổi severity_score.
#
# Số đo trên test (246 ảnh; 7/71 ca Collapsed bị đoán thấp: 2 -> Intact, 5 -> Damaged) bằng
# analyze_collapsed_flags.py. VAL có 0 ca miss nên không chọn ngưỡng trên val được: ngưỡng dưới
# đây chọn trên chính test (7 ca) => là ước lượng sơ bộ, số "bắt được" bên dưới LẠC QUAN.
#
#   Rule                                      bắt được   số cờ (% dự đoán Intact/Damaged)
#   conf < 0.75 (rule cũ)                       3/7        10  (5.5%)
#   P(Collapsed) >= 0.05                        6/7        12  (6.6%)
#   P(Collapsed) >= 0.04  (đang dùng)           7/7        15  (8.2%)  <- +3 cờ so với 0.05, bắt thêm 1 ca
#   P(Collapsed) >= 0.03 hoặc 0.02              7/7        19  (10.4%) <- +4 cờ nữa, không bắt thêm ca nào
#   conf < 0.75 HOẶC P(Collapsed) >= 0.05       6/7        18  (9.9%)  <- không hơn rule P(Collapsed) đơn
#
# Vì sao dùng P(Collapsed) thay vì conf: 4/7 ca sai là "sai nhưng tự tin" (conf 0.80-0.95) nên cờ
# conf không bắt được, trong khi P(Collapsed) của chúng vẫn 0.05-0.20. "Conf thấp" cũng có thể chỉ là
# lưỡng lự giữa Intact và Damaged, không liên quan đến nguy hiểm.
# Lưu ý biên: ca 1_405.jpg (Damaged, conf 0.950) có P(Collapsed) = 0.048 và chỉ được bắt vì 0.04 nằm ngay
# dưới nó (biên 0.008, một ca duy nhất). Ngoài mẫu, ca sai có P(Collapsed) < 0.04 sẽ không bị gắn cờ.
_DEFAULT = object()          # phân biệt "không truyền tham số" với "truyền None = tắt tín hiệu"
LOW_CONF_THRESHOLD = None    # None = tắt rule conf (bản cũ: 0.75)
P_COLLAPSED_FLAG = 0.04      # None = tắt rule P(Collapsed)

# MODEL LOADING (lazy — chỉ load khi thực sự gọi, để import module không bắt buộc
# phải có sẵn file .pt ngay, tránh làm vỡ severity_router.py nếu 1 model khác thiếu file)
_model = None


def _build_model():
    model = mobilenet_v3_small(weights=None)
    in_features = model.classifier[3].in_features
    model.classifier[3] = nn.Linear(in_features, len(CLASS_NAMES))
    return model


def _validate_checkpoint(checkpoint):
    """
    Validate metadata when the checkpoint is wrapped.
    A plain state_dict is also accepted for compatibility with the training notebook.
    """
    if not isinstance(checkpoint, dict):
        raise TypeError(
            "Invalid checkpoint: expected a dict containing model weights."
        )

    # A wrapped checkpoint may include class metadata.
    checkpoint_classes = checkpoint.get("classes")
    if (
        checkpoint_classes is not None
        and list(checkpoint_classes) != CHECKPOINT_CLASS_NAMES
    ):
        raise ValueError(
            "Checkpoint class order does not match inference config: "
            f"{checkpoint_classes}"
        )

    checkpoint_class_to_idx = checkpoint.get("class_to_idx")
    expected_class_to_idx = {
        class_name: idx
        for idx, class_name in enumerate(CHECKPOINT_CLASS_NAMES)
    }
    if (
        checkpoint_class_to_idx is not None
        and dict(checkpoint_class_to_idx) != expected_class_to_idx
    ):
        raise ValueError(
            "Checkpoint class_to_idx does not match inference config: "
            f"{checkpoint_class_to_idx}"
        )

    # Return the actual weights whether the file is wrapped or a plain state_dict.
    if "model_state_dict" in checkpoint:
        return checkpoint["model_state_dict"]

    # Plain state_dict saved by torch.save(model.state_dict(), path).
    # It should contain parameter tensors rather than checkpoint metadata.
    if checkpoint and all(torch.is_tensor(value) for value in checkpoint.values()):
        return checkpoint

    raise KeyError(
        "Checkpoint must contain 'model_state_dict' or be a plain model state_dict."
    )


def load_collapsed_model(model_path=None):
    model_path = Path(model_path or BEST_MODEL_PATH).expanduser()

    if not model_path.exists():
        raise FileNotFoundError(
            f"Collapsed building model checkpoint not found: {model_path}"
        )

    # weights_only=True is preferred for loading model weights safely.
    try:
        checkpoint = torch.load(
            model_path,
            map_location=DEVICE,
            weights_only=True,
        )
    except TypeError:
        # Compatibility with older PyTorch versions that lack weights_only.
        checkpoint = torch.load(model_path, map_location=DEVICE)

    state_dict = _validate_checkpoint(checkpoint)

    model = _build_model()
    model.load_state_dict(state_dict)
    model = model.to(DEVICE)
    model.eval()

    return model


def get_collapsed_model():
    global _model
    if _model is None:
        _model = load_collapsed_model()
    return _model


# PREPROCESSING
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

eval_transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


# INFERENCE FUNCTION
def assess_from_probs(probs, low_conf=_DEFAULT, p_collapsed_flag=_DEFAULT):
    """
    Từ xác suất 3 lớp (thứ tự CLASS_NAMES) ra dict kết quả, chưa có prediction_id.
    Hàm thuần Python (không cần torch) nên test được ngoài Colab.
    """
    low_conf = LOW_CONF_THRESHOLD if low_conf is _DEFAULT else low_conf
    p_flag = P_COLLAPSED_FLAG if p_collapsed_flag is _DEFAULT else p_collapsed_flag
    if len(probs) != len(CLASS_NAMES):
        raise ValueError(f"Cần {len(CLASS_NAMES)} xác suất, nhận {len(probs)}")

    predicted_idx = max(range(len(probs)), key=lambda i: probs[i])
    severity_label = CLASS_NAMES[predicted_idx]
    confidence = round(float(probs[predicted_idx]), 4)
    p_collapsed = round(float(probs[CLASS_NAMES.index("Collapsed")]), 4)

    # Chỉ nhãn nhẹ hơn Collapsed mới có thể đang che một ca Collapsed thật.
    reasons = []
    if severity_label != "Collapsed":
        if low_conf is not None and confidence < low_conf:
            reasons.append(f"confidence {confidence} < {low_conf}")
        if p_flag is not None and p_collapsed >= p_flag:
            reasons.append(f"P(Collapsed) {p_collapsed} >= {p_flag}")
    needs_review_intact = severity_label == "Intact" and bool(reasons)
    needs_review_damaged = severity_label == "Damaged" and bool(reasons)
    needs_review = needs_review_intact or needs_review_damaged

    explanation = (
        f"Predicted building severity '{severity_label}' "
        f"with confidence {confidence:.4f}."
    )
    if needs_review:
        explanation += (
            f" Manual review recommended ({'; '.join(reasons)}): in the test set, "
            "7/71 true Collapsed buildings were predicted as Intact or Damaged."
        )

    return {
        "incident_type": "Collapsed",
        "severity_score": float(SEVERITY_SCORE[severity_label]),
        "severity_level": severity_label,
        "severity_label": severity_label,  # giữ lại để tương thích code cũ
        "confidence": confidence,
        "needs_review": bool(needs_review),
        "explanation": explanation,
        "details": {
            "severity_raw": predicted_idx,
            "class_name": severity_label,
            "probs": {n: round(float(p), 4) for n, p in zip(CLASS_NAMES, probs)},
            "p_collapsed": p_collapsed,
            "needs_review_intact": bool(needs_review_intact),
            "needs_review_damaged": bool(needs_review_damaged),
            "review_reasons": reasons,
            "low_conf_threshold": low_conf,
            "p_collapsed_flag": p_flag,
            "source_dataset": "UAVs-TEBDE",
        },
    }


def predict_collapsed_severity(image_path):
    """
    Dự đoán mức độ thiệt hại công trình từ một ảnh.

    - incident_type luôn là "Collapsed" (nhánh đang xử lý).
    - severity_level là mức model dự đoán: Intact, Damaged hoặc Collapsed.
    - needs_review: xem ghi chú ngưỡng ở đầu file.
    """
    model = get_collapsed_model()

    with Image.open(image_path) as image:
        image = image.convert("RGB")
        image_tensor = eval_transform(image).unsqueeze(0).to(DEVICE)

    with torch.inference_mode():
        outputs = model(image_tensor)
        probabilities = torch.softmax(outputs, dim=1)[0].cpu().tolist()

    return assess_from_probs(probabilities)


def run_collapsed_assessment(image_path, prediction_id=None):
    """
    Wrapper đầu ra chuẩn để tích hợp SkyRescue.

    prediction_id luôn có trong output; khi kiểm thử độc lập có thể là None.
    """
    result = predict_collapsed_severity(image_path)

    severity_score = float(result["severity_score"])
    if not 0.0 <= severity_score <= 1.0:
        raise ValueError(f"Invalid severity_score: {severity_score}")

    result["prediction_id"] = prediction_id
    result["incident_type"] = "Collapsed"
    result["severity_score"] = severity_score

    # Kiểm tra các khóa bắt buộc theo schema tích hợp của SkyRescue.
    required_keys = {
        "prediction_id",
        "incident_type",
        "severity_level",
        "severity_score",
        "confidence",
        "needs_review",
    }
    missing_keys = required_keys - result.keys()
    if missing_keys:
        raise KeyError(f"Collapsed assessment missing keys: {sorted(missing_keys)}")

    if not isinstance(result["needs_review"], bool):
        raise TypeError("'needs_review' must be a bool.")

    return result

def check(d: dict) -> bool:
    """Kiểm tra khớp nối mục 6.6."""
    required_keys = {
        "prediction_id",
        "incident_type",
        "severity_level",
        "severity_score",
        "confidence",
        "needs_review",
    }
    missing_keys = required_keys - d.keys()
    assert not missing_keys, f"thiếu khóa: {sorted(missing_keys)}"
    assert 0.0 <= d["severity_score"] <= 1.0, "severity_score ngoài 0..1"
    assert isinstance(d["needs_review"], bool), "'needs_review' phải là bool"
    return True