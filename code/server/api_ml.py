"""ML endpoints: model health and one-image prediction (Dispatch Admin only)."""
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from . import auth, config, ml_service

router = APIRouter()
MAGIC = {b"\xff\xd8\xff": ".jpg", b"\x89PNG\r\n\x1a\n": ".png"}


def image_suffix(head):
    """Return the file suffix for JPEG or PNG bytes, else None. Do not trust the client MIME type."""
    return next((suffix for magic, suffix in MAGIC.items() if head.startswith(magic)), None)


@router.get("/api/health")
def health():
    return {"status": "ok", "demoMode": config.DEMO_MODE, "ml": ml_service.health()}


@router.post("/api/ml/predict")
async def predict(request: Request, image: UploadFile = File(...), prediction_id: str = Form(None)):
    auth.require_user(request, portal="dispatch")
    data = await image.read(int(config.MAX_UPLOAD_MB * 1024 * 1024) + 1)
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Image is larger than {config.MAX_UPLOAD_MB:g} MB")
    suffix = image_suffix(data[:8])
    if not suffix:
        raise HTTPException(415, "Only JPEG or PNG images are accepted")
    tmp_dir = config.DATA_DIR / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    path = tmp_dir / f"{uuid.uuid4().hex}{suffix}"
    path.write_bytes(data)
    try:
        return await ml_service.predict(path, prediction_id or f"PRED-{uuid.uuid4().hex[:8]}")
    finally:
        path.unlink(missing_ok=True)
