"""
Traffic Accident inference & severity gộp chung (SkyRescue)
"""
from dataclasses import dataclass
from typing import Sequence, Tuple
import numpy as np
from model2_inference import detect_people_with_size, to_xyxy

INCIDENT_TYPE = "Traffic"

# Ngưỡng Fruin LOS (người/m2)
FRUIN_THRESHOLDS = [
    ("A", 0.31), ("B", 0.43), ("C", 0.72), ("D", 1.08), ("E", 2.15), ("F", float("inf")),
]
LOS_TO_SCORE = {"A": 0.0, "B": 0.2, "C": 0.4, "D": 0.6, "E": 0.8, "F": 1.0}

DEFAULT_ALTITUDE_M = 12.0
DEFAULT_WINDOW_M = 4.0
DEFAULT_STRIDE_M = 1.0
DEFAULT_SENSOR_W_MM = 6.4
DEFAULT_SENSOR_H_MM = 4.8
DEFAULT_FOCAL_MM = 4.5

@dataclass
class TrafficSeverityResult:
    people_count: int
    densest_n: int
    area_m2: float
    victim_density_ppl_m2: float
    los_grade: str
    severity_score: float
    explanation: str

def victim_density_to_los(density_ppl_m2: float) -> str:
    if density_ppl_m2 < 0:
        raise ValueError("victim_density không thể âm")
    for grade, upper_bound in FRUIN_THRESHOLDS:
        if density_ppl_m2 < upper_bound:
            return grade
    return "F"

def gsd_from_altitude(img_w_px: int, img_h_px: int, altitude_m: float,
                      sensor_w_mm: float = DEFAULT_SENSOR_W_MM,
                      sensor_h_mm: float = DEFAULT_SENSOR_H_MM,
                      focal_mm: float = DEFAULT_FOCAL_MM) -> Tuple[float, float]:
    return (altitude_m * sensor_w_mm / (focal_mm * img_w_px),
            altitude_m * sensor_h_mm / (focal_mm * img_h_px))

def densest_window(centers_m: np.ndarray, width_m: float, height_m: float,
                   window_m: float, stride_m: float = DEFAULT_STRIDE_M) -> Tuple[int, float]:
    nx = max(int(np.ceil(width_m / stride_m)), 1)
    ny = max(int(np.ceil(height_m / stride_m)), 1)
    kx = min(max(int(round(window_m / stride_m)), 1), nx)
    ky = min(max(int(round(window_m / stride_m)), 1), ny)
    area = (kx * stride_m) * (ky * stride_m)

    if len(centers_m) == 0:
        return 0, area

    hist, _, _ = np.histogram2d(
        centers_m[:, 1], centers_m[:, 0], bins=[ny, nx],
        range=[[0, ny * stride_m], [0, nx * stride_m]],
    )
    prefix = np.zeros((ny + 1, nx + 1))
    prefix[1:, 1:] = hist.cumsum(0).cumsum(1)
    window_sums = prefix[ky:, kx:] - prefix[:-ky, kx:] - prefix[ky:, :-kx] + prefix[:-ky, :-kx]
    return int(round(window_sums.max())), area

def compute_traffic_severity(
    person_bboxes_px: Sequence[Tuple[float, float, float, float]],
    image_width_px: int,
    image_height_px: int,
    altitude_m: float = DEFAULT_ALTITUDE_M,
    window_m: float = DEFAULT_WINDOW_M,
    stride_m: float = DEFAULT_STRIDE_M,
    sensor_w_mm: float = DEFAULT_SENSOR_W_MM,
    sensor_h_mm: float = DEFAULT_SENSOR_H_MM,
    focal_mm: float = DEFAULT_FOCAL_MM,
) -> TrafficSeverityResult:
    people_count = len(person_bboxes_px)
    gx, gy = gsd_from_altitude(image_width_px, image_height_px, altitude_m,
                               sensor_w_mm, sensor_h_mm, focal_mm)

    if people_count == 0:
        centers_m = np.zeros((0, 2))
    else:
        boxes = np.asarray(person_bboxes_px, dtype=float)
        cx = (boxes[:, 0] + boxes[:, 2]) / 2 * gx
        cy = (boxes[:, 1] + boxes[:, 3]) / 2 * gy
        centers_m = np.stack([cx, cy], axis=1)

    width_m = image_width_px * gx
    height_m = image_height_px * gy
    densest_n, area_m2 = densest_window(centers_m, width_m, height_m, window_m, stride_m)

    density = densest_n / area_m2 if area_m2 > 0 else 0.0
    grade = victim_density_to_los(density)
    score = LOS_TO_SCORE[grade]

    explanation = (
        f"{people_count} người trong cả ảnh; cửa sổ {window_m:g}x{window_m:g} m đông nhất "
        f"có {densest_n} người trong {area_m2:.1f} m2 "
        f"-> mật độ {density:.3f} người/m2 -> hạng Fruin {grade} -> severity_score {score}"
    )
    return TrafficSeverityResult(
        people_count=people_count, densest_n=densest_n, area_m2=area_m2,
        victim_density_ppl_m2=density, los_grade=grade, severity_score=score,
        explanation=explanation,
    )

def run_traffic_assessment(image_path, prediction_id=None, **severity_kwargs):
    dets, w, h = detect_people_with_size(image_path)
    boxes = to_xyxy(dets)
    r = compute_traffic_severity(boxes, w, h, **severity_kwargs)

    return {
        "prediction_id": prediction_id,
        "incident_type": INCIDENT_TYPE,
        "severity_level": r.los_grade,
        "severity_score": r.severity_score,
        "confidence": None,
        "needs_review": False,
        "severity_raw": r.victim_density_ppl_m2,
        "details": {
            "people_count": r.people_count,
            "densest_n": r.densest_n,
            "area_m2": round(r.area_m2, 2),
            "victim_density_ppl_m2": round(r.victim_density_ppl_m2, 4),
            "explanation": r.explanation,
            "model2_detections": len(dets),
        },
    }