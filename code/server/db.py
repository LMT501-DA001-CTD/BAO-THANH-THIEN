"""SQLite storage: one shared state document, an append-only audit table, users and sessions."""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from . import config

AUDIT_LIMIT = 1000  # PROMPT A.9: the UI reads the newest 1000 records
SERVER_KEYS = {"audit", "auditSeq", "updatedAt"}  # the server owns these keys; clients cannot write them

_lock = threading.Lock()
_conn = None


def relational_mode():
    return config.DATA_BACKEND == "relational"


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def connect():
    global _conn
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False, isolation_level=None)
    _conn.execute("PRAGMA journal_mode=WAL")
    if relational_mode():
        from . import relational
        relational.init(_conn)
        return _conn
    _conn.executescript("""
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, doc TEXT);
        INSERT OR IGNORE INTO state (id, version, doc) VALUES (1, 0, NULL);
        CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, portal TEXT NOT NULL, created TEXT NOT NULL);
        -- Keyed by the upload token: DEMO_RESET resets the counters, so report ids can occur again.
        CREATE TABLE IF NOT EXISTS media_uploads (
            token TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, media TEXT NOT NULL,
            metadata TEXT NOT NULL, metadata_source TEXT NOT NULL, report_id TEXT, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, record TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ml_results (token TEXT PRIMARY KEY, status TEXT NOT NULL, ai_result TEXT, updated TEXT NOT NULL);
    """)
    return _conn


def version():
    if relational_mode():
        from . import relational
        return relational.version()
    return _conn.execute("SELECT version FROM state WHERE id = 1").fetchone()[0]


def read_state(include_audit):
    """Return (version, state). The state is None before the first client sends the seed."""
    if relational_mode():
        from . import relational
        return relational.version(), relational.read_state(include_audit)
    with _lock:
        ver, doc = _conn.execute("SELECT version, doc FROM state WHERE id = 1").fetchone()
        if doc is None:
            return ver, None
        state = json.loads(doc)
        if include_audit:
            rows = _conn.execute("SELECT seq, record FROM audit ORDER BY seq DESC LIMIT ?", (AUDIT_LIMIT,)).fetchall()
            state["audit"] = [json.loads(r[1]) for r in rows]
            state["auditSeq"] = rows[0][0] if rows else 0
        else:
            state["audit"], state["auditSeq"] = [], 0
        return ver, state


def _apply(state, op):
    key = op["key"]
    if key in SERVER_KEYS:
        return
    if op["op"] == "set":
        state[key] = op.get("value")
        return
    items = state.setdefault(key, [])
    if not isinstance(items, list):
        raise ValueError(f"{key} is not a collection")
    pos = next((i for i, item in enumerate(items) if isinstance(item, dict) and item.get("id") == op["id"]), None)
    if op["op"] == "delete":
        if pos is not None:
            items.pop(pos)
    elif op["op"] == "upsert":
        if pos is not None:
            items[pos] = op["value"]
        else:
            items.insert(min(max(int(op.get("index", len(items))), 0), len(items)), op["value"])
    else:
        raise ValueError(f"Unknown op {op['op']!r}")


SYSTEM_ACTOR = {"id": "SYSTEM", "name": "System", "role": "System"}


def apply_ops(ops, audit, actor, enforce=None):
    """Merge client ops (last write wins for each entity). Return (new version, audit record or None)."""
    if relational_mode():
        from . import relational
        return relational.apply_ops(ops, audit, actor, enforce)
    def change(state):
        for op in ops:
            _apply(state, op)
        if enforce:
            enforce(state)
    return mutate(change, audit, actor)


def mutate(change, audit=None, actor=SYSTEM_ACTOR):
    """Run change(state) under the lock and save. If change returns False, save nothing."""
    if relational_mode():
        from . import relational
        return relational.mutate(change, audit, actor)
    with _lock:
        ver, doc = _conn.execute("SELECT version, doc FROM state WHERE id = 1").fetchone()
        state = json.loads(doc) if doc else {}
        if change(state) is False:
            return ver, None
        state["updatedAt"] = now_iso()
        record = None
        _conn.execute("BEGIN IMMEDIATE")
        try:
            _conn.execute("UPDATE state SET version = ?, doc = ? WHERE id = 1", (ver + 1, json.dumps(state)))
            if audit:
                cur = _conn.execute("INSERT INTO audit (record) VALUES ('{}')")
                seq = cur.lastrowid
                record = {
                    "id": f"AUD-{seq:05d}",
                    "event": str(audit.get("event") or "STATE_UPDATED")[:80],
                    "detail": str(audit.get("detail") or "")[:500],
                    "at": state["updatedAt"],
                    "actor": actor,  # from the server session, never from the client
                    "changes": list(audit.get("changes") or [])[:40],
                }
                _conn.execute("UPDATE audit SET record = ? WHERE seq = ?", (json.dumps(record), seq))
            _conn.execute("COMMIT")
        except Exception:
            _conn.execute("ROLLBACK")
            raise
        return ver + 1, record


def create_session(token, user_id, portal):
    _conn.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (token, user_id, portal, now_iso()))


def session_user_id(token, portal):
    row = _conn.execute("SELECT user_id FROM sessions WHERE token = ? AND portal = ?", (token, portal)).fetchone()
    return row[0] if row else None


def delete_session(token):
    _conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


UPLOAD_COLUMNS = ("token", "user_id", "fingerprint", "media", "metadata", "metadata_source", "report_id")
_UPLOAD_SELECT = f"SELECT {', '.join(UPLOAD_COLUMNS)} FROM media_uploads"


def add_upload(token, user_id, fingerprint, media, metadata, metadata_source):
    _conn.execute("INSERT INTO media_uploads VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
                  (token, user_id, fingerprint, media, json.dumps(metadata), metadata_source, now_iso()))
    if relational_mode():
        urow = _conn.execute("SELECT user_id FROM users WHERE user_code=?", (str(user_id),)).fetchone()
        _conn.execute(
            """INSERT INTO upload_attempts
               (attempt_code, user_id, file_name, result, error_code, attempted_at,
                upload_token, media_name, fingerprint, metadata_json, metadata_source, payload_json)
               VALUES (?, ?, ?, 'success', NULL, ?, ?, ?, ?, ?, ?, ?)""",
            (f"ATT-{token[:10].upper()}", urow[0] if urow else None, media, now_iso(), token, media,
             fingerprint, json.dumps(metadata), metadata_source,
             json.dumps({"id": f"ATT-{token[:10].upper()}", "filename": media, "uploadStatus": "Uploaded",
                         "metadata": metadata, "fingerprint": fingerprint, "uploadToken": token})),
        )


def _upload_row(row):
    if not row:
        return None
    upload = dict(zip(UPLOAD_COLUMNS, row))
    upload["metadata"] = json.loads(upload["metadata"])
    return upload


def upload_by_token(token):
    return _upload_row(_conn.execute(f"{_UPLOAD_SELECT} WHERE token = ?", (token,)).fetchone())


def bound_uploads():
    """Return {token: upload} for all uploads that a report uses."""
    return {r[0]: _upload_row(r) for r in _conn.execute(f"{_UPLOAD_SELECT} WHERE report_id IS NOT NULL").fetchall()}


def bind_upload(token, report_id):
    """Link an unused upload to a report one time. Return True on success."""
    cur = _conn.execute("UPDATE media_uploads SET report_id = ? WHERE token = ? AND report_id IS NULL", (report_id, token))
    if cur.rowcount == 1 and relational_mode():
        row = _conn.execute("SELECT report_id FROM reports WHERE report_code=?", (str(report_id),)).fetchone()
        if row:
            _conn.execute("UPDATE upload_attempts SET report_id=? WHERE upload_token=?", (row[0], token))
    return cur.rowcount == 1


def set_job(token, status, ai_result=None):
    _conn.execute("INSERT OR REPLACE INTO ml_results VALUES (?, ?, ?, ?)",
                  (token, status, json.dumps(ai_result) if ai_result is not None else None, now_iso()))


def jobs():
    """Return {token: (status, aiResult or None)}."""
    rows = _conn.execute("SELECT token, status, ai_result FROM ml_results").fetchall()
    return {r[0]: (r[1], json.loads(r[2]) if r[2] else None) for r in rows}


def add_user(record):
    if relational_mode():
        from . import relational
        return relational.add_user(record)
    _conn.execute("INSERT INTO users VALUES (?, ?, ?)", (record["id"], json.dumps(record), now_iso()))


def registered_users():
    if relational_mode():
        from . import relational
        return relational.all_users()
    return [json.loads(r[0]) for r in _conn.execute("SELECT record FROM users").fetchall()]


def all_users():
    if relational_mode():
        from . import relational
        return relational.all_users()
    return registered_users()
