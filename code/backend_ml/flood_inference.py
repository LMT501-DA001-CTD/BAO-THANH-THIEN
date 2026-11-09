"""
SkyRescue - Flood: wrapper cho router (Người 5).

    run_flood_assessment(image_path, prediction_id=None) -> dict      # mẫu mục 6.1 và 6.3 của tài liệu phân công GĐ2

Lõi tính toán (công thức, hiệu chỉnh BASE, bộ lọc người tham chiếu) nằm ở flood_severity.py. File này chỉ làm 3 việc:
  1. lấy bbox của ảnh từ nguồn đã chọn,
  2. nạp BASE đã hiệu chỉnh (file flood_calibration_<nguồn>.json do flood_severity.py ghi ra),
  3. gọi assess_image() và trả đúng dict chung.

Hai nguồn bbox (ghi vào details["bbox_source"]):
  "annotation" (MẶC ĐỊNH, dùng cho demo): annotation gốc C2A. Cần thư mục JSON C2A.
  "model2": Model 2 (v8m 2 class) chạy trực tiếp trên ảnh. Chỉ bắt đúng 5/65 ảnh flood nên là HẠN CHẾ, không dùng làm nguồn chính.

Cấu hình: gọi configure(...) một lần, hoặc đặt biến môi trường
  SKYRESCUE_FLOOD_ANN_DIR   thư mục JSON C2A (cần cho nguồn annotation)
  SKYRESCUE_FLOOD_CALIB_DIR thư mục chứa flood_calibration_*.json (mặc định ./out_flood)

BẢN CHUẨN (chốt 22/10, thay cho bản Drive có BASE 2,5 mặc định cho nguồn model2): KHÔNG có hằng BASE nào trong code.
BASE luôn đọc từ flood_calibration_<nguồn>.json; không có file thì báo lỗi, không tự đặt một số mặc định.
Nguồn model2 chưa có file hiệu chỉnh riêng thì dùng BASE của annotation và ghi rõ params.base_from="annotation"
(đặt configure(strict_base=True) để cấm trường hợp này). Mọi kết quả đều mang params.base và params.base_from; check() kiểm tra.
Ảnh không tìm thấy trong nguồn annotation -> severity 1.0 + needs_review=True, details["image_in_source"]=False.
Ảnh không có người Upright đủ lớn (h >= 30, w >= 8, conf >= 0.40) -> severity 1.0 + needs_review=True.

Tự kiểm tra:  python flood_inference.py <ảnh> [--source annotation|model2] [--prediction-id N]
"""
from __future__ import annotations
import argparse, json, os

from flood_severity import (BBOX_SOURCES, SPLITS, SCENE_PREFIX, FloodConfig, assess_image,
                            detections_to_boxes, load_annotation_boxes, to_stem)

REQUIRED = {"prediction_id", "incident_type", "severity_level", "severity_score", "confidence", "needs_review"}

_STATE: dict = {}


def configure(ann_dir: str | None = None, calib_dir: str | None = None, cfg: FloodConfig | None = None,
              strict_base: bool = False) -> None:
    _STATE.clear()
    # Nếu không truyền calib_dir, ưu tiên tìm ở "out_flood", nếu không có thì tìm ngay tại thư mục chứa file "."
    default_calib = "out_flood" if os.path.exists("out_flood/flood_calibration_annotation.json") else "."
    _STATE.update(
        ann_dir=ann_dir or os.environ.get("SKYRESCUE_FLOOD_ANN_DIR"),
        calib_dir=calib_dir or os.environ.get("SKYRESCUE_FLOOD_CALIB_DIR", default_calib),
        cfg=cfg or FloodConfig(), strict_base=strict_base, ann_groups=None, ann_stems=None, base={})


def _ensure() -> None:
    if not _STATE:
        configure()


def _load_annotation() -> None:
    if _STATE["ann_groups"] is not None:
        return
    d = _STATE["ann_dir"]
    assert d, "Nguồn 'annotation' cần thư mục JSON C2A: configure(ann_dir=...) hoặc biến SKYRESCUE_FLOOD_ANN_DIR"
    ann = load_annotation_boxes(d)
    ann = ann[ann.stem.str.startswith(SCENE_PREFIX)]
    stems = set()                      # kể cả ảnh có 0 annotation (không có dòng nào trong bảng bbox)
    for s in SPLITS:
        with open(f"{d}/{s}_annotations_with_pose_information.json") as f:
            stems.update(to_stem(im["file_name"]) for im in json.load(f)["images"])
    _STATE["ann_groups"] = {k: g for k, g in ann.groupby("stem")}
    _STATE["ann_stems"] = stems


def _base_for(source: str) -> tuple[float, str]:
    """(BASE, nguồn của BASE). Model 2 chưa có hiệu chỉnh riêng thì dùng BASE của annotation và ghi rõ vào params.base_from."""
    if source in _STATE["base"]:
        return _STATE["base"][source]
    tried = []
    fallback = [source] if _STATE["strict_base"] else [source, "annotation"]
    for src in dict.fromkeys(fallback):
        p = os.path.join(_STATE["calib_dir"], f"flood_calibration_{src}.json")
        tried.append(p)
        if os.path.exists(p):
            with open(p) as f:
                c = json.load(f)
            b = float(c["base"])
            assert b > 0, f"BASE trong {p} không hợp lệ: {b}"
            _STATE["base"][source] = (b, c.get("base_from", src))
            return _STATE["base"][source]
    raise FileNotFoundError("Chưa có BASE đã hiệu chỉnh" + (" (strict_base: không mượn BASE annotation)" if _STATE["strict_base"] else "") + ". Chạy trước: python flood_severity.py --ann-dir <JSON C2A> "
                            f"--split <split.json> --out {_STATE['calib_dir']}. Đã tìm: {tried}")


def _unpack(res):
    """detect_people trả list; detect_people_with_size có thể trả (list, kích thước ảnh). Chỉ lấy list box."""
    if isinstance(res, tuple) and res and isinstance(res[0], list):
        return res[0]
    return res


def run_flood_assessment(image_path, prediction_id=None, bbox_source: str = "annotation", detector=None) -> dict:
    """Wrapper Flood theo mục 6.1. Trả dict mục 6.3 (incident_type='Flood', needs_review là bool).
    detector: hàm ảnh -> list[{x1,y1,x2,y2,conf,cls}] cho nguồn 'model2'; mặc định model2_inference.detect_people."""
    assert bbox_source in BBOX_SOURCES, f"bbox_source phải là một trong {BBOX_SOURCES}"
    _ensure()
    cfg = _STATE["cfg"]
    base, base_from = _base_for(bbox_source)
    stem = to_stem(image_path)

    if bbox_source == "annotation":
        _load_annotation()
        g = _STATE["ann_groups"].get(stem)
        in_source = stem in _STATE["ann_stems"]
    else:
        if detector is None:
            from model2_inference import detect_people as detector      # chỉ nạp khi thật sự cần
        g = detections_to_boxes(str(image_path), _unpack(detector(str(image_path))))
        in_source = True                                                 # ảnh do chính model xử lý

    return assess_image(g, stem, cfg, base, bbox_source, prediction_id=prediction_id,
                        image_name=os.path.basename(str(image_path)), image_in_source=in_source, base_from=base_from)


def check(d: dict) -> bool:
    """Kiểm tra khớp nối mục 6.6."""
    missing = REQUIRED - d.keys()
    assert not missing, f"thiếu khóa: {missing}"
    assert 0.0 <= d["severity_score"] <= 1.0, "severity_score ngoài 0..1"
    assert isinstance(d["needs_review"], bool), "needs_review phải là bool"
    assert d["details"].get("bbox_source") in BBOX_SOURCES, "details['bbox_source'] thiếu hoặc sai"
    p = d["details"].get("params") or {}
    assert p.get("base", 0) > 0, "details['params']['base'] thiếu hoặc không dương"
    assert p.get("base_from") in BBOX_SOURCES, "details['params']['base_from'] thiếu hoặc sai (phải ghi nguồn của BASE)"
    return True


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--source", choices=BBOX_SOURCES, default="annotation")
    ap.add_argument("--prediction-id", type=int)
    ap.add_argument("--ann-dir")
    ap.add_argument("--calib-dir")
    ap.add_argument("--strict-base", action="store_true", help="cấm mượn BASE của annotation cho nguồn khác")
    a = ap.parse_args()
    configure(ann_dir=a.ann_dir, calib_dir=a.calib_dir, strict_base=a.strict_base)
    out = run_flood_assessment(a.image, a.prediction_id, a.source)
    check(out)
    print(json.dumps(out, indent=2, ensure_ascii=False))
