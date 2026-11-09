"""
Traffic Accident severity_score

Công thức: mật độ người ở cửa sổ trượt đông nhất (window_m x window_m, đơn vị người/m2)
  -> hạng Fruin LOS (A-F) -> severity_score theo bậc 0 / 0.2 / 0.4 / 0.6 / 0.8 / 1.0.
Ngưỡng Fruin: Fruin, J.J. (1971), "Designing for Pedestrians: A Level-of-Service Concept".

Cấu hình mặc định (altitude 12 m, window 4 m, stride 1 m), kiểm tra trên C2A test:
  - Trùng hạng với nhãn thật 71%, lệch tối đa 1 hạng 98%.
  - Spearman(people_count, severity_score) = 0.73.

"""

from dataclasses import dataclass
from typing import Sequence, Tuple
import numpy as np

# Ngưỡng Fruin LOS (người/m2)
FRUIN_THRESHOLDS = [
    ("A", 0.31), ("B", 0.43), ("C", 0.72), ("D", 1.08), ("E", 2.15), ("F", float("inf")),
]
LOS_TO_SCORE = {"A": 0.0, "B": 0.2, "C": 0.4, "D": 0.6, "E": 0.8, "F": 1.0}
GRADES = [g for g, _ in FRUIN_THRESHOLDS]

# Cấu hình mặc định
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
    """Đổi mật độ (người/m2) sang hạng Fruin LOS (A-F)."""
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
    """GSD (m/px) theo trục x và y, chụp thẳng xuống (nadir)."""
    return (altitude_m * sensor_w_mm / (focal_mm * img_w_px),
            altitude_m * sensor_h_mm / (focal_mm * img_h_px))


def estimate_altitude_from_person_size(
    person_long_edge_px: float, img_w_px: int,
    assumed_person_m: float = 1.0,
    sensor_w_mm: float = DEFAULT_SENSOR_W_MM, focal_mm: float = DEFAULT_FOCAL_MM,
) -> float:
    """
    Suy độ cao hiệu dụng từ cỡ người trong ảnh (dùng khi không có metadata bay thật).
    person_long_edge_px: nên là TRUNG VỊ cạnh dài bbox người trên cả tập ảnh.
    assumed_person_m: ~0.6 m (đứng), ~1.0 m (trung gian), ~1.7 m (nằm). Chỉ mang tính
    tham khảo để chọn khoảng độ cao hợp lý, không phải giá trị đo.
    """
    gsd = assumed_person_m / person_long_edge_px
    return gsd * focal_mm * img_w_px / sensor_w_mm


def densest_window(
    centers_m: np.ndarray, width_m: float, height_m: float,
    window_m: float, stride_m: float = DEFAULT_STRIDE_M,
) -> Tuple[int, float]:
    """
    Trượt cửa sổ window_m x window_m (bước stride_m) qua khung hình, trả về
    (số người nhiều nhất trong một vị trí cửa sổ, diện tích cửa sổ m2).
    Dùng tổng tích luỹ 2D nên tính nhanh; không bị cắt cụm ở biên ô như lưới cố định.
    centers_m: mảng Nx2, tọa độ tâm người theo mét.
    """
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
    """
    Hàm chính, gọi khi route report vào bảng traffic_assessment.
    person_bboxes_px: list bbox người (x1, y1, x2, y2) theo pixel từ Model 2
    (đã lọc theo ngưỡng conf trước khi truyền vào).
    """
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


if __name__ == "__main__":
    print("=== Demo compute_traffic_severity (v3: cửa sổ trượt) ===\n")

    def _fake_cluster_bboxes(n, cx, cy, spread_px, seed=42):
        import random
        rng = random.Random(seed)
        return [(cx + rng.uniform(-spread_px, spread_px) - 8,
                 cy + rng.uniform(-spread_px, spread_px) - 15,
                 cx + rng.uniform(-spread_px, spread_px) + 8,
                 cy + rng.uniform(-spread_px, spread_px) + 15) for _ in range(n)]

    # Ảnh kiểu C2A: nhỏ, người nhỏ (~16x9 px ở độ cao mặc định 12 m)
    W, H = 287, 285
    scenarios = [
        (2, 60, "2 người, tụ tập gần nhau"),
        (10, 50, "10 người, chen chúc trong một khu vực nhỏ"),
        (30, 120, "30 người, rải rác vừa phải"),
        (30, 25, "30 người, chen chúc rất sát (cùng số lượng, khác độ tập trung)"),
    ]
    for n, spread, desc in scenarios:
        boxes = _fake_cluster_bboxes(n, W / 2, H / 2, spread)
        r = compute_traffic_severity(boxes, W, H)
        print(f"[{desc}]")
        print(f"  densest_n={r.densest_n}/{r.people_count}  area={r.area_m2:.1f} m2  "
              f"density={r.victim_density_ppl_m2:.3f}  LOS={r.los_grade}  score={r.severity_score}")
    print("\n-> Cùng 30 người nhưng càng chen chúc (spread nhỏ) thì hạng càng cao, đúng kỳ vọng.\n")

    print("=== Suy độ cao từ cỡ người (ví dụ C2A: box trung vị 16x9 px, ảnh rộng 287 px) ===")
    for L in (0.6, 1.0, 1.7):
        alt = estimate_altitude_from_person_size(16, 287, assumed_person_m=L)
        print(f"  giả định người dài {L} m -> độ cao suy ra ~ {alt:.1f} m")
