"""
SkyRescue - Model 2 (phát hiện người + tư thế) - INFERENCE ONLY.

Cách dùng:
    from model2_inference import detect_people, filter_class
    dets = detect_people("anh.png")                  # mọi người
    upright = filter_class(dets, "Upright")          # Flood: chỉ người đứng

Mỗi phần tử: {"x1","y1","x2","y2","conf","cls"}, toạ độ PIXEL của ảnh GỐC.
`cls` lấy từ model (bản 2 class: "Upright" / "Other"; bản 5 class: tên 5 tư thế).

Tham số mặc định khớp với thiết lập Người 4 đã kiểm tra severity Traffic:
    conf=0.25, iou=0.5, imgsz=640.
Traffic dùng TẤT CẢ box (bất kể cls). Flood chỉ dùng cls == "Upright".

Đường dẫn model: biến môi trường MODEL2_PATH, mặc định file v8m_up2_best.pt
nằm cạnh file này. Ghi rõ phiên bản model đang dùng trong registry.json.
"""

import os
import json
import sys
from pathlib import Path

DEFAULT_MODEL_FILENAME = "v8m_up2_best.pt"
DEFAULT_CONF = 0.25
DEFAULT_IOU = 0.5
DEFAULT_IMGSZ = 640

MODEL_PATH = Path(
    os.getenv("MODEL2_PATH", Path(__file__).resolve().with_name(DEFAULT_MODEL_FILENAME))
).expanduser()

_model = None


def _get_model():
    """Nạp model một lần rồi dùng lại (nạp lại mỗi ảnh sẽ rất chậm)."""
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Không thấy model Model 2 tại {MODEL_PATH}. "
                "Đặt biến môi trường MODEL2_PATH hoặc chép file .pt cạnh file này."
            )
        from ultralytics import YOLO
        _model = YOLO(str(MODEL_PATH))
    return _model


def detect_people(image, conf=DEFAULT_CONF, iou=DEFAULT_IOU, imgsz=DEFAULT_IMGSZ):
    """
    Phát hiện người trong MỘT ảnh.

    image: đường dẫn ảnh (str / Path), hoặc mảng numpy / PIL.Image.
    Trả về list[dict] sắp theo conf giảm dần; ảnh không có ai thì trả [].

    Chạy từng ảnh một (không gom lô): gom lô ảnh khác kích thước từng gây
    hết bộ nhớ GPU khi xuất kết quả.
    """
    model = _get_model()
    src = str(image) if isinstance(image, (str, Path)) else image
    result = model.predict(src, conf=conf, iou=iou, imgsz=imgsz, verbose=False)[0]

    names = result.names
    boxes = result.boxes
    xyxy = boxes.xyxy.cpu().numpy()
    confs = boxes.conf.cpu().numpy()
    clss = boxes.cls.cpu().numpy().astype(int)

    dets = [
        {
            "x1": round(float(b[0]), 1),
            "y1": round(float(b[1]), 1),
            "x2": round(float(b[2]), 1),
            "y2": round(float(b[3]), 1),
            "conf": round(float(c), 3),
            "cls": names[int(k)],
        }
        for b, c, k in zip(xyxy, confs, clss)
    ]
    dets.sort(key=lambda d: d["conf"], reverse=True)
    return dets


def detect_people_batch(images, **kwargs):
    """Chạy lần lượt nhiều ảnh. Trả dict {tên ảnh hoặc chỉ số: list[dict]}."""
    out = {}
    for i, im in enumerate(images):
        key = Path(im).name if isinstance(im, (str, Path)) else i
        out[key] = detect_people(im, **kwargs)
    return out


def get_image_size(image):
    """Trả (width, height) pixel của ảnh gốc. Nhận đường dẫn, PIL.Image hoặc numpy."""
    if isinstance(image, (str, Path)):
        from PIL import Image
        with Image.open(image) as im:
            return im.size
    if hasattr(image, "shape"):          # numpy: (H, W, ...)
        return image.shape[1], image.shape[0]
    return image.size                     # PIL.Image


def detect_people_with_size(image, **kwargs):
    """
    Trả (dets, width, height). Traffic cần kích thước ảnh để đổi pixel ra mét,
    nên luồng Traffic chỉ cần gọi hàm này với đường dẫn ảnh.
    """
    w, h = get_image_size(image)
    return detect_people(image, **kwargs), w, h


def filter_class(dets, cls_name, min_w=0.0, min_h=0.0, min_conf=0.0):
    """
    Lọc theo tên class, kích thước tối thiểu (pixel) và conf tối thiểu.
    Ví dụ Flood: filter_class(dets, "Upright", min_w=8, min_h=30, min_conf=0.4)
    """
    return [
        d for d in dets
        if d["cls"] == cls_name
        and (d["x2"] - d["x1"]) >= min_w
        and (d["y2"] - d["y1"]) >= min_h
        and d["conf"] >= min_conf
    ]


def to_xyxy(dets):
    """Danh sách [(x1, y1, x2, y2), ...] để đưa vào compute_traffic_severity."""
    return [(d["x1"], d["y1"], d["x2"], d["y2"]) for d in dets]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Cách dùng: python model2_inference.py <ảnh> [conf]")
        sys.exit(1)
    c = float(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_CONF
    print(json.dumps(detect_people(sys.argv[1], conf=c), ensure_ascii=False, indent=2))
