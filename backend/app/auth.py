import sqlite3
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import audit, security
from app.security import (
    CurrentUser,
    SESSION_COOKIE,
    authenticated,
    create_session,
    format_time,
    get_conn,
    hash_password,
    parse_time,
    token_digest,
    verify_password,
)
from app.users import Password, Username, user_dict

router = APIRouter(prefix="/api")

MAX_FAILURES = 5
LOCKOUT = timedelta(minutes=15)
# Checked when the username is unknown so that timing does not reveal whether it exists.
_DUMMY_HASH = hash_password("not a real password")


class Credentials(BaseModel):
    username: str = Field(max_length=200)
    password: str = Field(max_length=1000)


class SetupBody(BaseModel):
    username: str = Username
    password: str = Password


def _has_users(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT EXISTS (SELECT 1 FROM User)").fetchone()[0] == 1


def _me(user: CurrentUser, csrf_token: str) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": user.is_admin,
        "can_read": user.can_read,
        "can_add": user.can_add,
        "can_edit": user.can_edit,
        "can_delete": user.can_delete,
        "csrf_token": csrf_token,
    }


@router.get("/setup/status")
def setup_status(conn: sqlite3.Connection = Depends(get_conn)):
    return {"needed": not _has_users(conn)}


@router.post("/setup", status_code=201)
def setup(body: SetupBody, conn: sqlite3.Connection = Depends(get_conn)):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Please enter a username.")
    # One statement, so two simultaneous requests cannot both create the first user.
    cur = conn.execute(
        "INSERT INTO User (username, password_hash, is_admin, can_read, can_add, can_edit, can_delete)"
        " SELECT ?, ?, 1, 1, 1, 1, 1 WHERE NOT EXISTS (SELECT 1 FROM User)",
        (username, hash_password(body.password)),
    )
    if cur.rowcount == 0:
        raise HTTPException(status_code=403, detail="Setup has already been completed.")
    audit.record(conn, cur.lastrowid, "setup", "user", cur.lastrowid)
    conn.commit()
    return user_dict(conn.execute("SELECT * FROM User WHERE id = ?", (cur.lastrowid,)).fetchone())


def _locked_out(conn: sqlite3.Connection, username: str, ip: str, current) -> bool:
    cutoff = format_time(current - LOCKOUT)
    rows = conn.execute(
        "SELECT attempted_at FROM LoginAttempt WHERE username = ? AND ip = ? AND attempted_at > ?"
        " ORDER BY attempted_at DESC",
        (username, ip, cutoff),
    ).fetchall()
    return len(rows) >= MAX_FAILURES and current < parse_time(rows[0]["attempted_at"]) + LOCKOUT


@router.post("/login")
def login(body: Credentials, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_conn)):
    username = body.username.strip().lower()
    ip = request.client.host if request.client else "unknown"
    current = security.now()
    if _locked_out(conn, username, ip, current):
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Please wait 15 minutes and try again.",
        )
    user = conn.execute("SELECT * FROM User WHERE username = ?", (username,)).fetchone()
    password_ok = verify_password(body.password, user["password_hash"] if user else _DUMMY_HASH)
    if not (user and user["active"] and password_ok):
        conn.execute("DELETE FROM LoginAttempt WHERE attempted_at <= ?", (format_time(current - LOCKOUT),))
        conn.execute(
            "INSERT INTO LoginAttempt (username, ip, attempted_at) VALUES (?, ?, ?)",
            (username, ip, format_time(current)),
        )
        conn.commit()
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    conn.execute("DELETE FROM LoginAttempt WHERE username = ? AND ip = ?", (username, ip))
    token, csrf = create_session(conn, user["id"])
    conn.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(security.session_timeout(conn).total_seconds()),
        httponly=True,
        samesite="strict",
        path="/",
    )
    return _me(CurrentUser(
        id=user["id"],
        username=user["username"],
        is_admin=bool(user["is_admin"]),
        can_read=bool(user["can_read"]),
        can_add=bool(user["can_add"]),
        can_edit=bool(user["can_edit"]),
        can_delete=bool(user["can_delete"]),
    ), csrf)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    _: tuple[CurrentUser, str] = Depends(authenticated),
    conn: sqlite3.Connection = Depends(get_conn),
):
    conn.execute("DELETE FROM Session WHERE token = ?", (token_digest(request.cookies[SESSION_COOKIE]),))
    conn.commit()
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="strict")
    return {"ok": True}


@router.get("/me")
def me(auth: tuple[CurrentUser, str] = Depends(authenticated)):
    return _me(*auth)
