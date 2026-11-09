"""
SkyRescue - Flood severity: phần lõi tính toán (Người 5). Wrapper gọi từ router nằm ở flood_inference.py.

Công thức: người đứng thẳng có h/w của bbox gần cố định (BASE). Nước che chân -> h giảm.
    ratio          = clip(1 - (h/w)/BASE, 0, 1)         với từng người Upright tham chiếu
    severity_score = max(ratio) trong ảnh                (không trừ ngưỡng nhiễu / FLOOR)
Không có người Upright đủ lớn -> severity 1.0 + needs_review=True. Ca gắn cờ KHÔNG nêu nguyên nhân.

Hai nguồn bbox (details["bbox_source"]):
  "annotation" : annotation gốc C2A (COCO, [x,y,w,h], x,y = góc trên-trái). Mặc định cho demo.
  "model2"     : box từ Model 2 (v8m 2 class). Chỉ phủ rất ít ảnh flood (5/65 đúng class) nên là HẠN CHẾ, không dùng làm nguồn chính.
Lọc người tham chiếu: class == Upright, w >= min_w (8), h >= min_h (30), conf >= min_conf (0.40, đề xuất).
n_person = số dòng bbox của ảnh (mọi class, không lọc). Ảnh không có dòng nào = 0 người (left-join từ danh sách ảnh).
Khoá ghép giữa các nhóm là STEM (bỏ đường dẫn và đuôi), vd "flood_image0015_3".

CLI:
  python flood_severity.py --ann-dir DIR --split split_by_background_seed42.json --out out_flood
  python flood_severity.py ... --source model2 --detections bbox_test_v8m_up2_iou05.csv --base-from annotation
                                  (CSV chỉ có tập test thì phải thêm --base-from annotation; không thì không có bbox train để hiệu chỉnh BASE)
  python flood_severity.py ... --check-csv bbox_test_v8m_up2_iou05.csv      # kiểm tra file CSV của Người 1
"""
from __future__ import annotations
import argparse, hashlib, json, os, re
from dataclasses import dataclass, asdict
from datetime import date
import numpy as np
import pandas as pd

UPRIGHT_LABEL = "Upright"          # Model 2 (2 class): "Upright" | "Other"
POSE_UPRIGHT_ID = 4                # C2A gốc: 0 Bent, 1 Kneeling, 2 Lying, 3 Sitting, 4 Upright
SPLITS = ("train", "val", "test")
SCENE_PREFIX = "flood_"
BBOX_SOURCES = ("annotation", "model2")
INCIDENT_TYPE = "Flood"            # tên chuẩn của cả hệ thống (mục 6.2)
BOX_COLS = ["image", "stem", "is_upright", "x", "y", "w", "h", "conf"]
_EXT = re.compile(r"\.[A-Za-z0-9]+$")


def to_stem(name) -> str:
    """'dir/flood_image0015_3.png' -> 'flood_image0015_3' (khoá ghép chung giữa các nhóm)."""
    return _EXT.sub("", os.path.basename(str(name)))


def background_of(stem: str) -> str:
    """5 biến thể cùng một nền (flood_image0299_0..4) luôn nằm cùng một split."""
    return stem.rsplit("_", 1)[0]


@dataclass
class FloodConfig:
    min_w: int = 8
    min_h: int = 30
    min_conf: float = 0.40         # ĐỀ XUẤT; annotation có conf = 1.0 nên không bị ảnh hưởng
    human_cm: float = 165.0
    unknown_severity: float = 1.0
    max_flag_eps: float = 1e-9
    default_ext: str = ".png"


# --------------------------------------------------------------------------- #
# 1. Split
# --------------------------------------------------------------------------- #

def load_split(path: str) -> dict[str, str]:
    """split_by_background_seed42.json = {tên ảnh không đuôi: 'train'|'val'|'test'}."""
    with open(path) as f:
        sp = json.load(f)
    assert isinstance(sp, dict) and sp, "split phải là dict {tên_ảnh: split}"
    assert all(isinstance(v, str) for v in sp.values()), (
        "Mỗi giá trị phải là chuỗi 'train'/'val'/'test'. Nếu file dạng {\"train\": [...], \"val\": [...]} "
        "thì đó là định dạng khác với bản split đã chốt - hỏi lại Người 1")
    bad = set(sp.values()) - set(SPLITS)
    assert not bad, f"Giá trị split lạ {bad} - khác định dạng đã biết, hỏi lại Người 1"
    out = {to_stem(k): v for k, v in sp.items()}
    assert len(out) == len(sp), "Có 2 khoá cùng stem sau khi bỏ đường dẫn/đuôi"
    return out


def split_stems(split_map: dict, split: str, prefix: str = SCENE_PREFIX) -> list[str]:
    return sorted(s for s, v in split_map.items() if v == split and s.startswith(prefix))


# --------------------------------------------------------------------------- #
# 2. Hai nguồn bbox -> cùng một bảng BOX_COLS (x, y = góc trên-trái, pixel ảnh gốc)
# --------------------------------------------------------------------------- #

def load_annotation_boxes(ann_dir: str) -> pd.DataFrame:
    """Nguồn "annotation": annotation gốc C2A (COCO, pixel, [x,y,w,h]). Ground truth nên conf = 1.0."""
    rows, names = [], {}
    for k, split in enumerate(SPLITS):
        p = f"{ann_dir}/{split}_annotations_with_pose_information.json"
        if not os.path.exists(p):
            continue
        with open(p) as f:
            d = json.load(f)
        off = k * 10_000_000                       # tránh trùng image_id giữa 3 file
        names.update({im["id"] + off: im["file_name"] for im in d["images"]})
        for a in d["annotations"]:
            x, y, w, h = a["bbox"]
            rows.append((a["image_id"] + off, a["pose"] == POSE_UPRIGHT_ID, x, y, w, h, 1.0))
    df = pd.DataFrame(rows, columns=["image_id", "is_upright", "x", "y", "w", "h", "conf"])
    df["image"] = df.image_id.map(names)
    df["stem"] = df.image.map(to_stem).astype(str)  # <-- Gộp tay: ép kiểu str tránh lỗi .str accessor
    return df[BOX_COLS]


load_c2a_boxes = load_annotation_boxes     # tên cũ


def _clean_cls(s: pd.Series) -> pd.Series:
    m = {"upright": UPRIGHT_LABEL, "other": "Other"}
    out = s.astype(str).str.strip().str.lower().map(m)
    assert out.notna().all(), (f"class lạ: {sorted(set(s.astype(str)) - {'Upright', 'Other'})} - "
                               "không phải bản 2 class Upright/Other")
    return out


def _box_frame(image, x, y, w, h, conf, cls) -> pd.DataFrame:
    df = pd.DataFrame(dict(image=pd.Series(image).astype(str).to_numpy(), x=pd.Series(x).to_numpy(float),
                           y=pd.Series(y).to_numpy(float), w=pd.Series(w).to_numpy(float),
                           h=pd.Series(h).to_numpy(float), conf=pd.Series(conf).to_numpy(float),
                           cls=_clean_cls(pd.Series(cls)).to_numpy()))
    assert (df.w > 0).all() and (df.h > 0).all(), "Có bbox w <= 0 hoặc h <= 0 - kiểm tra định dạng cột"
    assert df.conf.between(0, 1).all(), "conf ngoài [0,1]"
    df["stem"] = df.image.map(to_stem)
    df["is_upright"] = df.cls == UPRIGHT_LABEL
    return df[BOX_COLS]


def load_model2_csv(path: str) -> pd.DataFrame:
    """CSV box người từ Model 2. Hai định dạng:
       (a) image,x,y,w,h,class,conf   - x,y = GÓC TRÊN-TRÁI, pixel ảnh gốc (bbox_test_v8m_up2_iou05.csv)
       (b) image,x1,y1,x2,y2,conf,cls - hai góc, pixel ảnh gốc (đầu ra detect_people)"""
    df = pd.read_csv(path)
    cols = set(df.columns)
    if {"image", "x", "y", "w", "h", "class", "conf"} <= cols:
        return _box_frame(df.image, df.x, df.y, df.w, df.h, df.conf, df["class"])
    if {"image", "x1", "y1", "x2", "y2", "conf", "cls"} <= cols:
        assert (df.x2 > df.x1).all() and (df.y2 > df.y1).all(), "Có bbox x2<=x1 hoặc y2<=y1"
        return _box_frame(df.image, df.x1, df.y1, df.x2 - df.x1, df.y2 - df.y1, df.conf, df.cls)
    raise AssertionError(f"CSV không đúng định dạng đã biết. Cột hiện có: {sorted(cols)}. "
                         "Cần image,x,y,w,h,class,conf hoặc image,x1,y1,x2,y2,conf,cls")


def detections_to_boxes(image, detections: list) -> pd.DataFrame:
    """Đầu ra detect_people (list[{x1,y1,x2,y2,conf,cls}], pixel ảnh gốc) -> bảng BOX_COLS. Danh sách rỗng được phép."""
    if not detections:
        return pd.DataFrame(columns=BOX_COLS).astype({"is_upright": bool})
    miss = {"x1", "y1", "x2", "y2", "conf", "cls"} - set(detections[0])
    assert not miss, f"detect_people thiếu khoá {miss} - không khớp định dạng đã chốt"
    return _box_frame([image] * len(detections), [d["x1"] for d in detections], [d["y1"] for d in detections],
                      [d["x2"] - d["x1"] for d in detections], [d["y2"] - d["y1"] for d in detections],
                      [d["conf"] for d in detections], [d["cls"] for d in detections])


# --------------------------------------------------------------------------- #
# 3. Hiệu chỉnh BASE
# --------------------------------------------------------------------------- #

def _reference(boxes: pd.DataFrame, cfg: FloodConfig) -> pd.DataFrame:
    return boxes[boxes.is_upright & (boxes.w >= cfg.min_w) & (boxes.h >= cfg.min_h) & (boxes.conf >= cfg.min_conf)]


def calibrate_base(boxes: pd.DataFrame, calib_stems, cfg: FloodConfig,
                   n_boot: int = 2000, seed: int = 0) -> dict:
    """BASE = trung vị h/w của bbox Upright đủ lớn trong ảnh của tập hiệu chỉnh (mặc định train).
    Khoảng tin cậy 95% bootstrap theo NỀN (5 biến thể cùng nền không độc lập)."""
    ref = _reference(boxes[boxes.stem.isin(set(calib_stems))], cfg).copy()
    assert len(ref) >= 30, (f"Chỉ {len(ref)} bbox Upright đủ lớn để hiệu chỉnh BASE - quá ít. "
                            "Dừng lại, không tự hạ ngưỡng, báo lại nhóm.")
    ref["hw"] = ref.h / ref.w.clip(lower=1)
    groups = [g.hw.to_numpy() for _, g in ref.groupby(ref.stem.map(background_of))]
    rng = np.random.default_rng(seed)
    meds = [np.median(np.concatenate([groups[i] for i in rng.integers(0, len(groups), len(groups))]))
            for _ in range(n_boot)]
    lo, hi = np.percentile(meds, [2.5, 97.5])
    return dict(base=float(ref.hw.median()), ci95=[float(lo), float(hi)],
                n_ref_boxes=int(len(ref)), n_ref_images=int(ref.stem.nunique()),
                n_backgrounds=len(groups))


def diagnostics(boxes: pd.DataFrame, split_map: dict, cfg: FloodConfig) -> pd.DataFrame:
    rows = []
    for s in SPLITS:
        stems = split_stems(split_map, s)
        ref = _reference(boxes[boxes.stem.isin(set(stems))], cfg)
        rows.append(dict(split=s, n_images=len(stems), n_with_reference=ref.stem.nunique(),
                         coverage_pct=round(100 * ref.stem.nunique() / max(len(stems), 1), 1),
                         n_ref_boxes=len(ref),
                         base_median_hw=round(float((ref.h / ref.w.clip(lower=1)).median()), 3)
                         if len(ref) else None))
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# 4. Severity từng ảnh -> dict đúng mẫu mục 6.3
# --------------------------------------------------------------------------- #

def _level(score: float, flagged: bool) -> str:
    if flagged:
        return "Cần xem lại"
    if score < 0.25:
        return "Khô / ngập rất nhẹ"
    if score < 0.5:
        return "Ngập nhẹ"
    if score < 0.75:
        return "Ngập trung bình"
    return "Ngập nặng"


def assess_image(g: pd.DataFrame | None, stem: str, cfg: FloodConfig, base: float, bbox_source: str,
                 prediction_id=None, image_name: str | None = None, image_in_source: bool = True,
                 base_from: str | None = None) -> dict:
    """Dict mẫu mục 6.3 cho 1 ảnh. g = các dòng bbox của ảnh (None/rỗng = 0 người)."""
    assert bbox_source in BBOX_SOURCES, f"bbox_source phải là một trong {BBOX_SOURCES}"
    n_person = 0 if g is None else int(len(g))                      # đếm trực tiếp số dòng bbox
    ref = None if (g is None or len(g) == 0) else _reference(g, cfg)
    n_ref = 0 if ref is None else int(len(ref))
    details = dict(bbox_source=bbox_source, image=image_name or stem + cfg.default_ext, stem=stem,
                   image_in_source=bool(image_in_source), n_person=n_person, n_reference=n_ref,
                   params=dict(base=float(base), base_from=base_from or bbox_source, min_w=cfg.min_w,
                               min_h=cfg.min_h, min_conf=cfg.min_conf))
    head = dict(prediction_id=prediction_id, incident_type=INCIDENT_TYPE)

    if n_ref == 0:                                                   # không đo được: fail-safe, không nêu nguyên nhân
        details.update(submersion_ratio=None, est_depth_cm=None, explanation="Cần người điều phối xem lại ảnh.")
        return dict(**head, severity_level=_level(0, True), severity_score=float(cfg.unknown_severity),
                    confidence=None, needs_review=True, severity_raw=None, details=details)

    ratio = float((1 - (ref.h / ref.w.clip(lower=1)) / base).clip(0, 1).max())
    at_max = bool(ratio >= 1.0 - cfg.max_flag_eps)
    details.update(submersion_ratio=ratio, est_depth_cm=float(ratio * cfg.human_cm) if ratio > 0 else None,
                   explanation=("Cần người điều phối xem lại ảnh." if at_max
                                else f"Ước tính từ {n_ref} người Upright tham chiếu."))
    return dict(**head, severity_level=_level(ratio, at_max), severity_score=ratio,
                confidence=float(ref.conf.mean()) if bbox_source == "model2" else None,
                needs_review=at_max, severity_raw=ratio, details=details)


def predict_flood_severity(boxes: pd.DataFrame, stems, cfg: FloodConfig, base: float,
                           bbox_source: str = "annotation", prediction_ids: dict | None = None,
                           base_from: str | None = None) -> list[dict]:
    """1 dict/ảnh cho MỌI stem trong `stems` (left-join: ảnh không có bbox nào -> n_person = 0).
    prediction_ids: {stem: prediction_id} do router/DB cấp khi lưu Prediction."""
    if prediction_ids is not None:
        absent = [x for x in stems if x not in prediction_ids]
        assert not absent, f"{len(absent)} ảnh chưa có prediction_id, ví dụ {absent[:3]}"
    names = boxes.drop_duplicates("stem").set_index("stem").image.to_dict()
    groups = {k: g for k, g in boxes.groupby("stem")}
    return [assess_image(groups.get(s), s, cfg, base, bbox_source,
                         prediction_id=None if prediction_ids is None else prediction_ids[s],
                         image_name=names.get(s), image_in_source=True, base_from=base_from)
            for s in stems]


# --------------------------------------------------------------------------- #
# 5. Kiểm tra file CSV box của Model 2 (bbox_test_v8m_up2_iou05.csv)
# --------------------------------------------------------------------------- #

def _iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """a: (n,4) và b: (m,4), dạng [x, y, w, h] -> ma trận IoU (n,m)."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    ax1, ay1, ax2, ay2 = a[:, 0:1], a[:, 1:2], a[:, 0:1] + a[:, 2:3], a[:, 1:2] + a[:, 3:4]
    bx1, by1, bx2, by2 = b[:, 0], b[:, 1], b[:, 0] + b[:, 2], b[:, 1] + b[:, 3]
    iw = np.clip(np.minimum(ax2, bx2) - np.maximum(ax1, bx1), 0, None)
    ih = np.clip(np.minimum(ay2, by2) - np.maximum(ay1, by1), 0, None)
    inter = iw * ih
    union = a[:, 2:3] * a[:, 3:4] + (b[:, 2] * b[:, 3])[None, :] - inter
    return inter / np.where(union == 0, 1, union)


def _match_rate(pred: pd.DataFrame, gt: pd.DataFrame, shift: str, thr: float = 0.5) -> float:
    """Tỉ lệ box dự đoán khớp (IoU >= thr) với một box thật cùng ảnh, nếu hiểu x,y là góc trên-trái ("tl")
    hay là tâm ("center")."""
    gt_g = {k: g[["x", "y", "w", "h"]].to_numpy() for k, g in gt.groupby("stem")}
    hit = tot = 0
    for stem, g in pred.groupby("stem"):
        p = g[["x", "y", "w", "h"]].to_numpy(float).copy()
        if shift == "center":
            p[:, 0] -= p[:, 2] / 2
            p[:, 1] -= p[:, 3] / 2
        iou = _iou_matrix(p, gt_g.get(stem, np.zeros((0, 4))))
        hit += int((iou.max(axis=1) >= thr).sum()) if iou.size else 0
        tot += len(p)
    return hit / max(tot, 1)


def check_model2_csv(csv_path: str, split_map: dict, ann_boxes: pd.DataFrame, cfg: FloodConfig,
                     split: str = "test", iou_thr: float = 0.5) -> dict:
    """Kiểm tra CSV box Model 2 theo ghi chú của Người 1. Không sửa dữ liệu, chỉ đo và cảnh báo."""
    pred = load_model2_csv(csv_path)
    stems = split_stems(split_map, split)
    out: dict = dict(split=split, n_flood_images=len(stems), warnings=[])

    in_split = pred.stem.isin(split_map)
    out["rows"] = int(len(pred))
    out["rows_stem_not_in_split"] = int((~in_split).sum())
    other = pred[in_split & (pred.stem.map(split_map) != split)]
    out["rows_in_other_splits"] = int(len(other))
    if out["rows_stem_not_in_split"]:
        out["warnings"].append(f"{out['rows_stem_not_in_split']} dòng có tên ảnh không có trong split "
                               f"(ví dụ {pred[~in_split].stem.head(3).tolist()}) - kiểm tra cách đặt tên ảnh")
    if out["rows_in_other_splits"]:
        out["warnings"].append(f"{out['rows_in_other_splits']} dòng thuộc split khác {split} - "
                               "file này lẽ ra chỉ chứa tập test")

    p = pred[pred.stem.isin(stems)]                                    # chỉ ảnh flood của split
    g_all = ann_boxes[ann_boxes.stem.isin(stems)]
    out["n_images_with_rows"] = int(p.stem.nunique())
    out["n_images_zero_person"] = len(stems) - out["n_images_with_rows"]   # left-join: không có dòng = 0 người
    out["rows_by_class"] = p.is_upright.map({True: "Upright", False: "Other"}).value_counts().to_dict()

    # (1) x,y có thật là góc trên-trái, pixel gốc?
    if len(p):
        tl, ce = _match_rate(p, g_all, "tl", iou_thr), _match_rate(p, g_all, "center", iou_thr)
        out["match_rate_if_top_left"], out["match_rate_if_center"] = round(tl, 3), round(ce, 3)
        if tl < ce:
            out["warnings"].append("x,y khớp annotation tốt hơn khi hiểu là TÂM box, không phải góc trên-trái")
        if tl < 0.2:
            out["warnings"].append(f"Chỉ {tl:.0%} box khớp annotation (IoU>={iou_thr}) - có thể sai đơn vị/kích thước ảnh")
        if (p[["x", "y", "w", "h"]].max() <= 1.0).all():
            out["warnings"].append("Mọi toạ độ <= 1 - có vẻ đang chuẩn hoá 0-1, không phải pixel ảnh gốc")
        if (p.x < 0).any() or (p.y < 0).any():
            out["warnings"].append(f"{int(((p.x < 0) | (p.y < 0)).sum())} box có x hoặc y âm")

    # (2) Độ phủ Flood theo bộ lọc đã chốt
    gt_ref = _reference(g_all, cfg)
    pr_ref = _reference(p, cfg)
    out["images_with_gt_reference"] = int(gt_ref.stem.nunique())
    out["images_with_model_reference"] = int(pr_ref.stem.nunique())
    right, gt_by = set(), {k: g[["x", "y", "w", "h"]].to_numpy() for k, g in gt_ref.groupby("stem")}
    for stem, g in pr_ref.groupby("stem"):
        iou = _iou_matrix(g[["x", "y", "w", "h"]].to_numpy(float), gt_by.get(stem, np.zeros((0, 4))))
        if iou.size and (iou >= iou_thr).any():
            right.add(stem)
    out["images_model_matches_gt_upright"] = len(right)          # so với "5/65" trong tài liệu GĐ2
    out["images_false_upright"] = int(len(set(pr_ref.stem) - set(gt_ref.stem)))
    out["coverage_model_pct"] = round(100 * out["images_with_model_reference"] / max(len(stems), 1), 1)
    out["coverage_annotation_pct"] = round(100 * out["images_with_gt_reference"] / max(len(stems), 1), 1)
    sweep = {}
    for c in (0.25, 0.40, 0.50):
        sweep[c] = int(_reference(p, FloodConfig(cfg.min_w, cfg.min_h, c)).stem.nunique())
    out["images_with_reference_by_min_conf"] = sweep
    return out


# --------------------------------------------------------------------------- #
# 6. CLI
# --------------------------------------------------------------------------- #

def _sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


def calibration_record(cfg: FloodConfig, calib: dict, source: str, calib_split: str, split_path: str,
                       detections_file: str | None = None) -> dict:
    return dict(**asdict(cfg), **calib, bbox_source=source, calibrated_on=calib_split,
                split_file=os.path.basename(split_path), split_sha256_16=_sha256(split_path),
                detections_file=os.path.basename(detections_file) if detections_file else None,
                date=date.today().isoformat())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ann-dir", required=True)
    ap.add_argument("--split", required=True)
    ap.add_argument("--source", choices=BBOX_SOURCES, default="annotation")
    ap.add_argument("--detections", help="CSV box Model 2 (bắt buộc khi --source model2)")
    ap.add_argument("--check-csv", help="Chỉ kiểm tra CSV box Model 2 rồi thoát")
    ap.add_argument("--check-split", choices=SPLITS, default="test")
    ap.add_argument("--calib-split", choices=SPLITS, default="train")
    ap.add_argument("--base-from", choices=("same", "annotation"), default="same",
                    help="Nguồn bbox để hiệu chỉnh BASE. 'annotation' dùng khi --source model2 mà CSV chỉ có tập test (không có train)")
    ap.add_argument("--out", default="./out_flood")
    a = ap.parse_args()

    cfg = FloodConfig()
    split_map = load_split(a.split)
    ann = load_annotation_boxes(a.ann_dir)
    ann = ann[ann.stem.str.startswith(SCENE_PREFIX)]

    if a.check_csv:
        r = check_model2_csv(a.check_csv, split_map, ann, cfg, split=a.check_split)
        print(f"== Kiểm tra {os.path.basename(a.check_csv)} trên ảnh flood của split {a.check_split} ==")
        for k, v in r.items():
            if k != "warnings":
                print(f"  {k}: {v}")
        print("  CẢNH BÁO:" if r["warnings"] else "  Không có cảnh báo.")
        for w in r["warnings"]:
            print("   -", w)
        return

    if a.source == "annotation":
        boxes = ann
    else:
        assert a.detections, "--source model2 cần --detections CSV"
        boxes = load_model2_csv(a.detections)
        boxes = boxes[boxes.stem.str.startswith(SCENE_PREFIX)]
    os.makedirs(a.out, exist_ok=True)
    unknown = set(boxes.stem) - set(split_map)
    assert not unknown, (f"{len(unknown)} ảnh trong bbox không có trong split, ví dụ "
                         f"{sorted(unknown)[:3]} - kiểm tra cách đặt tên ảnh")

    calib = calibrate_base(ann if a.base_from == "annotation" else boxes, split_stems(split_map, a.calib_split), cfg)
    calib["base_from"] = "annotation" if a.base_from == "annotation" else a.source
    base = calib["base"]
    print(f"Nguồn bbox: {a.source} | BASE hiệu chỉnh trên {a.calib_split} = {base:.3f} "
          f"(CI95 {calib['ci95'][0]:.3f}-{calib['ci95'][1]:.3f}; {calib['n_ref_boxes']} bbox, "
          f"{calib['n_ref_images']} ảnh, {calib['n_backgrounds']} nền)")
    print(diagnostics(boxes, split_map, cfg).to_string(index=False))

    rows = []
    for s in SPLITS:
        for r in predict_flood_severity(boxes, split_stems(split_map, s), cfg, base, bbox_source=a.source,
                                         base_from=calib["base_from"]):
            d = r["details"]
            rows.append(dict(image=d["image"], stem=d["stem"], split=s, bbox_source=a.source,
                             severity_score=r["severity_score"], severity_level=r["severity_level"],
                             needs_review=r["needs_review"], confidence=r["confidence"], n_person=d["n_person"],
                             n_reference=d["n_reference"], submersion_ratio=d["submersion_ratio"],
                             est_depth_cm=d["est_depth_cm"]))
    res = pd.DataFrame(rows)
    res.to_csv(f"{a.out}/flood_severity_results_{a.source}.csv", index=False)
    res[res.needs_review].to_csv(f"{a.out}/flood_needs_review_{a.source}.csv", index=False)
    with open(f"{a.out}/flood_calibration_{a.source}.json", "w") as f:
        json.dump(calibration_record(cfg, calib, a.source, a.calib_split, a.split, a.detections),
                  f, indent=2, ensure_ascii=False)
    print(f"\nẢnh flood: {len(res)} | gắn cờ xem lại: {int(res.needs_review.sum())} "
          f"({100 * res.needs_review.mean():.1f}%) | đã ghi vào {a.out}")


if __name__ == "__main__":
    main()
