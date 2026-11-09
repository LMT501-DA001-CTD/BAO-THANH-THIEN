"""Runtime settings. All values come from environment variables."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
ML_DIR = Path(os.getenv("ML_DIR", ROOT / "backend_ml")).resolve()
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data")).resolve()
DB_PATH = DATA_DIR / "skyrescue.db"
MEDIA_DIR = DATA_DIR / "media"
# `relational` uses the 15-table target model; `json` is the legacy fallback demo.
DATA_BACKEND = os.getenv("DATA_BACKEND", "relational").strip().lower()
SAMPLES_DIR = Path(os.getenv("SAMPLES_DIR", ROOT / "demo_samples")).resolve()

# Set ML_PRELOAD=0 to start the server without the models (fast API tests).
ML_PRELOAD = os.getenv("ML_PRELOAD", "1") == "1"
ML_TIMEOUT_S = float(os.getenv("ML_TIMEOUT_S", "60"))
MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "35"))
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
# Set COOKIE_SECURE=1 when all traffic uses HTTPS.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"

# The ML wrappers read these at import time. Point them at backend_ml/ (PROMPT §5.3).
ML_ENV_DEFAULTS = {
    "MODEL1_PATH": ML_DIR / "aider_classifier.pth",
    "MODEL2_PATH": ML_DIR / "v8m_up2_best.pt",
    "FIRE_MODEL_PATH": ML_DIR / "best_fire_mobilenetv3_phase2.pth",
    "COLLAPSED_MODEL_PATH": ML_DIR / "collapsed_building_best_v2.pt",
    "SKYRESCUE_FLOOD_CALIB_DIR": ML_DIR,
}
for _key, _value in ML_ENV_DEFAULTS.items():
    os.environ.setdefault(_key, str(_value))
