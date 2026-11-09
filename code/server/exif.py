"""Read Layer 1 metadata (GPS, capture time, camera) from image bytes. Do not trust client values."""
import io
from datetime import datetime, timedelta, timezone

from PIL import Image

GPS_IFD, EXIF_IFD = 0x8825, 0x8769
MAKE, MODEL = 271, 272
DATETIME_ORIGINAL, OFFSET_TIME_ORIGINAL, BODY_SERIAL = 36867, 36881, 42033


def _degrees(dms, ref):
    try:
        d, m, s = (float(v) for v in dms)
    except (TypeError, ValueError):
        return None
    value = d + m / 60 + s / 3600
    return -value if str(ref).upper() in ("S", "W") else value


def _capture_time(raw, offset, fallback_offset_min):
    """EXIF time has no zone unless OffsetTimeOriginal exists. Then use the browser offset."""
    try:
        naive = datetime.strptime(str(raw).strip("\x00 "), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    if offset:
        try:
            sign = -1 if str(offset).startswith("-") else 1
            hours, minutes = str(offset).lstrip("+-").split(":")
            zone = timezone(sign * timedelta(hours=int(hours), minutes=int(minutes)))
            return naive.replace(tzinfo=zone).astimezone(timezone.utc)
        except ValueError:
            pass
    # JavaScript getTimezoneOffset() is UTC minus local time, in minutes.
    return (naive + timedelta(minutes=fallback_offset_min)).replace(tzinfo=timezone.utc)


def read_metadata(data, tz_offset_min=0):
    """Return a dict with latitude, longitude, captureTime (ISO UTC), cameraMake, cameraModel, uavSerialNumber.
    A missing value is None. Return None if the bytes are not an image that Pillow can open."""
    try:
        image = Image.open(io.BytesIO(data))
        image.verify()
        image = Image.open(io.BytesIO(data))
        image.load()  # force a real pixel decode, not just a header check
    except Exception:
        return None
    exif = image.getexif()
    gps = exif.get_ifd(GPS_IFD) if exif else {}
    sub = exif.get_ifd(EXIF_IFD) if exif else {}
    lat = _degrees(gps.get(2), gps.get(1)) if gps.get(2) else None
    lng = _degrees(gps.get(4), gps.get(3)) if gps.get(4) else None
    taken = _capture_time(sub.get(DATETIME_ORIGINAL), sub.get(OFFSET_TIME_ORIGINAL), tz_offset_min) if sub.get(DATETIME_ORIGINAL) else None
    text = lambda v: str(v).strip("\x00 ") if v else None  # noqa: E731
    return {
        "latitude": round(lat, 6) if lat is not None else None,
        "longitude": round(lng, 6) if lng is not None else None,
        "captureTime": taken.isoformat().replace("+00:00", "Z") if taken else None,
        "cameraMake": text(exif.get(MAKE)),
        "cameraModel": text(exif.get(MODEL)),
        "uavSerialNumber": text(sub.get(BODY_SERIAL)),
        "width": image.width,
        "height": image.height,
    }
