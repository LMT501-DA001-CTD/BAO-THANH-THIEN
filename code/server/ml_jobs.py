"""Background ML queue. A new live report goes to the queue and gets its aiResult without a user action."""
import asyncio
import logging

from . import config, db, live_reports, ml_service

log = logging.getLogger("skyrescue.jobs")
_queue = None  # made in start(), in the server event loop
_loop = None


def enqueue(token):
    """Thread-safe: sync endpoints run in a thread pool."""
    _loop.call_soon_threadsafe(_queue.put_nowait, token)


async def _run(token):
    upload = db.upload_by_token(token)
    if not upload or not upload["report_id"]:
        return
    report_id = upload["report_id"]
    db.set_job(token, "Running")
    db.mutate(lambda state: live_reports.overlay(state))
    ai = await ml_service.predict(config.MEDIA_DIR / upload["media"], report_id)
    db.set_job(token, "Failed" if ai["status"] == "failed" else "Completed", ai)
    changes = []

    def change(state):
        live_reports.overlay(state)
        changes.extend(live_reports.apply_ai_to_incident(state, token, ai))

    event = "AI_FAILED" if ai["status"] == "failed" else "AI_COMPLETED"
    detail = f"{report_id}: {ai.get('error') or ai['incidentType']} ({ai.get('latencyMs')} ms)"
    db.mutate(change, {"event": event, "detail": detail, "changes": changes})


async def worker():
    while True:
        token = await _queue.get()
        try:
            await _run(token)
        except Exception:
            log.exception("ML job failed for upload %s", token)
            db.set_job(token, "Failed", ml_service.failed_result("Internal job error"))


def start():
    """Start the worker. Queue again the jobs that a restart stopped."""
    global _loop, _queue
    _loop, _queue = asyncio.get_running_loop(), asyncio.Queue()
    for token, (status, _) in db.jobs().items():
        if status in ("Queued", "Running"):
            enqueue(token)
    return asyncio.create_task(worker())
