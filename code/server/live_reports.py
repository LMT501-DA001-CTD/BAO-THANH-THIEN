"""Server-owned fields of live uploads. Clients cannot change evidence, metadata or AI results."""
from . import db

LIVE, SEEDED = "Live upload", "Seeded sample"


def media_url(upload):
    return f"/media/{upload['media']}"


def ai_source_label(ai):
    if not ai:
        return None
    if ai.get("status") == "failed":
        return f"Live ML inference failed · {ai.get('error', 'unknown error')}"
    models = ai.get("models") or {}
    return f"Live ML inference · {models.get('m1')} + {models.get('m2')} · {ai.get('latencyMs')} ms"


def live_upload(report, uploads):
    """Return the upload of a live report, or None. The token must be bound to this report id."""
    upload = uploads.get(report.get("uploadToken"))
    return upload if upload and upload["report_id"] == report.get("id") else None


def overlay(state, uploads=None, jobs=None):
    """Write the server values into the reports and incidents of live uploads. Label all other uploads as seeded."""
    uploads = db.bound_uploads() if uploads is None else uploads
    jobs = db.jobs() if jobs is None else jobs
    live_by_report = {}
    for report in state.get("reports") or []:
        upload = live_upload(report, uploads)
        if upload:
            live_by_report[report["id"]] = upload
            status, ai = jobs.get(upload["token"], ("Queued", None))
            report.update(
                metadata=upload["metadata"], metadataSource=upload["metadata_source"], fingerprint=upload["fingerprint"],
                image=media_url(upload), uploadStatus="Uploaded", dataOrigin=LIVE,
                processingStatus=status, aiResult=ai, aiResultSource=ai_source_label(ai),
            )
        else:
            report.pop("uploadToken", None)  # a token that is not bound to this report has no use
            if report.get("uploadStatus") == "Uploaded":
                report["dataOrigin"] = SEEDED
    for incident in state.get("incidents") or []:
        upload = live_by_report.get(incident.get("reportId"))
        if upload:
            incident.update(image=media_url(upload), dataOrigin=LIVE, metadataSource=upload["metadata_source"])
        else:
            incident.setdefault("dataOrigin", SEEDED)


def make_enforcer(user):
    """Return (enforce, started). enforce() binds new upload tokens of this user. started lists the new tokens."""
    started = []

    def enforce(state):
        uploads, jobs = db.bound_uploads(), db.jobs()
        for report in state.get("reports") or []:
            token = report.get("uploadToken")
            if not token or token in uploads:
                continue
            upload = db.upload_by_token(token)
            if upload and upload["user_id"] == user["id"] and db.bind_upload(token, report["id"]):
                upload["report_id"] = report["id"]
                uploads[token] = upload
                db.set_job(token, "Queued")
                jobs[token] = ("Queued", None)
                started.append(token)
        overlay(state, uploads, jobs)

    return enforce, started


def _detections(ai, location):
    """Convert pixel boxes to the percent boxes of the Evidence Viewer."""
    width, height = (ai.get("imageSize") or [0, 0])[:2]
    out = []
    for det in ai.get("detections") or []:
        x1, y1, x2, y2 = det["box"]
        out.append({
            "id": det["id"],
            "bbox": [round(100 * x1 / width, 2), round(100 * y1 / height, 2),
                     round(100 * (x2 - x1) / width, 2), round(100 * (y2 - y1) / height, 2)] if width and height else [0, 0, 0, 0],
            "pose": det["pose"],
            "confidence": round(det["conf"] * 100, 1),
            "latitude": location.get("latitude"),
            "longitude": location.get("longitude"),
            "locationSource": "Image GPS (no position for each person)",
        })
    return out


def apply_ai_to_incident(state, token, ai):
    """Copy a new AI result into the draft incident one time. Admin edits after this stay."""
    report = next((r for r in state.get("reports") or [] if r.get("uploadToken") == token), None)
    incident = next((i for i in state.get("incidents") or [] if report and i.get("id") == report.get("incidentId")), None)
    if not incident:
        return []
    if incident.get("verificationStatus") == "verified" and incident.get("status") not in ("Unverified", "Not Reviewed", "Pending Verification"):
        return []  # the Admin decision stays; the new aiResult is still on the report for comparison
    failed = ai.get("status") == "failed"
    new = {
        "originalType": "Unclassified" if failed else ai["incidentType"],
        "aiConfidence": 0 if failed else ai["aiConfidence"],
        "poseConfidence": 0 if failed else ai["poseConfidence"],
        "severityScore": 0 if failed else ai["severityScore"],
        "detectedPeopleCount": 0 if failed else ai["detectedPeopleCount"],
        "aiSeverityScore": 0 if failed else ai["severityScore"],
        "aiDetectedPeopleCount": 0 if failed else ai["detectedPeopleCount"],
        "aiIncidentType": "Unclassified" if failed else ai["incidentType"],
        "nonUprightCount": 0 if failed else ai["nonUprightCount"],
        "severitySource": ai_source_label(ai),
        "aiStatus": "Failed" if failed else "Completed",
        "needsReview": True if failed else ai["needsReview"],
    }
    if not incident.get("reviewedType"):
        new["draftReviewedType"] = new["originalType"]
    changes = [{"entity": "Incident", "id": incident["id"], "field": k, "from": incident.get(k, "—"), "to": v}
               for k, v in new.items() if k in ("originalType", "severityScore", "detectedPeopleCount")]
    incident.update(new)
    incident["detections"] = [] if failed else _detections(ai, incident.get("location") or {})
    attrs = incident.setdefault("customAttributes", {})
    attrs["detected_people_count"] = {"value": new["detectedPeopleCount"], "source": "Live ML inference"}
    return changes
