"""
SkyRescue - AHP/TOPSIS xếp hạng report (Người 5) - theo "Tầng 3" của doc gốc.

Mỗi report có đúng 1 Prediction (prediction.report_id UNIQUE) và 1 ảnh, nên tính theo
prediction_id cũng là tính theo ảnh. Mỗi dòng = 1 phương án trong TOPSIS.

3 tiêu chí:
  | tiêu chí        | lấy từ                                              | chiều                       |
  | severity_score  | wrapper severity của từng loại, [0, 1]              | càng cao càng ưu tiên       |
  | distance_to_nearest_team_km | GPS report -> trụ sở đội RẢNH gần nhất, đúng chuyên môn, phủ khu vực | càng LỚN càng ưu tiên |
  | free_teams      | số đội rảnh đúng chuyên môn có PHỦ khu vực của report | càng ÍT càng ưu tiên        |
  CẬP NHẬT 02/11 (theo ERD mới): mỗi đội có MỘT trụ sở với tọa độ riêng (team_lat, team_lng) và có thể phụ trách NHIỀU khu vực
  (bảng TeamCoverage: team_id, location_id). Khoảng cách tính haversine từ GPS report tới trụ sở đội. "Đội gần nhất" chỉ xét
  đội status = available, đúng chuyên môn VÀ có PHỦ khu vực (location_id) của report qua TeamCoverage (bản trước tính cả đội bận
  và bỏ qua khu vực). Không có đội nào thỏa -> nearest_team_id = NULL,
  khoảng cách = NaN, TOPSIS dùng khoảng cách LỚN NHẤT trong lô cho ca đó (khớp chiều "càng xa/thiếu đội càng ưu tiên"), ca đó bị gắn no_team_flag.
  Đầu ra có thêm nearest_team_id, free_teams và priority_computed_at để lưu vào bảng Prediction.
  CHIỀU CÁC TIÊU CHÍ (cập nhật 03/11, theo yêu cầu của nhóm): khoảng cách tới đội gần nhất càng LỚN càng ưu tiên
  (AHPConfig.distance_benefit = True) và free_teams càng ÍT càng ưu tiên (AHPConfig.free_teams_benefit = False). Hai cờ này đổi
  chiều từng tiêu chí; severity luôn là "càng cao càng ưu tiên". Hệ quả cần ghi vào báo cáo: report ở khu ít/không có đội rảnh
  và report xa đội được đẩy lên; ca không có đội nào (khoảng cách thay bằng giá trị lớn nhất trong lô, free_teams = 0) đạt giá trị
  tốt nhất ở cả hai tiêu chí này, và vẫn bị gắn no_team_flag để điều phối viên thấy.

TOPSIS chỉ đọc 4 khoá từ đầu ra router (wrapper severity): prediction_id, incident_type, severity_score, needs_review.
Hai tiêu chí còn lại tính từ bảng đội và TeamCoverage (cùng GPS và location_id của report, lấy từ bảng
Report), KHÔNG lấy từ wrapper. Điểm vào hệ thống: rank_router_outputs().

needs_review chỉ được đi kèm ra kết quả như một cờ riêng. Nó KHÔNG làm đổi điểm hay thứ hạng
TOPSIS, để QA tách được các ca không chắc chắn.

PHẠM VI XẾP HẠNG (cập nhật 22/10, mục 8.1 tài liệu GĐ2): mặc định scope="joint" xếp CHUNG mọi loại sự cố trong một lô
TOPSIS; scope="per_type" giữ cách cũ (xếp riêng từng loại). Lưu ý khi xếp chung: severity_score của các loại có thang khác
bản chất (vd Flood fail-safe = 1,0 với ảnh không đo được) nên không hoàn toàn so sánh được; dùng sensitivity_check() để xem
thứ hạng có ổn định không.

TRỌNG SỐ do AHP tính từ phán đoán so sánh cặp của nhóm, không phải số đo từ dữ liệu. Báo cáo phải
nói rõ như vậy. Điểm TOPSIS là tương đối trong lô các report đang xếp hạng.

Dữ liệu đội/GPS/khu vực dùng thử là GIẢ LẬP (simulate_*), không phải số thật.
"""
from dataclasses import dataclass
import numpy as np
import pandas as pd

WRAPPER_KEYS = ["prediction_id", "incident_type", "severity_score", "needs_review"]
DIST = "distance_to_nearest_team_km"
CRITERIA = ["severity_score", DIST, "free_teams"]
# Khoá là tên chuẩn của hệ thống (mục 6.2 tài liệu GĐ2): Fire, Flood, Collapsed, Traffic. So khớp không phân biệt hoa thường.
TEAM_TYPE = {"Flood": "water_rescue", "Fire": "fire", "Collapsed": "urban_sar", "Traffic": "traffic_rescue"}
STATUSES = {"available", "busy", "offline"}
SCOPES = ("joint", "per_type")             # joint = xếp chung mọi loại (mặc định), per_type = xếp riêng từng loại
LEVEL_CUTS = (0.25, 0.5, 0.75)             # ngưỡng mức nhẹ/vừa/nặng của Flood (flood_severity._level); loại khác cần xác nhận
EARTH_KM = 6371.0088


@dataclass
class AHPConfig:
    # Phán đoán so sánh cặp theo thang Saaty - GIẢ ĐỊNH CỦA NHÓM, cần cả nhóm chốt.
    k_severity_vs_distance: float = 3.0     # severity quan trọng gấp 3 lần khoảng cách
    k_severity_vs_freeteam: float = 5.0     # severity quan trọng gấp 5 lần số đội rảnh
    k_distance_vs_freeteam: float = 2.0     # khoảng cách quan trọng gấp 2 lần số đội rảnh
    free_teams_benefit: bool = False        # False (chốt 03/11): THIẾU đội rảnh -> ưu tiên
                                            # True: NHIỀU đội rảnh -> ưu tiên (chiều của bảng doc gốc)
    distance_benefit: bool = True           # True (chốt 03/11): khoảng cách tới đội gần nhất càng LỚN -> càng ưu tiên
                                            # False: càng GẦN -> càng ưu tiên


def _canon(name) -> str:
    """'flood' / 'FLOOD' / 'Flood' -> 'Flood'."""
    return str(name).strip().capitalize()


def ahp_weights(cfg: AHPConfig) -> tuple[np.ndarray, float]:
    k1, k2, k3 = cfg.k_severity_vs_distance, cfg.k_severity_vs_freeteam, cfg.k_distance_vs_freeteam
    M = np.array([[1, k1, k2], [1 / k1, 1, k3], [1 / k2, 1 / k3, 1]])
    n = M.shape[0]
    w = (M / M.sum(axis=0)).mean(axis=1)
    lam = (M @ w / w).mean()
    CI = (lam - n) / (n - 1)
    RI = {1: 0, 2: 0, 3: 0.58, 4: 0.90, 5: 1.12}[n]
    return w, (CI / RI if RI else 0.0)


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(a))


# --------------------------------------------------------------------------- #
# Khớp lược đồ DB (ERD) -> tên cột mà code dùng
# --------------------------------------------------------------------------- #

def normalize_teams(teams: pd.DataFrame) -> pd.DataFrame:
    """Đưa bảng rescue_team từ DB về lược đồ của code: team_id, team_type, team_lat, team_lng, status, capacity.
    Cột chuyên môn trong DB tên `specialty` (hoặc `team_type`); giá trị phải thuộc TEAM_TYPE.values().
    Mỗi đội có MỘT trụ sở (team_lat, team_lng). Khu vực đội phụ trách nằm ở bảng TeamCoverage (xem normalize_coverage).
    Thiếu cột thì báo lỗi rõ, không đoán."""
    t = teams.rename(columns={"specialty": "team_type"}) if "team_type" not in teams.columns else teams
    need = {"team_id", "team_type", "team_lat", "team_lng", "status", "capacity"}
    miss = need - set(t.columns)
    assert not miss, f"rescue_team thiếu cột {sorted(miss)} (cần team_id, specialty/team_type, team_lat, team_lng, status, capacity)"
    assert t.team_id.is_unique, "team_id trùng"
    assert (t.capacity >= 1).all(), "capacity phải >= 1"
    assert set(t.team_type) <= set(TEAM_TYPE.values()), f"chuyên môn lạ {set(t.team_type) - set(TEAM_TYPE.values())}"
    assert t[["team_lat", "team_lng"]].notna().all().all(), "có đội chưa có tọa độ trụ sở"
    assert t.team_lat.between(-90, 90).all() and t.team_lng.between(-180, 180).all(), "tọa độ trụ sở ngoài phạm vi"
    assert set(t.status) <= STATUSES, f"status lạ {set(t.status) - STATUSES}"
    return t[sorted(need)].reset_index(drop=True)


def normalize_coverage(coverage: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    """Bảng TeamCoverage (team_id, location_id): khu vực mỗi đội phụ trách. Một đội có thể phủ nhiều khu."""
    assert {"team_id", "location_id"} <= set(coverage.columns), "coverage thiếu cột team_id, location_id"
    c = coverage[["team_id", "location_id"]].drop_duplicates().reset_index(drop=True)
    assert set(c.team_id) <= set(teams.team_id), "coverage có team_id không có trong teams"
    return c


# --------------------------------------------------------------------------- #
# Dựng bảng tiêu chí: 4 khoá wrapper + 2 tiêu chí từ bảng đội
# --------------------------------------------------------------------------- #

def build_criteria_table(severity_results: list, reports_geo: pd.DataFrame, teams: pd.DataFrame,
                         coverage: pd.DataFrame, team_type_map: dict | None = None) -> pd.DataFrame:
    """severity_results: list dict wrapper (chỉ đọc 4 khoá WRAPPER_KEYS, các khoá khác bỏ qua).
    reports_geo: prediction_id, gps_lat, gps_lng, location_id   (từ bảng Report)
    teams:       team_id, specialty/team_type, team_lat, team_lng, status, capacity   (RescueTeam)
    coverage:    team_id, location_id                             (TeamCoverage)
    distance_to_nearest_team_km = haversine từ GPS report tới TRỤ SỞ của đội gần nhất trong các đội RẢNH (status = available),
                  đúng chuyên môn của loại sự cố VÀ có phủ location_id của report (qua TeamCoverage). Không có đội nào -> NaN
                  và nearest_team_id = <NA>. Vì cùng điều kiện với free_teams nên free_teams = 0 <=> không có đội gần nhất.
    free_teams  = số đội rảnh đúng chuyên môn có PHỦ location_id của report (qua TeamCoverage), mỗi đội đếm một lần.
    Thiếu dữ liệu ở bảng report/severity thì báo lỗi, không âm thầm bỏ report. Không có đội thì KHÔNG báo lỗi (xem docstring đầu file)."""
    tmap = {_canon(k): v for k, v in (team_type_map or TEAM_TYPE).items()}
    rows = []
    for r in severity_results:
        miss = [k for k in WRAPPER_KEYS if r.get(k) is None]
        assert not miss, f"wrapper thiếu {miss} (prediction_id do router/DB cấp khi lưu Prediction)"
        rows.append({k: r[k] for k in WRAPPER_KEYS})
    res = pd.DataFrame(rows)
    res["incident_type"] = res.incident_type.map(_canon)      # wrapper trả tên chuẩn viết hoa đầu, vd "Flood"
    assert res.prediction_id.is_unique, "prediction_id trùng - mỗi report đúng 1 dòng"
    bad = set(res.incident_type) - set(tmap)
    assert not bad, f"incident_type lạ {bad}, chỉ có {sorted(tmap)}"
    assert res.severity_score.between(0, 1).all(), "severity_score ngoài [0,1] - nhờ Người 3 chuẩn hoá"
    res["needs_review"] = res.needs_review.astype(bool)

    need_geo = {"prediction_id", "gps_lat", "gps_lng", "location_id"}
    assert need_geo <= set(reports_geo.columns), f"reports_geo thiếu cột {need_geo - set(reports_geo.columns)}"
    assert reports_geo.prediction_id.is_unique, "reports_geo có prediction_id trùng"
    geo = reports_geo[sorted(need_geo)]
    assert geo.notna().all().all(), "reports_geo có giá trị trống"
    assert geo.gps_lat.between(-90, 90).all() and geo.gps_lng.between(-180, 180).all(), "GPS ngoài phạm vi"
    absent = set(res.prediction_id) - set(geo.prediction_id)
    assert not absent, f"{len(absent)} report không có GPS/location_id, ví dụ {sorted(absent)[:3]}"
    out = res.merge(geo, on="prediction_id", how="left")

    teams = normalize_teams(teams)
    cov = normalize_coverage(coverage, teams)

    out[DIST] = np.nan
    out["nearest_team_id"] = pd.array([pd.NA] * len(out), dtype="Int64")
    out["free_teams"] = 0
    for itype, idx in out.groupby("incident_type").groups.items():
        cand = teams[(teams.team_type == tmap[itype]) & (teams.status == "available")].reset_index(drop=True)
        if cand.empty:                                        # không có đội rảnh đúng chuyên môn: để NaN/<NA>, free_teams = 0
            continue
        d = haversine_km(out.loc[idx, "gps_lat"].to_numpy()[:, None], out.loc[idx, "gps_lng"].to_numpy()[:, None],
                         cand.team_lat.to_numpy()[None, :], cand.team_lng.to_numpy()[None, :])
        # Chỉ giữ đội PHỦ khu vực của report: mask[i, k] = True nếu đội cand[k] phủ location_id của report i.
        locs = out.loc[idx, "location_id"].to_numpy()
        pos = {int(t): k for k, t in enumerate(cand.team_id)}
        mask = np.zeros(d.shape, dtype=bool)
        for loc, g in cov[cov.team_id.isin(cand.team_id)].groupby("location_id"):
            mask[np.ix_(locs == loc, [pos[int(t)] for t in g.team_id])] = True
        d = np.where(mask, d, np.inf)
        j = d.argmin(axis=1)
        ok = np.isfinite(d[np.arange(len(j)), j])             # False: khu của report không có đội rảnh đúng chuyên môn phủ tới
        if ok.any():
            out.loc[idx[ok], DIST] = d[np.arange(len(j)), j][ok]
            out.loc[idx[ok], "nearest_team_id"] = pd.array(cand.team_id.to_numpy()[j][ok], dtype="Int64")
        free = cov[cov.team_id.isin(cand.team_id)].groupby("location_id").team_id.nunique()
        out.loc[idx, "free_teams"] = out.loc[idx, "location_id"].map(free).fillna(0).astype(int).to_numpy()
    return out[["prediction_id", "incident_type", "severity_score", "needs_review",
                "location_id", "nearest_team_id", DIST, "free_teams"]]


# --------------------------------------------------------------------------- #
# TOPSIS
# --------------------------------------------------------------------------- #

def _topsis(X: np.ndarray, w: np.ndarray, benefit: np.ndarray) -> np.ndarray:
    norm = np.sqrt((X ** 2).sum(axis=0))
    norm[norm == 0] = 1                       # cả cột toàn 0 -> không chia 0
    V = (X / norm) * w
    best = np.where(benefit, V.max(0), V.min(0))
    worst = np.where(benefit, V.min(0), V.max(0))
    d_best = np.sqrt(((V - best) ** 2).sum(1))
    d_worst = np.sqrt(((V - worst) ** 2).sum(1))
    den = d_best + d_worst
    return np.where(den == 0, 0.5, d_worst / np.where(den == 0, 1, den))


def rank_priority(table: pd.DataFrame, cfg: AHPConfig, scope: str = "joint",
                  tiebreak: pd.Series | None = None, computed_at=None) -> pd.DataFrame:
    """Xếp hạng TOPSIS. scope="joint": một lô chung cho mọi loại sự cố (mặc định, mục 8.1); "per_type": mỗi loại một lô.
    tiebreak (tuỳ chọn): Series theo prediction_id, vd số người trong ảnh (details["n_person"], lấy riêng, KHÔNG đọc từ
    wrapper trong TOPSIS). CHỈ dùng khi priority_score bằng nhau hoàn toàn, không đưa vào điểm; lúc đó nhiều người hơn xếp trước
    và hạng khác nhau. Không truyền thì các dòng hoà điểm chung một hạng. Hạng tính trong phạm vi của scope.
    Khoảng cách NaN (không có đội rảnh, đúng chuyên môn, phủ khu vực) được thay bằng khoảng cách LỚN NHẤT trong lô (hoặc trong nhóm nếu
    scope="per_type"; 0 nếu cả nhóm không có đội nào) CHỈ khi tính TOPSIS; cột khoảng cách trong kết quả giữ NaN để lưu NULL.
    computed_at: mốc thời gian ghi vào priority_computed_at (mặc định: bây giờ, UTC)."""
    assert scope in SCOPES, f"scope phải là một trong {SCOPES}"
    need = [*WRAPPER_KEYS, DIST, "free_teams"]
    miss = [c for c in need if c not in table.columns]
    assert not miss, f"Thiếu cột {miss} - tạo bảng bằng build_criteria_table()"
    assert table.prediction_id.is_unique, "prediction_id trùng - mỗi report đúng 1 dòng"
    for c in CRITERIA:
        ok = table[c].notna() if c != DIST else pd.Series(True, index=table.index)   # cột khoảng cách được phép NaN (không có đội)
        assert ok.all() and (table[c].dropna() >= 0).all(), f"Cột {c} có NaN hoặc giá trị âm"
    assert table.severity_score.between(0, 1).all(), "severity_score ngoài [0,1]"

    w, cr = ahp_weights(cfg)
    assert cr < 0.1, f"CR = {cr:.3f} >= 0.1: ma trận so sánh cặp không nhất quán, nhóm cần chốt lại phán đoán"
    benefit = np.array([True, cfg.distance_benefit, cfg.free_teams_benefit])
    groups = [table] if scope == "joint" else [g for _, g in table.groupby("incident_type")]
    computed_at = pd.Timestamp.now(tz="UTC") if computed_at is None else pd.Timestamp(computed_at)
    chunks = []
    for sub in groups:
        sub = sub.copy()
        # needs_review KHÔNG nằm trong X: điểm và hạng không phụ thuộc cờ này.
        X = sub[CRITERIA].astype(float)
        dmax = X[DIST].max()                                  # NaN nếu cả nhóm không có đội
        X[DIST] = X[DIST].fillna(0.0 if pd.isna(dmax) else dmax)
        sub["priority_score"] = _topsis(X.to_numpy(), w, benefit)
        sub["priority_computed_at"] = computed_at
        sub["_tb"] = 0 if tiebreak is None else sub.prediction_id.map(tiebreak).fillna(0).to_numpy()
        sub = sub.sort_values(["priority_score", "_tb", "prediction_id"],
                              ascending=[False, False, True], kind="stable")
        # Hạng tính theo cặp (priority_score, tiebreak) sau khi đã sắp: hai dòng chỉ hoà khi cả hai giá trị bằng nhau.
        # Không có tiebreak thì tương đương rank(method="min") trên priority_score.
        sc, tb = sub.priority_score.to_numpy(), sub["_tb"].to_numpy()
        new = np.r_[True, (sc[1:] != sc[:-1]) | (tb[1:] != tb[:-1])]
        sub["priority_rank"] = np.maximum.accumulate(np.where(new, np.arange(1, len(sub) + 1), 0))
        chunks.append(sub.drop(columns="_tb"))
    out = pd.concat(chunks)
    out.attrs.update(ahp_weights={k: round(float(v), 3) for k, v in zip(CRITERIA, w)}, ahp_cr=round(float(cr), 3),
                     free_teams_benefit=cfg.free_teams_benefit, distance_benefit=cfg.distance_benefit, scope=scope)
    return out


def rank_within_type(table, cfg, tiebreak=None):
    """Tương thích bản cũ: xếp riêng từng loại sự cố."""
    return rank_priority(table, cfg, scope="per_type", tiebreak=tiebreak)


def assign_teams(ranked: pd.DataFrame, teams: pd.DataFrame, coverage: pd.DataFrame,
                 team_type_map: dict | None = None) -> pd.DataFrame:
    """Ghép đội SAU khi xếp hạng, theo thứ tự ưu tiên: đội PHỦ khu vực của report (TeamCoverage), đúng chuyên môn, rảnh, còn chỗ trống.
    Không ảnh hưởng thứ hạng - report không ghép được đội chỉ bị gắn no_team_flag.
    Đội chuyên biệt theo loại nên thứ tự giữa các loại không ảnh hưởng kết quả ghép; dùng được cho cả hai scope."""
    tmap = {_canon(k): v for k, v in (team_type_map or TEAM_TYPE).items()}
    load = {int(t): 0 for t in teams.team_id}
    covers = coverage.groupby("location_id").team_id.apply(set).to_dict()
    picked = {}
    for r in ranked.sort_values(["priority_rank", "incident_type", "prediction_id"]).itertuples():
        cand = teams[teams.team_id.isin(covers.get(r.location_id, set())) & (teams.team_type == tmap[_canon(r.incident_type)])
                     & (teams.status == "available")]
        cand = cand[[load[int(t)] < c for t, c in zip(cand.team_id, cand.capacity)]]
        if cand.empty:
            continue
        pick = int(min(cand.team_id, key=lambda t: (load[int(t)], t)))
        load[pick] += 1
        picked[r.Index] = pick
    out = ranked.copy()
    out["assigned_team_id"] = pd.array([picked.get(i) for i in out.index], dtype="Int64")
    out["no_team_flag"] = out.assigned_team_id.isna()          # gồm cả ca không có đội gần nhất (nearest_team_id <NA>)
    return out


# --------------------------------------------------------------------------- #
# Nối vào đầu ra router: danh sách dict wrapper (mọi loại) -> bảng xếp hạng + ghép đội
# --------------------------------------------------------------------------- #

def unwrap_router_output(item: dict) -> dict | None:
    """Nhận 1 phần tử đầu ra của severity_router (dạng {prediction_id, incident_type, stopped, classifier, assessment}) HOẶC
    1 dict wrapper trần. Trả dict wrapper (assessment) để vào TOPSIS; ca dừng (Normal, stopped=True / assessment=None) trả None.
    Nếu assessment thiếu prediction_id thì lấy từ cấp ngoài. prediction_id có thể là chuỗi ("R01") hoặc số."""
    if "assessment" in item or "stopped" in item:
        a = item.get("assessment")
        if item.get("stopped") or a is None:
            return None
        a = dict(a)
        a.setdefault("prediction_id", item.get("prediction_id"))
        return a
    return item


def tiebreak_from_results(severity_results: list) -> pd.Series:
    """Series prediction_id -> details["n_person"], dùng làm tie-break tuỳ chọn. Wrapper không có n_person (Fire, Collapsed,
    Traffic hiện không ghi khoá này) thì coi là 0. Chỉ dùng cho thứ tự khi hoà điểm tuyệt đối, KHÔNG đi vào TOPSIS."""
    return pd.Series({r["prediction_id"]: (r.get("details") or {}).get("n_person", 0) for r in severity_results
                      if r.get("prediction_id") is not None}, dtype="float")


def rank_router_outputs(severity_results: list, reports_geo: pd.DataFrame, teams: pd.DataFrame,
                        coverage: pd.DataFrame, cfg: AHPConfig | None = None, scope: str = "joint",
                        use_tiebreak: bool = False, team_type_map: dict | None = None,
                        computed_at=None) -> pd.DataFrame:
    """Điểm vào cho router/E2E. severity_results = danh sách đầu ra của severity_router (có lồng `assessment`; ca Normal/stopped bị bỏ qua
    và liệt kê trong out.attrs["skipped_not_incident"]) hoặc danh sách dict wrapper trần (Flood/Fire/Collapsed/Traffic),
    chỉ 4 khoá prediction_id, incident_type, severity_score, needs_review được đọc cho TOPSIS.
    teams lấy thẳng từ DB (cột specialty, team_lat, team_lng...): đi qua normalize_teams(). coverage = bảng TeamCoverage.
    use_tiebreak=True: dùng details["n_person"] để phá thế đồng hạng (tuỳ chọn, mặc định tắt).
    Trả bảng đã xếp hạng + nearest_team_id, distance_to_nearest_team_km, free_teams, priority_score, priority_computed_at
    + assigned_team_id + no_team_flag (các cột đầu khớp các cột dẫn xuất của bảng Prediction)."""
    cfg = cfg or AHPConfig()
    teams = normalize_teams(teams)
    unwrapped = [(it, unwrap_router_output(it)) for it in severity_results]
    skipped = [it.get("prediction_id") for it, u in unwrapped if u is None]
    severity_results = [u for _, u in unwrapped if u is not None]
    assert severity_results, "không có report nào có assessment (tất cả bị dừng/Normal)"
    table = build_criteria_table(severity_results, reports_geo, teams, coverage, team_type_map)
    tb = tiebreak_from_results(severity_results) if use_tiebreak else None
    ranked = rank_priority(table, cfg, scope=scope, tiebreak=tb, computed_at=computed_at)
    out = assign_teams(ranked, teams, normalize_coverage(coverage, teams), team_type_map)
    out.attrs.update(ranked.attrs, skipped_not_incident=skipped)
    return out


# --------------------------------------------------------------------------- #
# Kiểm tra độ nhạy
# --------------------------------------------------------------------------- #

def level_map(score, cuts=LEVEL_CUTS) -> np.ndarray:
    """Ánh xạ severity_score liên tục -> điểm giữa của mức (4 mức: cắt tại cuts). Điểm 1,0 (fail-safe / ngập tối đa) giữ nguyên
    1,0 để ca gắn cờ không tụt xuống mức 'nặng' thường."""
    s = np.asarray(score, dtype=float)
    mids = [cuts[0] / 2, (cuts[0] + cuts[1]) / 2, (cuts[1] + cuts[2]) / 2, (cuts[2] + 1) / 2]
    return np.select([s >= 1 - 1e-9, s < cuts[0], s < cuts[1], s < cuts[2]], [1.0, *mids[:3]], mids[3])


def _compare(base: pd.Series, alt: pd.Series, k: int) -> dict:
    rb, ra = base.rank(ascending=False, method="average"), alt.reindex(base.index).rank(ascending=False, method="average")
    top = lambda r: set(r.sort_values(kind="stable").index[:k])
    return dict(spearman=float(rb.corr(ra)), top_k_overlap=len(top(rb) & top(ra)) / k,
                mean_abs_rank_shift=float((rb - ra).abs().mean()), max_abs_rank_shift=float((rb - ra).abs().max()))


def sensitivity_check(table: pd.DataFrame, cfg: AHPConfig | None = None, scope: str = "joint",
                      top_frac: float = 0.2, cuts=LEVEL_CUTS) -> pd.DataFrame:
    """So thứ hạng gốc với các kịch bản thay đổi. Mỗi dòng: spearman (1 = giống hệt), top_k_overlap (tỉ lệ trùng top top_frac),
    độ lệch hạng trung bình/lớn nhất. Kịch bản:
      - severity theo mức: severity_score thay bằng điểm giữa mức nhẹ/vừa/nặng (level_map)
      - đảo chiều free_teams; đảo chiều khoảng cách
      - trọng số khác (severity 2x distance & 3x free_teams; distance = free_teams)
    Trọng số kịch bản cũng là phán đoán, không phải số đo."""
    cfg = cfg or AHPConfig()
    k = max(1, int(round(top_frac * len(table))))
    score = lambda t, c: rank_priority(t, c, scope).set_index("prediction_id").priority_score
    base = score(table, cfg)
    t2 = table.copy()
    t2["severity_score"] = level_map(t2.severity_score, cuts)
    scen = {
        "severity theo mức (nhẹ/vừa/nặng)": score(t2, cfg),
        "đảo chiều free_teams": score(table, AHPConfig(**{**cfg.__dict__, "free_teams_benefit": not cfg.free_teams_benefit})),
        "đảo chiều khoảng cách": score(table, AHPConfig(**{**cfg.__dict__, "distance_benefit": not cfg.distance_benefit})),
        "trọng số severity 2x distance, 3x free_teams": score(table, AHPConfig(2.0, 3.0, 1.5, cfg.free_teams_benefit, cfg.distance_benefit)),
        "trọng số distance = free_teams": score(table, AHPConfig(3.0, 3.0, 1.0, cfg.free_teams_benefit, cfg.distance_benefit)),
    }
    return pd.DataFrame([dict(scenario=n, **_compare(base, alt, k)) for n, alt in scen.items()]).round(3)


# --------------------------------------------------------------------------- #
# Dữ liệu GIẢ LẬP để thử (không phải dữ liệu thật)
# --------------------------------------------------------------------------- #

def simulate_locations(n_loc: int = 8, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    return pd.DataFrame({"location_id": np.arange(1, n_loc + 1),
                         "center_lat": 10.70 + rng.uniform(0, 0.20, n_loc),
                         "center_lng": 106.60 + rng.uniform(0, 0.20, n_loc)})


def simulate_teams(locations: pd.DataFrame, per_type: int = 3, capacity: int = 3, p_busy: float = 0.2,
                   p_offline: float = 0.1, gap_frac: float = 0.15, p_extra_area: float = 0.3,
                   seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Trả (teams, coverage). Mỗi khu có per_type đội cho MỌI chuyên môn; trụ sở đặt gần tâm khu "gốc" của đội (nhiễu ~1 km);
    với xác suất p_extra_area đội còn phủ thêm một khu khác. gap_frac: tỉ lệ cặp (khu gốc, chuyên môn) cố ý không có đội rảnh,
    để free_teams có biến thiên và vẫn thấy ca no_team_flag. Các cặp còn lại luôn có ít nhất 1 đội rảnh."""
    rng = np.random.default_rng(seed)
    loc_ids = locations.location_id.to_numpy()
    cen = locations.set_index("location_id")
    rows, cov = [], []
    for loc in loc_ids:
        for tt in sorted(set(TEAM_TYPE.values())):
            st = rng.choice(["available", "busy", "offline"], size=per_type, p=[1 - p_busy - p_offline, p_busy, p_offline])
            if rng.random() < gap_frac:
                st = np.where(st == "available", "busy", st)
            elif "available" not in st:
                st[0] = "available"
            for x in st:
                tid = len(rows) + 1
                rows.append(dict(team_id=tid, team_type=tt, team_lat=float(cen.loc[loc, "center_lat"] + rng.normal(0, 0.008)),
                                 team_lng=float(cen.loc[loc, "center_lng"] + rng.normal(0, 0.008)), status=x, capacity=capacity))
                cov.append(dict(team_id=tid, location_id=int(loc)))
                if rng.random() < p_extra_area:
                    cov.append(dict(team_id=tid, location_id=int(rng.choice(loc_ids[loc_ids != loc]))))
    t = pd.DataFrame(rows)
    assert all(((t.team_type == tt) & (t.status == "available")).any() for tt in set(TEAM_TYPE.values())), \
        "mô phỏng ra loại đội không có đội rảnh nào - đổi seed"
    return t, pd.DataFrame(cov)


def simulate_reports(locations: pd.DataFrame, n: int = 40, flagged_frac: float = 0.8, seed: int = 0) -> tuple[list, pd.DataFrame]:
    """Trả (severity_results, reports_geo). severity_results có dạng đầu ra wrapper (có cả khoá thừa như severity_level,
    details để thử việc TOPSIS bỏ qua các khoá đó). flagged_frac = tỉ lệ ảnh Flood không đo được (thật: 83,5%) -> severity 1,0 + needs_review (như fail-safe thật)."""
    rng = np.random.default_rng(seed)
    types = rng.choice(sorted(TEAM_TYPE), size=n)
    loc = rng.choice(locations.location_id.to_numpy(), size=n)
    c = locations.set_index("location_id").loc[loc]
    geo = pd.DataFrame({"prediction_id": np.arange(1, n + 1), "location_id": loc,
                        "gps_lat": c.center_lat.to_numpy() + rng.normal(0, 0.01, n),
                        "gps_lng": c.center_lng.to_numpy() + rng.normal(0, 0.01, n)})
    res = []
    for i, tp in enumerate(types):
        flag = bool(tp == "Flood" and rng.random() < flagged_frac)   # Flood không đo được -> fail-safe
        sev = 1.0 if flag else float(rng.beta(2, 3))
        res.append(dict(prediction_id=i + 1, incident_type=tp, severity_score=sev, needs_review=flag,
                        severity_level="Cần xem lại" if flag else "-", confidence=None,
                        details=dict(n_person=int(rng.integers(0, 12)))))
    return res, geo


if __name__ == "__main__":
    w, cr = ahp_weights(AHPConfig())
    print("Trọng số", {k: round(float(v), 3) for k, v in zip(CRITERIA, w)}, "| CR:", round(cr, 3),
          "| đạt (<0.1):", cr < 0.1, "| distance_benefit mặc định:", AHPConfig().distance_benefit,
          "| free_teams_benefit mặc định:", AHPConfig().free_teams_benefit)
    locs = simulate_locations(8, seed=1)
    teams, cov = simulate_teams(locs, seed=1)
    results, geo = simulate_reports(locs, 40, seed=1)
    out = rank_router_outputs(results, geo, teams, cov, scope="joint")
    print(f"\n[GIẢ LẬP] {len(teams)} đội ({len(cov)} cặp đội-khu phủ), {len(out)} report, scope=joint: "
          f"{int(out.no_team_flag.sum())}/{len(out)} report không có đội (no_team_flag), "
          f"{int(out.needs_review.sum())} ca needs_review, {int(out.nearest_team_id.isna().sum())} ca không có đội gần nhất")
    print(out[["prediction_id", "incident_type", "severity_score", "needs_review", "nearest_team_id", DIST, "free_teams",
               "priority_score", "priority_rank", "assigned_team_id"]].head(10).round(3).to_string(index=False))
    print("\nĐộ nhạy:\n", sensitivity_check(build_criteria_table(results, geo, teams, cov)).to_string(index=False))
