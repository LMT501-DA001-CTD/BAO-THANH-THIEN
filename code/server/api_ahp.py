"""AHP/TOPSIS priority ranking for the Dispatch priority queue."""
import logging

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import ahp_priority, auth, db

router = APIRouter()
log = logging.getLogger("skyrescue.ahp")
NO_STORE = {"Cache-Control": "no-store"}

@router.get("/api/ahp/priority")
async def priority(request: Request, time_range: str = Query("7d", alias="range")):
    auth.require_user(request, portal="dispatch")

    selected = time_range if time_range in ("24h", "7d", "30d", "all") else "7d"
    version, state = db.read_state(include_audit=False)
    payload = await run_in_threadpool(ahp_priority.rank_state, state, selected)
    payload["version"] = version

    if payload.get("error"):
        log.warning("AHP payload error for version %s: %s", version, payload["error"])

    return JSONResponse(payload, headers=NO_STORE)
