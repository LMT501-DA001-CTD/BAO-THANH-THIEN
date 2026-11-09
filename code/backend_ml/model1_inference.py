"""
SkyRescue - Model 1 (phân loại loại sự cố, AIDER, EfficientNet-B0) - INFERENCE ONLY.

    from model1_inference import run_incident_classification
    r = run_incident_classification("anh.jpg", prediction_id=123)

Đầu ra (dict):
    prediction_id, incident_type, raw_label, confidence, is_normal, probs, needs_review

`incident_type` dùng tên CHUẨN của cả hệ thống: Collapsed | Fire | Flood | Traffic | Normal.
Bộ điều phối dùng `incident_type` để chọn hàm run_<loại>_assessment tương ứng;
is_normal == True thì dừng, không gọi luồng severity nào.

Đường dẫn model: biến môi trường MODEL1_PATH, mặc định `aider_classifier.pth` cạnh file này.
"""

import os
from pathlib import Path

# Thứ tự lớp do torchvision ImageFolder sắp theo bảng chữ cái khi train (không đổi thứ tự này).
CLASSES = ["collapsed_building", "fire", "flooded_areas", "normal", "traffic_incident"]

INCIDENT_TYPE = {
    "collapsed_building": "Collapsed",
    "fire": "Fire",
    "flooded_areas": "Flood",
    "traffic_incident": "Traffic",
    "normal": "Normal",
}

MODEL_PATH = Path(
    os.getenv("MODEL1_PATH", Path(__file__).resolve().with_name("aider_classifier.pth"))
).expanduser()

# Nếu đặt số (ví dụ 0.6), ảnh có xác suất top-1 thấp hơn số đó bị gắn needs_review=True.
# Mặc định None = không gắn cờ (chưa có số liệu để chọn ngưỡng).
REVIEW_BELOW = None

_cache = {}


def _load():
    if "model" in _cache:
        return _cache["model"], _cache["tf"], _cache["device"]
    import torch
    import torch.nn as nn
    from torchvision import transforms
    from torchvision.models import efficientnet_b0

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Không thấy model Model 1 tại {MODEL_PATH}. "
            "Đặt biến môi trường MODEL1_PATH hoặc chép file .pth cạnh file này."
        )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = efficientnet_b0(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(CLASSES))
    ck = torch.load(MODEL_PATH, map_location=device)
    model.load_state_dict(ck["model_state_dict"] if "model_state_dict" in ck else ck)
    model = model.to(device).eval()

    tf = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    _cache.update(model=model, tf=tf, device=device)
    return model, tf, device


def run_incident_classification(image_path, prediction_id=None):
    import torch
    from PIL import Image

    model, tf, device = _load()
    with Image.open(image_path) as im:
        x = tf(im.convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        probs = torch.softmax(model(x), dim=1)[0].cpu().tolist()

    top = max(range(len(CLASSES)), key=lambda i: probs[i])
    raw = CLASSES[top]
    conf = round(float(probs[top]), 4)
    return {
        "prediction_id": prediction_id,
        "incident_type": INCIDENT_TYPE[raw],
        "raw_label": raw,
        "confidence": conf,
        "is_normal": raw == "normal",
        "probs": {INCIDENT_TYPE[c]: round(float(p), 4) for c, p in zip(CLASSES, probs)},
        "needs_review": bool(REVIEW_BELOW is not None and conf < REVIEW_BELOW),
    }


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("Cách dùng: python model1_inference.py <ảnh>")
        raise SystemExit(1)
    print(json.dumps(run_incident_classification(sys.argv[1]), ensure_ascii=False, indent=2))
