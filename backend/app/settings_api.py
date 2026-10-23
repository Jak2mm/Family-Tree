import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import audit
from app.backup import (RETRY_AFTER, load_schedule, live_path, next_run, read_setting, run_and_record, write_setting)
from app.config import Settings, marker_missing, zone_for
from app.db import connect
from app.security import CurrentUser, get_conn, require

router = APIRouter(prefix="/api")

DEFAULT_SESSION_HOURS = 8  # must match security.DEFAULT_TIMEOUT_HOURS
AUDIT_TIMEOUT_SECONDS = 120
CHECK_EVERY = timedelta(days=1)


def _whole_number(value: Any, low: int, high: int, what: str) -> int:
    if type(value) is not int or not low <= value <= high:
        raise HTTPException(status_code=422, detail=f"Please enter a whole number for {what} between {low} and {high}.")
    return value


class BackupSettingsBody(BaseModel):
    times: Any = None
    days: Any = None
    retention: Any = None
    session_timeout_hours: Any = None


def _session_hours(conn: sqlite3.Connection) -> int:
    value = read_setting(conn, "session_timeout_hours")
    # security.session_timeout() reads this row as text, so a plain number is stored as well as read here.
    return value if type(value) is int and 1 <= value <= 168 else DEFAULT_SESSION_HOURS


def _settings_view(conn: sqlite3.Connection, settings: Settings) -> dict:
    times, days, retention = load_schedule(conn)
    return {"times": sorted(times), "days": days, "retention": retention,
            "session_timeout_hours": _session_hours(conn), "backup_folder": settings.backups_dir,
            "timezone": settings.timezone}


@router.get("/settings/backup")
def get_backup_settings(request: Request, _: CurrentUser = Depends(require("admin")), conn: sqlite3.Connection = Depends(get_conn)):
    return _settings_view(conn, request.app.state.settings)


@router.put("/settings/backup")
def put_backup_settings(body: BackupSettingsBody, request: Request, admin: CurrentUser = Depends(require("admin")),
                        conn: sqlite3.Connection = Depends(get_conn)):
    times = body.times
    if not (isinstance(times, list) and 1 <= len(times) <= 24 and all(isinstance(t, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t) for t in times)):
        raise HTTPException(status_code=422, detail="Please enter each backup time as hours and minutes, like 02:00 (24-hour clock).")
    days = body.days
    if days is not None and not (isinstance(days, list) and days and all(type(d) is int and 0 <= d <= 6 for d in days)):
        raise HTTPException(status_code=422, detail="Please choose backup days from Monday (0) to Sunday (6), or leave it blank for every day.")
    retention = _whole_number(body.retention, 1, 365, "how many backups to keep")
    hours = _whole_number(body.session_timeout_hours, 1, 168, "the sign-in timeout in hours")
    write_setting(conn, "backup_times", sorted(set(times)))
    write_setting(conn, "backup_days", sorted(set(days)) if days is not None else None)
    write_setting(conn, "backup_retention", retention)
    write_setting(conn, "session_timeout_hours", hours)
    audit.record(conn, admin.id, "update", "settings", None)
    conn.commit()
    return _settings_view(conn, request.app.state.settings)


@router.post("/backup/run")
def run_backup_now(request: Request, admin: CurrentUser = Depends(require("admin")), conn: sqlite3.Connection = Depends(get_conn)):
    result = run_and_record(request.app.state.settings, datetime.now(timezone.utc))
    audit.record(conn, admin.id, "run", "backup", None)
    conn.commit()
    return {"ok": result.ok, "path": result.path, "size": result.size, "error": result.error}


@router.get("/backup/status")
def backup_status(request: Request, _: CurrentUser = Depends(require("admin")), conn: sqlite3.Connection = Depends(get_conn)):
    settings = request.app.state.settings
    local = datetime.now(timezone.utc).astimezone(zone_for(settings))
    times, days, _keep = load_schedule(conn)
    last = read_setting(conn, "backup_last")
    last = last if isinstance(last, dict) else {}
    nas = not marker_missing(settings) and os.path.isdir(settings.backups_dir) and os.access(settings.backups_dir, os.W_OK)
    failing = last.get("ok") is False
    retry_at = datetime.fromisoformat(last["at"]) + RETRY_AFTER if failing else None
    upcoming = next_run(times, days, local)
    warning = None
    if failing:
        warning = f"The last backup failed: {last.get('error')} It is being retried every 15 minutes."
    elif not nas:
        warning = "The backups folder is not available right now. The next backup will fail until it returns."
    return {
        "last_run": last.get("at"), "ok": last.get("ok"), "size": last.get("size"), "error": last.get("error"),
        "nas_available": nas, "warning": warning,
        "next_run": (retry_at or upcoming).isoformat() if (retry_at or upcoming) else None,
        "retry": {"retrying": failing, "next_retry_at": retry_at.isoformat() if retry_at else None},
    }


# ---- dependency check ----

def _check_result(checked_at: datetime, vulnerabilities: list, failed: bool, message: str) -> dict:
    return {"checked_at": checked_at.isoformat(), "vulnerabilities": vulnerabilities, "check_failed": failed, "message": message}


def run_dependency_check(conn: sqlite3.Connection, now: datetime) -> dict:
    """Run pip-audit and store the outcome. Any problem running it is stored as a failed check, never raised."""
    failed = lambda why: _check_result(now, [], True, why)  # noqa: E731
    try:
        done = subprocess.run([sys.executable, "-m", "pip_audit", "--format", "json"], capture_output=True, text=True,
                              timeout=AUDIT_TIMEOUT_SECONDS, check=False)
        dependencies = json.loads(done.stdout)["dependencies"]  # pip-audit exits 1 when it finds something, so the exit code is not used
        found = [{"package": d["name"], "version": d.get("version"), "id": v["id"], "fix_versions": v.get("fix_versions", []),
                  "description": v.get("description", "")} for d in dependencies for v in d.get("vulns", [])]
        result = _check_result(now, found, False, f"{len(found)} known vulnerabilities found." if found else "No known vulnerabilities were found.")
    except subprocess.TimeoutExpired:
        result = failed("The security check took too long and was stopped. It will be tried again tomorrow.")
    except (OSError, ValueError, KeyError, TypeError):
        result = failed("The security check could not run. It needs a working internet connection and will be tried again tomorrow.")
    write_setting(conn, "dependency_check", result)
    conn.commit()
    return result


def daily_dependency_check(settings: Settings, now: datetime) -> None:
    """Scheduler job: run the check if it has not run in the last day."""
    conn = connect(live_path(settings))
    try:
        last = read_setting(conn, "dependency_check")
        if isinstance(last, dict) and last.get("checked_at"):
            try:
                if now - datetime.fromisoformat(last["checked_at"]) < CHECK_EVERY:
                    return
            except ValueError:
                pass
        run_dependency_check(conn, now)
    finally:
        conn.close()


@router.get("/settings/dependency-check")
def get_dependency_check(_: CurrentUser = Depends(require("admin")), conn: sqlite3.Connection = Depends(get_conn)):
    stored = read_setting(conn, "dependency_check")
    if isinstance(stored, dict):
        return stored
    return {"checked_at": None, "vulnerabilities": [], "check_failed": False, "message": "The security check has not run yet."}


@router.post("/settings/dependency-check")
def post_dependency_check(admin: CurrentUser = Depends(require("admin")), conn: sqlite3.Connection = Depends(get_conn)):
    result = run_dependency_check(conn, datetime.now(timezone.utc))
    audit.record(conn, admin.id, "run", "dependency_check", None)
    conn.commit()
    return result
