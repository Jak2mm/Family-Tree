import json
import os
import subprocess
from datetime import datetime, timedelta, timezone

import pytest

from app import settings_api
from app.db import connect

ENDPOINTS = [
    ("get", "/api/settings/backup", None),
    ("put", "/api/settings/backup", {"times": ["02:00"], "days": None, "retention": 14, "session_timeout_hours": 8}),
    ("post", "/api/backup/run", None),
    ("get", "/api/backup/status", None),
    ("get", "/api/settings/dependency-check", None),
    ("post", "/api/settings/dependency-check", None),
]
VALID = {"times": ["02:00"], "days": None, "retention": 14, "session_timeout_hours": 8}


@pytest.fixture
def admin(make_user, login_as):
    return login_as(make_user(admin=True))


@pytest.fixture
def db(settings, client):
    c = connect(os.path.join(settings.data_dir, "family_tree.db"))
    yield c
    c.close()


@pytest.fixture
def pip_audit(monkeypatch):
    """Replace the real pip-audit run; the test sets .result or .raises."""
    class Fake:
        result = subprocess.CompletedProcess([], 0, json.dumps({"dependencies": []}), "")
        raises = None
        calls = []

    def run(cmd, **kwargs):
        Fake.calls.append((cmd, kwargs))
        if Fake.raises:
            raise Fake.raises
        return Fake.result

    Fake.calls = []
    monkeypatch.setattr(settings_api.subprocess, "run", run)
    return Fake


# ---- access ----

@pytest.mark.parametrize("method,url,body", ENDPOINTS)
def test_signed_out_gets_401(client, method, url, body):
    assert getattr(client, method)(url, **({"json": body} if body else {})).status_code == 401


@pytest.mark.parametrize("method,url,body", ENDPOINTS)
def test_non_admin_gets_403(make_user, login_as, method, url, body):
    c = login_as(make_user({"read", "add", "edit", "delete"}))
    assert getattr(c, method)(url, **({"json": body} if body else {})).status_code == 403


# ---- backup settings ----

def test_defaults(admin, settings):
    r = admin.get("/api/settings/backup")
    assert r.status_code == 200
    assert r.json() == {**VALID, "backup_folder": settings.backups_dir}


def test_put_saves_and_audits(admin, db):
    body = {"times": ["14:30", "02:00", "02:00"], "days": [4, 0], "retention": 30, "session_timeout_hours": 24}
    r = admin.put("/api/settings/backup", json=body)
    assert r.status_code == 200
    assert r.json()["times"] == ["02:00", "14:30"] and r.json()["days"] == [0, 4]
    again = admin.get("/api/settings/backup").json()
    assert (again["times"], again["days"], again["retention"], again["session_timeout_hours"]) == (["02:00", "14:30"], [0, 4], 30, 24)
    entry = db.execute("SELECT action, record_type FROM AuditEntry ORDER BY id DESC LIMIT 1").fetchone()
    assert tuple(entry) == ("update", "settings")
    assert db.execute("SELECT value FROM Setting WHERE key = 'session_timeout_hours'").fetchone()[0] == "24"


def test_put_ignores_backup_folder(admin, settings):
    r = admin.put("/api/settings/backup", json={**VALID, "backup_folder": "/etc"})
    assert r.status_code == 200 and r.json()["backup_folder"] == settings.backups_dir


def test_session_timeout_setting_is_used_by_sessions(admin, db):
    admin.put("/api/settings/backup", json={**VALID, "session_timeout_hours": 1})
    db.execute("UPDATE Session SET last_seen_at = ?", ((datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),))
    db.commit()
    assert admin.get("/api/settings/backup").status_code == 401


@pytest.mark.parametrize("field,value", [
    ("times", ["25:99"]), ("times", ["2:00"]), ("times", ["02:00:00"]), ("times", []), ("times", "02:00"), ("times", [200]), ("times", None),
    ("days", [7]), ("days", [-1]), ("days", []), ("days", ["Monday"]), ("days", [True]), ("days", "all"),
    ("retention", 0), ("retention", 366), ("retention", 14.5), ("retention", "14"), ("retention", True), ("retention", None),
    ("session_timeout_hours", 0), ("session_timeout_hours", 169), ("session_timeout_hours", "eight"), ("session_timeout_hours", 1.5),
])
def test_invalid_values_get_plain_422(admin, db, field, value):
    r = admin.put("/api/settings/backup", json={**VALID, field: value})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str) and r.json()["detail"].endswith(".")
    assert admin.get("/api/settings/backup").json()["times"] == ["02:00"]
    assert db.execute("SELECT COUNT(*) FROM Setting").fetchone()[0] == 0


def test_boundary_values_are_accepted(admin):
    for retention, hours in ((1, 1), (365, 168)):
        assert admin.put("/api/settings/backup", json={**VALID, "retention": retention, "session_timeout_hours": hours}).status_code == 200


def test_malformed_stored_values_fall_back_to_defaults(admin, db):
    for key in ("backup_times", "backup_days", "backup_retention"):
        db.execute("INSERT INTO Setting (key, value) VALUES (?, 'garbage')", (key,))
    db.commit()
    assert admin.get("/api/settings/backup").json() == {**VALID, "backup_folder": admin.get("/api/settings/backup").json()["backup_folder"]}


# ---- backup run and status ----

def test_run_now_returns_result_and_updates_status(admin, db, settings):
    os.makedirs(settings.backups_dir)
    r = admin.post("/api/backup/run")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["size"] > 0 and body["error"] is None
    assert os.path.exists(body["path"])
    status = admin.get("/api/backup/status").json()
    assert status["ok"] is True and status["size"] == body["size"] and status["nas_available"] is True
    assert status["last_run"] and status["next_run"] and status["error"] is None
    assert status["retry"] == {"retrying": False, "next_retry_at": None}
    assert tuple(db.execute("SELECT action, record_type FROM AuditEntry ORDER BY id DESC LIMIT 1").fetchone()) == ("run", "backup")


def test_run_now_with_nas_offline_reports_failure_not_500(admin):
    r = admin.post("/api/backup/run")
    assert r.status_code == 200 and r.json()["ok"] is False and "NAS" in r.json()["error"]
    status = admin.get("/api/backup/status").json()
    assert status["ok"] is False and status["nas_available"] is False and status["warning"]
    assert status["retry"]["retrying"] is True and status["retry"]["next_retry_at"]


def test_status_before_any_backup(admin, settings):
    os.makedirs(settings.backups_dir)
    s = admin.get("/api/backup/status").json()
    assert s["last_run"] is None and s["ok"] is None and s["nas_available"] is True and s["next_run"]


def test_status_next_run_follows_the_schedule(admin, settings):
    os.makedirs(settings.backups_dir)
    admin.put("/api/settings/backup", json={**VALID, "times": ["03:00"]})
    s = admin.get("/api/backup/status").json()
    assert datetime.fromisoformat(s["next_run"]).strftime("%H:%M") == "03:00"


# ---- dependency check ----

def test_dependency_check_before_any_run(admin):
    r = admin.get("/api/settings/dependency-check").json()
    assert r["checked_at"] is None and r["vulnerabilities"] == [] and r["check_failed"] is False and r["message"]


def test_dependency_check_stores_vulnerabilities(admin, pip_audit, db):
    pip_audit.result = subprocess.CompletedProcess([], 1, json.dumps({"dependencies": [
        {"name": "good", "version": "1.0", "vulns": []},
        {"name": "bad", "version": "0.1", "vulns": [{"id": "PYSEC-1", "fix_versions": ["0.2"], "description": "Bad thing"}]},
    ]}), "")
    r = admin.post("/api/settings/dependency-check")
    assert r.status_code == 200
    body = r.json()
    assert body["check_failed"] is False and body["checked_at"]
    assert body["vulnerabilities"] == [{"package": "bad", "version": "0.1", "id": "PYSEC-1", "fix_versions": ["0.2"], "description": "Bad thing"}]
    cmd, kwargs = pip_audit.calls[0]
    assert cmd[-2:] == ["--format", "json"] and "pip_audit" in cmd
    assert kwargs["timeout"] == 120
    assert admin.get("/api/settings/dependency-check").json() == body  # stored, not re-run
    assert len(pip_audit.calls) == 1
    assert tuple(db.execute("SELECT action, record_type FROM AuditEntry ORDER BY id DESC LIMIT 1").fetchone()) == ("run", "dependency_check")


def test_dependency_check_clean(admin, pip_audit):
    body = admin.post("/api/settings/dependency-check").json()
    assert body["vulnerabilities"] == [] and body["check_failed"] is False and "no known" in body["message"].lower()


@pytest.mark.parametrize("failure", [
    FileNotFoundError("pip-audit"),
    subprocess.TimeoutExpired("pip-audit", 120),
    PermissionError("nope"),
])
def test_dependency_check_failure_is_stored_not_raised(admin, pip_audit, failure):
    pip_audit.raises = failure
    r = admin.post("/api/settings/dependency-check")
    assert r.status_code == 200
    assert r.json()["check_failed"] is True and r.json()["message"] and r.json()["vulnerabilities"] == []
    assert admin.get("/api/settings/dependency-check").json()["check_failed"] is True


@pytest.mark.parametrize("stdout,stderr", [("", "Failed to connect: no network"), ("not json", ""), ('{"unexpected": 1}', "")])
def test_dependency_check_unusable_output_is_a_failed_check(admin, pip_audit, stdout, stderr):
    pip_audit.result = subprocess.CompletedProcess([], 1, stdout, stderr)
    r = admin.post("/api/settings/dependency-check")
    assert r.status_code == 200 and r.json()["check_failed"] is True
    assert "Traceback" not in r.json()["message"]


def test_scheduler_runs_dependency_check_once_a_day(settings, client, pip_audit):
    now = datetime(2026, 12, 14, 9, 0, tzinfo=timezone.utc)
    settings_api.daily_dependency_check(settings, now)
    settings_api.daily_dependency_check(settings, now + timedelta(hours=23))
    assert len(pip_audit.calls) == 1
    settings_api.daily_dependency_check(settings, now + timedelta(hours=25))
    assert len(pip_audit.calls) == 2
