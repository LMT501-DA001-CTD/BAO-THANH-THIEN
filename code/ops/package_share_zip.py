#!/usr/bin/env python3
"""Build a clean zip of the SkyRescue no-Docker demo.

The zip contains a top-level folder (default: skyrescue-demo/) so the recipient can
extract it without scattering files. Demo state, virtual environments and caches are
excluded; the model weights and START_HERE.md are required.

Usage:
    python ops/package_share_zip.py
    python ops/package_share_zip.py --out /tmp/skyrescue-demo.zip
    python ops/package_share_zip.py --force
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TOP = "skyrescue-demo"

INCLUDE_FILES = [
    "START_HERE.md",
    "README.md",
    "HANDOFF.md",
    "requirements.txt",
    "Dockerfile",
    "docker-compose.yml",
    ".dockerignore",
]

INCLUDE_DIRS = [
    "ops",
    "server",
    "backend_ml",
    "web",
    "demo_samples",
    "tests",
    "docs",
]

# These names are never included, at any depth.
EXCLUDED_DIR_NAMES = {
    ".git",
    ".venv",
    "venv",
    "data",
    "logs",
    "dist",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    ".mypy_cache",
    ".ruff_cache",
    ".idea",
    ".vscode",
}
EXCLUDED_FILE_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".log", ".zip", ".rar", ".sqlite", ".db"}

REQUIRED_FILES = [
    "START_HERE.md",
    "requirements.txt",
    "ops/setup_windows.bat",
    "ops/run_windows.bat",
    "ops/skyrescue_launch.py",
    "server/main.py",
    "server/schema.sql",
    "server/relational.py",
    "server/seed_state.json",
    "web/index.html",
    "web/dispatch/index.html",
    "web/reporter/index.html",
    "docs/ARCHITECTURE_RECONCILIATION.md",
    "docs/AS_BUILT_RECONCILIATION.md",
    "demo_samples/manifest.json",
    "backend_ml/aider_classifier.pth",
    "backend_ml/v8m_up2_best.pt",
    "backend_ml/best_fire_mobilenetv3_phase2.pth",
    "backend_ml/collapsed_building_best_v2.pt",
    "backend_ml/best_vehicle.pt",
]

WEIGHTS = [
    "backend_ml/aider_classifier.pth",
    "backend_ml/v8m_up2_best.pt",
    "backend_ml/best_fire_mobilenetv3_phase2.pth",
    "backend_ml/collapsed_building_best_v2.pt",
    "backend_ml/best_vehicle.pt",
]


def is_excluded(path: Path) -> bool:
    if path.name in EXCLUDED_FILE_NAMES:
        return True
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    # Checkpoint backups such as ahp_topsis.py.bak-20261102-165043
    if ".bak" in path.name.lower():
        return True
    return False


def iter_files(root: Path, output: Path) -> list[Path]:
    files: dict[Path, None] = {}

    for name in INCLUDE_FILES:
        path = root / name
        if path.is_file():
            files[path] = None

    for name in INCLUDE_DIRS:
        base = root / name
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(root)
            if any(part in EXCLUDED_DIR_NAMES for part in rel.parts):
                continue
            if is_excluded(path):
                continue
            if path.resolve() == output:
                continue
            files[path] = None

    return sorted(files)


def check_required(root: Path) -> list[str]:
    missing = [name for name in REQUIRED_FILES if not (root / name).is_file()]
    if missing:
        return missing
    empty_weights = [name for name in WEIGHTS if (root / name).stat().st_size == 0]
    return [f"{name} (empty)" for name in empty_weights]


def manifest_warnings(root: Path) -> list[str]:
    warnings: list[str] = []
    manifest = root / "demo_samples" / "manifest.json"
    try:
        entries = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"demo_samples/manifest.json is not valid JSON: {exc}"]

    if not isinstance(entries, list) or not entries:
        return [
            "demo_samples/manifest.json is empty. The Reporter 'Use sample image' list will be empty."
        ]
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("file"):
            warnings.append(f"demo_samples/manifest.json entry has no file: {entry!r}")
            continue
        if not (root / "demo_samples" / entry["file"]).is_file():
            warnings.append(f"demo_samples/{entry['file']} is listed in the manifest but missing.")
    return warnings


def line_ending_warnings(root: Path) -> list[str]:
    warnings: list[str] = []
    for name in ("ops/setup_windows.bat", "ops/run_windows.bat", "ops/package_share_zip.bat"):
        path = root / name
        if path.is_file() and b"\r\n" not in path.read_bytes():
            warnings.append(f"{name} uses LF line endings; Windows .bat files should use CRLF.")
    return warnings


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def human_mb(size: int) -> str:
    return f"{size / (1024 * 1024):.1f} MB"


def build(root: Path, output: Path, top: str, force: bool) -> int:
    missing = check_required(root)
    if missing:
        print("ERROR: the share package is incomplete:", file=sys.stderr)
        for name in missing:
            print(f"  missing: {name}", file=sys.stderr)
        return 1

    if output.exists() and not force:
        print(f"ERROR: {output} already exists. Use --force to replace it.", file=sys.stderr)
        return 1
    if "/" in top or "\\" in top or not top.strip():
        print("ERROR: --top must be a simple folder name.", file=sys.stderr)
        return 1

    files = iter_files(root, output)
    if not files:
        print("ERROR: no files to package.", file=sys.stderr)
        return 1

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            rel = path.relative_to(root)
            arcname = f"{top}/{rel.as_posix()}"
            archive.write(path, arcname)

    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()

    unexpected = []
    for name in names:
        parts = Path(name).parts
        if not parts or parts[0] != top:
            unexpected.append(name)
        elif any(part in EXCLUDED_DIR_NAMES for part in parts[1:]):
            unexpected.append(name)
        elif is_excluded(Path(name)):
            unexpected.append(name)
    if unexpected:
        print("ERROR: the zip contains excluded paths:", file=sys.stderr)
        for name in unexpected[:20]:
            print(f"  {name}", file=sys.stderr)
        return 1

    warnings = manifest_warnings(root) + line_ending_warnings(root)
    if warnings:
        print("WARNINGS:")
        for warning in warnings:
            print(f"  - {warning}")
        print()

    print(f"Built: {output}")
    print(f"Top-level folder: {top}/")
    print(f"Files: {len(files)}")
    print(f"Size: {human_mb(output.stat().st_size)}")
    print(f"SHA-256: {sha256(output)}")
    print()
    print("Excluded: data/, logs/, .venv/, caches, node_modules/, proto_dispatch/, proto_reporter/")
    print("Next: extract the zip on a clean Windows machine and follow START_HERE.md.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a clean SkyRescue share zip.")
    parser.add_argument(
        "--out",
        type=Path,
        help="output zip path (default: dist/skyrescue-demo-YYYYMMDD.zip)",
    )
    parser.add_argument("--top", default=DEFAULT_TOP, help=f"top-level folder (default: {DEFAULT_TOP})")
    parser.add_argument("--force", action="store_true", help="replace an existing output file")
    args = parser.parse_args()

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    output = args.out or (ROOT / "dist" / f"{DEFAULT_TOP}-{today}.zip")
    if not output.is_absolute():
        output = (Path.cwd() / output).resolve()
    return build(ROOT, output, args.top.strip(), args.force)


if __name__ == "__main__":
    raise SystemExit(main())
