import os
import sys
import tempfile
from pathlib import Path

# Set the environment before the server modules read it.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="skyrescue-test-")
os.environ.setdefault("ML_PRELOAD", "0")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
