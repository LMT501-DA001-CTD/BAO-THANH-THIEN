import os
from pathlib import Path

import torch
import torch.nn as nn

from PIL import Image

from torchvision import transforms
from torchvision.models import mobilenet_v3_small

# CONFIG
MODEL_FILENAME = "best_fire_mobilenetv3_phase2.pth"

# Auto-detect model file in the same directory as this script (independent of folder name)
_DEFAULT_MODEL_PATH = Path(__file__).resolve().with_name(MODEL_FILENAME)
if not _DEFAULT_MODEL_PATH.exists():
    _alt_path = Path(__file__).resolve().parent.parent / "models" / MODEL_FILENAME
    if _alt_path.exists():
        _DEFAULT_MODEL_PATH = _alt_path

BEST_MODEL_PATH = Path(
    os.getenv(
        "FIRE_MODEL_PATH",
        _DEFAULT_MODEL_PATH
    )
).expanduser()

DEVICE = torch.device(
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)

# CLASS CONFIG
CLASS_NAMES = [
    "No Flame / No Smoke",
    "Flame / No Smoke",
    "Flame / Smoke"
]

CHECKPOINT_CLASS_NAMES = [
    "0_no_flame_no_smoke",
    "1_flame_no_smoke",
    "2_flame_smoke"
]


SEVERITY_SCORE = {
    "No Flame / No Smoke": 0.0,
    "Flame / No Smoke": 0.5,
    "Flame / Smoke": 1.0
}

# MODEL LOADING
_model = None


def _build_model():

    model = mobilenet_v3_small(
        weights=None
    )

    in_features = (
        model.classifier[3].in_features
    )

    model.classifier[3] = nn.Linear(
        in_features,
        len(CLASS_NAMES)
    )

    return model


def _validate_checkpoint(checkpoint):

    checkpoint_classes = checkpoint.get(
        "classes"
    )

    if (
        checkpoint_classes is not None
        and list(checkpoint_classes) != CHECKPOINT_CLASS_NAMES
    ):
        raise ValueError(
            "Checkpoint class order does not match inference config: "
            f"{checkpoint_classes}"
        )

    checkpoint_class_to_idx = checkpoint.get(
        "class_to_idx"
    )

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

    if "model_state_dict" not in checkpoint:
        raise KeyError(
            "Checkpoint missing model_state_dict"
        )


def load_fire_model(model_path=None):

    model_path = Path(
        model_path or BEST_MODEL_PATH
    ).expanduser()

    if not model_path.exists():
        raise FileNotFoundError(
            f"Fire model checkpoint not found: {model_path}"
        )

    checkpoint = torch.load(
        model_path,
        map_location=DEVICE
    )

    _validate_checkpoint(
        checkpoint
    )

    model = _build_model()

    model.load_state_dict(
        checkpoint["model_state_dict"]
    )

    model = model.to(DEVICE)

    model.eval()

    return model


def get_fire_model():

    global _model

    if _model is None:
        _model = load_fire_model()

    return _model

# PREPROCESSING
IMAGENET_MEAN = [
    0.485,
    0.456,
    0.406
]

IMAGENET_STD = [
    0.229,
    0.224,
    0.225
]


eval_transform = transforms.Compose([
    transforms.Resize(256),

    transforms.CenterCrop(224),

    transforms.ToTensor(),

    transforms.Normalize(
        mean=IMAGENET_MEAN,
        std=IMAGENET_STD
    )
])

# INFERENCE FUNCTION
def predict_fire_severity(image_path):

    """
    Predict Fire severity từ một ảnh.

    Returns:
        {
            "incident_type": "fire",
            "severity_score": float,
            "severity_label": str,
            "confidence": float,
            "needs_review": bool,
            "explanation": str,
            "details": dict
        }
    """

    model = get_fire_model()

    with Image.open(image_path) as image:
        image = image.convert("RGB")

        image_tensor = (
            eval_transform(image)
            .unsqueeze(0)
            .to(DEVICE)
        )

    with torch.inference_mode():

        outputs = model(
            image_tensor
        )

        probabilities = torch.softmax(
            outputs,
            dim=1
        )[0]

        predicted_idx = (
            probabilities
            .argmax()
            .item()
        )


    severity_label = (
        CLASS_NAMES[
            predicted_idx
        ]
    )

    confidence = (
        probabilities[
            predicted_idx
        ].item()
    )


    confidence = round(
        confidence,
        4
    )

    severity_score = float(
        SEVERITY_SCORE[severity_label]
    )

    return {
        "incident_type": "Fire",
        "severity_score": severity_score,
        "severity_level": severity_label,
        "confidence": confidence,
        "needs_review": False,
        "explanation": (
            f"Predicted fire severity '{severity_label}' "
            f"with confidence {confidence:.4f}."
        ),
        "details": {
            "severity_raw": predicted_idx,
            "class_name": severity_label
        }
    }


def run_fire_assessment(image_path, prediction_id=None):
    """
    Chạy Fire severity assessment và trả output
    theo format chuẩn để tích hợp SkyRescue.

    prediction_id:
        ID thật từ bảng Prediction khi backend tích hợp.
        Có thể để None khi test model độc lập.
    """

    result = predict_fire_severity(image_path)

    severity_score = float(
        result["severity_score"]
    )

    if not 0.0 <= severity_score <= 1.0:
        raise ValueError(
            f"Invalid severity_score: {severity_score}"
        )

    result["severity_score"] = severity_score

    if prediction_id is not None:
        result["prediction_id"] = prediction_id

    return result

def check(d: dict) -> bool:
    """Kiểm tra khớp nối mục 6.6."""
    REQUIRED = {"prediction_id", "incident_type", "severity_level",
                "severity_score", "confidence", "needs_review"}
    missing = REQUIRED - d.keys()
    assert not missing, f"thiếu khóa: {missing}"
    assert 0.0 <= d["severity_score"] <= 1.0, "severity_score ngoài 0..1"
    assert isinstance(d["needs_review"], bool), "needs_review phải là bool"
    return True