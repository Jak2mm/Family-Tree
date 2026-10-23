import hashlib
import os
import secrets
import sqlite3
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request

from app.db import connect

SESSION_COOKIE = "session"
DEFAULT_TIMEOUT_HOURS = 8.0
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
PERMISSIONS = {"read", "add", "edit", "delete", "admin"}
TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

_hasher = PasswordHasher()  # argon2id with the library's default parameters


def now() -> datetime:
    """Current UTC time. Tests monkeypatch this to control the clock."""
    return datetime.now(timezone.utc)


def format_time(t: datetime) -> str:
    return t.strftime(TIME_FORMAT)


def parse_time(s: str) -> datetime:
    return datetime.strptime(s, TIME_FORMAT).replace(tzinfo=timezone.utc)


def normalise_username(name: str) -> str:
    """Canonical form used for storing, looking up and rate-limiting usernames.

    SQLite's NOCASE only folds ASCII, so fold Unicode here instead (NFC + casefold).
    """
    return unicodedata.normalize("NFC", name.strip()).casefold()


def hash_password(p: str) -> str:
    return _hasher.hash(p)


def verify_password(p: str, h: str) -> bool:
    try:
        return _hasher.verify(h, p)
    except (VerificationError, InvalidHashError):
        return False


@dataclass(frozen=True)
class CurrentUser:
    id: int
    username: str
    is_admin: bool
    can_read: bool
    can_add: bool
    can_edit: bool
    can_delete: bool


def get_conn(request: Request):
    """Open a database connection for one request and close it afterwards.

    Handlers commit their own work. The connection may be used from a worker
    thread other than the one that opened it, but only by one request at a time.
    """
    path = os.path.join(request.app.state.settings.data_dir, "family_tree.db")
    conn = connect(path, check_same_thread=False)
    try:
        yield conn
    finally:
        conn.close()


def token_digest(token: str) -> str:
    """Sessions are stored by the hash of the cookie token, so a leaked database cannot be used to sign in."""
    return hashlib.sha256(token.encode()).hexdigest()


def session_timeout(conn: sqlite3.Connection) -> timedelta:
    row = conn.execute("SELECT value FROM Setting WHERE key = 'session_timeout_hours'").fetchone()
    try:
        hours = float(row["value"]) if row else DEFAULT_TIMEOUT_HOURS
    except ValueError:
        hours = DEFAULT_TIMEOUT_HOURS
    return timedelta(hours=hours if hours > 0 else DEFAULT_TIMEOUT_HOURS)


def create_session(conn: sqlite3.Connection, user_id: int) -> tuple[str, str]:
    """Create a session; returns (cookie token, csrf token)."""
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    stamp = format_time(now())
    conn.execute(
        "INSERT INTO Session (token, user_id, csrf_token, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
        (token_digest(token), user_id, csrf, stamp, stamp),
    )
    return token, csrf


def _unauthorised() -> HTTPException:
    return HTTPException(status_code=401, detail="Please sign in to continue.")


def authenticated(request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> tuple[CurrentUser, str]:
    """Resolve the session cookie to (user, csrf token); enforces the CSRF header on mutating requests."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise _unauthorised()
    digest = token_digest(token)
    row = conn.execute(
        "SELECT s.csrf_token, s.last_seen_at, u.* FROM Session s JOIN User u ON u.id = s.user_id WHERE s.token = ?",
        (digest,),
    ).fetchone()
    if row is None:
        raise _unauthorised()
    current = now()
    if not row["active"] or current - parse_time(row["last_seen_at"]) > session_timeout(conn):
        conn.execute("DELETE FROM Session WHERE token = ?", (digest,))
        conn.commit()
        raise _unauthorised()
    if request.method in MUTATING_METHODS:
        sent = request.headers.get("X-CSRF-Token", "")
        if not secrets.compare_digest(sent.encode(), row["csrf_token"].encode()):
            raise HTTPException(
                status_code=403,
                detail="Your session could not be verified. Please refresh the page and try again.",
            )
    conn.execute("UPDATE Session SET last_seen_at = ? WHERE token = ?", (format_time(current), digest))
    conn.commit()
    user = CurrentUser(
        id=row["id"],
        username=row["username"],
        is_admin=bool(row["is_admin"]),
        can_read=bool(row["can_read"]),
        can_add=bool(row["can_add"]),
        can_edit=bool(row["can_edit"]),
        can_delete=bool(row["can_delete"]),
    )
    return user, row["csrf_token"]


def current_user(auth: tuple[CurrentUser, str] = Depends(authenticated)) -> CurrentUser:
    return auth[0]


def require(*perms: str):
    """FastAPI dependency factory: the signed-in user must hold every listed permission.

    perms are drawn from "read", "add", "edit", "delete" and "admin".
    """
    unknown = set(perms) - PERMISSIONS
    if unknown:
        raise ValueError(f"Unknown permission(s): {sorted(unknown)}")

    def check(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        for perm in perms:
            # An administrator always holds every permission, so they can never lock themselves out.
            allowed = user.is_admin or (perm != "admin" and getattr(user, f"can_{perm}"))
            if not allowed:
                raise HTTPException(status_code=403, detail="You do not have permission to do that.")
        return user

    return check
