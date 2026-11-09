"""Shared state API: boot script, read, sync ops, and change events (SSE + polling)."""
import asyncio
import json
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from . import auth, db, live_reports, ml_jobs

router = APIRouter()
NO_STORE = {"Cache-Control": "no-store"}


def _actor(user):
    return {"id": user["id"], "name": user["name"], "role": user["role"]}


def _state_for(user):
    # Only Dispatch Admin reads the audit log (PROMPT A.9).
    return db.read_state(include_audit=user["portal"] == "dispatch")


@router.get("/api/boot.js")
def boot(request: Request):
    """Loaded by a <script> tag before shared-state.js, so Store.load() stays synchronous."""
    user = auth.current_user(request)
    payload = {"version": db.version(), "state": None, "user": None}
    if user:
        payload["version"], payload["state"] = _state_for(user)
        payload["user"] = auth.public_user(user)
    body = f"window.__SKY_BOOT__ = {json.dumps(payload)};"
    return Response(body, media_type="application/javascript", headers=NO_STORE)


@router.get("/api/state")
def get_state(request: Request):
    version, state = _state_for(auth.require_user(request))
    return Response(json.dumps({"version": version, "state": state}), media_type="application/json", headers=NO_STORE)


@router.get("/api/version")
def get_version(request: Request):
    auth.require_user(request)
    return {"version": db.version()}


class Op(BaseModel):
    op: Literal["set", "upsert", "delete"]
    key: str
    id: Optional[str] = None
    index: Optional[int] = None
    value: Any = None


class Audit(BaseModel):
    event: str
    detail: str = ""
    changes: list = []


class SyncBody(BaseModel):
    ops: list[Op]
    audit: Optional[Audit] = None


@router.post("/api/sync")
def sync(body: SyncBody, request: Request):
    user = auth.require_user(request)
    if any(op.op != "set" and not op.id for op in body.ops):
        raise HTTPException(422, "upsert and delete need an id")
    enforce, started = live_reports.make_enforcer(user)
    version, record = db.apply_ops(
        [op.model_dump() for op in body.ops],
        body.audit.model_dump() if body.audit else None,
        _actor(user),
        enforce,
    )
    for token in started:  # the ML job starts without a user action (PROMPT §2.1)
        ml_jobs.enqueue(token)
    return {"version": version, "audit": record}


@router.get("/api/events")
async def events(request: Request):
    """Send the new state version when it changes. Clients also poll, because some proxies block SSE."""
    auth.require_user(request)

    async def stream():
        last, idle = None, 0.0
        while not await request.is_disconnected():
            current = db.version()
            if current != last:
                last, idle = current, 0.0
                yield f"data: {current}\n\n"
            elif idle >= 15:
                idle = 0.0
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.5)
            idle += 0.5

    return StreamingResponse(stream(), media_type="text/event-stream", headers={**NO_STORE, "X-Accel-Buffering": "no"})
