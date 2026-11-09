"""Login, logout and session lookup. Each portal has its own session cookie."""
import hashlib
import hmac
import json
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import config, db

PORTALS = ("reporter", "dispatch")
# Only password hashes are in this file. The demo passwords are on the login page (PROMPT §6.1).
SEED_USERS = json.loads((Path(__file__).with_name("seed_users.json")).read_text(encoding="utf-8"))
LOGIN_LIMIT = 10  # failed attempts per client IP per minute
_attempts = defaultdict(deque)

router = APIRouter()


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    _, salt_hex, _ = stored.split("$")
    return hmac.compare_digest(hash_password(password, bytes.fromhex(salt_hex)), stored)


def all_users():
    if db.relational_mode():
        return db.all_users()
    return SEED_USERS + db.registered_users()


def find_user(identifier):
    query = identifier.strip().lower()
    for user in all_users():
        names = {user["id"].lower(), *(a.lower() for a in user["logins"])}
        if query in names:
            return user
    return None


def public_user(user):
    return {k: user.get(k) for k in ("id", "name", "role", "portal", "phone", "trustTier", "verified", "teamId", "uavId")}


def cookie_name(portal):
    return f"sky_{portal}"


def request_portal(request):
    portal = request.headers.get("x-portal") or request.query_params.get("portal")
    if portal not in PORTALS:
        raise HTTPException(400, "Unknown portal")
    return portal


def current_user(request):
    """Return the signed-in user for the request portal, or None."""
    portal = request_portal(request)
    token = request.cookies.get(cookie_name(portal))
    user_id = db.session_user_id(token, portal) if token else None
    return next((u for u in all_users() if u["id"] == user_id), None) if user_id else None


def require_user(request, portal=None):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Sign in first")
    if portal and user["portal"] != portal:
        raise HTTPException(403, "This account cannot use this function")
    return user


def _start_session(response, user, portal):
    token = secrets.token_urlsafe(32)
    db.create_session(token, user["id"], portal)
    response.set_cookie(cookie_name(portal), token, httponly=True, samesite="lax", secure=config.COOKIE_SECURE, path="/")


def client_ip(request):
    """Cloudflare Tunnel connects from localhost. Trust its client header only in that case."""
    host = request.client.host if request.client else "?"
    if host in ("127.0.0.1", "::1") and request.headers.get("cf-connecting-ip"):
        return request.headers["cf-connecting-ip"]
    return host


def _recent_failures(ip):
    window = _attempts[ip]
    now = time.monotonic()
    while window and now - window[0] > 60:
        window.popleft()
    return len(window)


def _rate_limited(ip):
    return _recent_failures(ip) >= LOGIN_LIMIT


def _record_failure(ip):
    _attempts[ip].append(time.monotonic())


class LoginBody(BaseModel):
    identifier: str
    password: str
    portal: str


@router.post("/api/login")
def login(body: LoginBody, request: Request, response: Response):
    if body.portal not in PORTALS:
        raise HTTPException(400, "Unknown portal")
    ip = client_ip(request)
    if _rate_limited(ip):
        raise HTTPException(429, "Too many sign-in attempts. Wait one minute.")
    user = find_user(body.identifier)
    if not user or not any(verify_password(body.password.strip(), h) for h in user["passwordHashes"]):
        _record_failure(ip)
        raise HTTPException(401, "Incorrect user name or password.")
    if user["portal"] != body.portal:
        raise HTTPException(403, f"This account does not belong to the {body.portal.capitalize()} portal.")
    _start_session(response, user, body.portal)
    return {"user": public_user(user)}


class RegisterBody(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=6, max_length=20, pattern=r"^[0-9+ .()-]+$")
    password: str = Field(min_length=8, max_length=128)


@router.post("/api/register")
def register(body: RegisterBody, request: Request, response: Response):
    """Self-registration makes only Unverified Citizen accounts (PROMPT §6.1)."""
    ip = client_ip(request)
    if _rate_limited(ip):
        raise HTTPException(429, "Too many attempts. Wait one minute.")
    _record_failure(ip)  # each registration counts, so one client cannot make many accounts quickly
    login = "".join(ch for ch in body.phone if ch.isdigit())
    if find_user(login):
        raise HTTPException(409, "An account with this phone number already exists.")
    user = {
        "id": f"CIT-{secrets.token_hex(4).upper()}", "name": body.name.strip(), "phone": body.phone.strip(),
        "role": "Citizen", "trustTier": "Unverified Citizen", "verified": False, "portal": "reporter",
        "logins": [login], "passwordHashes": [hash_password(body.password)],
    }
    db.add_user(user)
    _start_session(response, user, "reporter")
    return {"user": public_user(user)}


@router.post("/api/logout")
def logout(request: Request, response: Response):
    portal = request_portal(request)
    token = request.cookies.get(cookie_name(portal))
    if token:
        db.delete_session(token)
    response.delete_cookie(cookie_name(portal), path="/")
    return {"ok": True}
