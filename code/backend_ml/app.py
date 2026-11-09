"""
SkyRescue - Web API Server (FastAPI Backend)
Tích hợp toàn diện Pipeline AI 3 Tầng:
- Tầng 1: Phân loại sự cố (Model 1 EfficientNet-B0) & Phát hiện người/tư thế (Model 2 YOLOv8m)
- Tầng 2: Đánh giá mức độ nghiêm trọng (Severity Router: Collapsed / Fire / Traffic / Flood)
- Tầng 3: Xếp hạng ưu tiên cứu hộ đa tiêu chí (AHP / TOPSIS)
- Phục vụ Web tĩnh: Tự động mount giao diện từ sys_final
"""

import os
import sys
import shutil
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, File, UploadFile, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

# Thiết lập đường dẫn gốc cho các module nội bộ
ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Khởi tạo ứng dụng FastAPI
app = FastAPI(
    title="SkyRescue Decision Support System (DSS) API",
    description="Hệ thống hỗ trợ ra quyết định phân loại sự cố, đánh giá mức độ nghiêm trọng từ ảnh UAV và xếp hạng ưu tiên cứu hộ",
    version="2.0.0"
)

# Cấu hình CORS để giao diện web (HTML/JS) gọi API mượt mà không bị chặn
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy import các module AI khi khởi động hoặc khi nhận request
_router_available = False
_model2_available = False
_ahp_available = False

try:
    import severity_router
    _router_available = True
except Exception as e:
    print(f"[Warning] severity_router not loaded: {e}")

try:
    import model2_inference
    _model2_available = True
except Exception as e:
    print(f"[Warning] model2_inference not loaded: {e}")

try:
    import ahp_topsis
    _ahp_available = True
except Exception as e:
    print(f"[Warning] ahp_topsis not loaded: {e}")


# Model Pydantic cho endpoint AHP
class AHPRequest(BaseModel):
    severity_score: float
    distance_km: float
    free_teams_count: int


@app.get("/api/health")
def health_check():
    """Kiểm tra trạng thái máy chủ và các mô hình AI."""
    weights_status = {
        "aider_classifier.pth": (ROOT_DIR / "aider_classifier.pth").exists(),
        "best_fire_mobilenetv3_phase2.pth": (ROOT_DIR / "best_fire_mobilenetv3_phase2.pth").exists(),
        "collapsed_building_best_v2.pt": (ROOT_DIR / "collapsed_building_best_v2.pt").exists(),
        "best_vehicle.pt": (ROOT_DIR / "best_vehicle.pt").exists(),
        "v8m_up2_best.pt": (ROOT_DIR / "v8m_up2_best.pt").exists(),
    }
    return {
        "status": "online",
        "system": "SkyRescue DSS AI Backend",
        "modules": {
            "severity_router": _router_available,
            "model2_pose_detector": _model2_available,
            "ahp_topsis": _ahp_available,
        },
        "weights": weights_status
    }


@app.post("/api/predict")
async def predict_incident(
    file: UploadFile = File(...),
    run_pose: bool = Query(True, description="Chạy phát hiện người và tư thế nạn nhân (Model 2)")
):
    """
    Endpoint tiếp nhận ảnh báo cáo hiện trường từ Web / UAV:
    1. Chạy Model 1 (EfficientNet-B0) phân loại loại sự cố (Fire, Collapsed, Traffic, Flood, Normal).
    2. Chuyển tiếp vào Severity Router đánh giá mức độ nghiêm trọng (0-100).
    3. Chạy Model 2 (YOLOv8m) đếm nạn nhân và nhận diện tư thế (Upright, Lying, Sitting, v.v.).
    """
    if not _router_available:
        raise HTTPException(status_code=500, detail="Severity Router module is not available on server.")

    # Lưu file tạm để đưa vào pipeline inference
    suffix = Path(file.filename or "image.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = Path(tmp.name)
        shutil.copyfileobj(file.file, tmp)

    try:
        # 1. Chạy Severity Router (Model 1 -> Severity Wrapper)
        router_result = severity_router.route_severity(str(tmp_path), prediction_id=file.filename)
        
        # 2. Chạy Model 2 phát hiện người & tư thế nếu yêu cầu
        people_detections = []
        people_count = 0
        non_upright_count = 0

        if run_pose and _model2_available:
            try:
                raw_dets = model2_inference.detect_people(str(tmp_path))
                people_count = len(raw_dets)
                for d in raw_dets:
                    cls_name = d.get("cls", "Upright")
                    is_nu = cls_name.lower() in ["lying", "sitting", "bent", "kneeling", "other"]
                    if is_nu:
                        non_upright_count += 1
                    people_detections.append({
                        "box": [round(d["x1"], 1), round(d["y1"], 1), round(d["x2"], 1), round(d["y2"], 1)],
                        "confidence": round(d.get("conf", 0.0), 3),
                        "pose": cls_name,
                        "is_non_upright": is_nu
                    })
            except Exception as pe:
                print(f"[Warning] Model 2 inference failed: {pe}")

        # Chuẩn hóa dữ liệu trả về cho Web
        incident_type = router_result.get("incident_type", "Normal")
        assessment = router_result.get("assessment") or {}
        
        # Mức độ nghiêm trọng từ assessment (thang 0-1 quy về 0-100)
        raw_sev = assessment.get("severity_score", 0.0)
        severity_score_100 = round(float(raw_sev) * 100 if raw_sev <= 1.0 else float(raw_sev), 1)

        response_data = {
            "success": True,
            "filename": file.filename,
            "incident_type": incident_type,
            "is_normal": router_result.get("stopped", False) or incident_type == "Normal",
            "severity_score": severity_score_100,
            "severity_level": assessment.get("severity_level", "Low" if severity_score_100 < 40 else "Medium" if severity_score_100 < 75 else "High"),
            "confidence": round(router_result.get("classifier", {}).get("confidence", 0.0), 4),
            "needs_review": assessment.get("needs_review", False),
            "victim_analysis": {
                "detected_people_count": people_count,
                "non_upright_count": non_upright_count,
                "people_detections": people_detections
            },
            "raw_details": assessment.get("details", {})
        }
        return JSONResponse(content=response_data)

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")

    finally:
        # Xóa file tạm
        if tmp_path.exists():
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@app.post("/api/ahp-priority")
def calculate_ahp(req: AHPRequest):
    """Tính điểm ưu tiên AHP (Tầng 3) cho sự cố: P = 0.60 * S_sev + 0.25 * S_dist + 0.15 * S_team"""
    s_sev = max(0.0, min(1.0, req.severity_score / 100.0))
    s_dist = max(0.0, min(1.0, 1.0 - req.distance_km / 20.0))
    s_team = max(0.0, min(1.0, req.free_teams_count / 3.0))
    
    p_score = 0.60 * s_sev + 0.25 * s_dist + 0.15 * s_team
    return {
        "severity_component": round(s_sev, 4),
        "distance_component": round(s_dist, 4),
        "team_component": round(s_team, 4),
        "ahp_priority_score": round(p_score, 4)
    }


# Tự động mount giao diện Web từ folder sys_final nếu có
POSSIBLE_FRONTEND_PATHS = [
    Path(r"C:\Users\thaoa\Downloads\sys_final\system"),
    ROOT_DIR / "static",
    ROOT_DIR / "frontend",
    ROOT_DIR.parent / "sys_final" / "system",
]

frontend_path = None
for p in POSSIBLE_FRONTEND_PATHS:
    if p.exists() and (p / "dispatch.html").exists():
        frontend_path = p
        break

if frontend_path:
    print(f"[SkyRescue] Mounting Frontend Web from: {frontend_path}")
    # Phục vụ trang dispatch mặc định tại root nếu truy cập /
    @app.get("/")
    def serve_index():
        return FileResponse(frontend_path / "dispatch.html")

    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
else:
    @app.get("/")
    def welcome():
        return {
            "message": "SkyRescue AI API Server is running. Frontend static directory not mounted.",
            "docs": "/docs",
            "health": "/api/health"
        }


if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*60)
    print("🚀 Khởi động SkyRescue AI Web Server...")
    print("👉 Mở trình duyệt tại: http://localhost:8000")
    print("👉 Tài liệu API tương tác (Swagger): http://localhost:8000/docs")
    print("="*60 + "\n")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
