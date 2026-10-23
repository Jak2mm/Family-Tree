import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends

from app import security
from app.db import connect
from app.security import hash_password, require, verify_password

CREDS = {"username": "alice", "password": "a long password"}


@pytest.fixture
def clock(monkeypatch):
    state = {"t": datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(security, "now", lambda: state["t"])

    class Clock:
        def advance(self, **kw):
            state["t"] += timedelta(**kw)

    return Clock()


@pytest.fixture
def db(settings, client):
    c = connect(os.path.join(settings.data_dir, "family_tree.db"))
    yield c
    c.close()


def test_hash_is_argon2id_and_verifies():
    h = hash_password("secret pass")
    assert h.startswith("$argon2id$")
    assert "secret pass" not in h
    assert verify_password("secret pass", h)
    assert not verify_password("other", h)
    assert not verify_password("secret pass", "not a hash")


def test_setup_status_and_setup_once(client, db):
    assert client.get("/api/setup/status").json() == {"needed": True}
    r = client.post("/api/setup", json=CREDS)
    assert r.status_code == 201
    body = r.json()
    assert body["is_admin"] is True
    assert (body["can_read"], body["can_add"], body["can_edit"], body["can_delete"]) == (True,) * 4
    assert client.get("/api/setup/status").json() == {"needed": False}
    again = client.post("/api/setup", json={"username": "bob", "password": "another password"})
    assert again.status_code == 403
    assert db.execute("SELECT COUNT(*) FROM User").fetchone()[0] == 1
    audit = db.execute("SELECT action, record_type FROM AuditEntry").fetchall()
    assert [(a["action"], a["record_type"]) for a in audit] == [("setup", "user")]


def test_stored_password_is_hashed(client, db):
    client.post("/api/setup", json=CREDS)
    stored = db.execute("SELECT password_hash FROM User").fetchone()[0]
    assert stored.startswith("$argon2id$")
    assert CREDS["password"] not in stored


def test_setup_validates_input_in_plain_language(client):
    r = client.post("/api/setup", json={"username": "alice", "password": "short"})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)
    assert "password" in r.json()["detail"]


def test_login_me_logout(client, make_user):
    u = make_user()
    r = client.post("/api/login", json={"username": u.username, "password": u.password})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    me = client.get("/api/me").json()
    assert me["username"] == u.username
    assert me["csrf_token"] == r.json()["csrf_token"]
    assert "password_hash" not in me
    out = client.post("/api/logout", headers={"X-CSRF-Token": me["csrf_token"]})
    assert out.status_code == 200
    assert client.get("/api/me").status_code == 401


def test_me_requires_login(client):
    assert client.get("/api/me").status_code == 401


def test_login_failure_does_not_reveal_whether_username_exists(client, make_user):
    u = make_user()
    wrong_pw = client.post("/api/login", json={"username": u.username, "password": "nope nope nope"})
    unknown = client.post("/api/login", json={"username": "nobody", "password": "nope nope nope"})
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json() == unknown.json()


def test_disabled_user_cannot_log_in(client, make_user, db):
    u = make_user()
    db.execute("UPDATE User SET active = 0 WHERE id = ?", (u.id,))
    db.commit()
    r = client.post("/api/login", json={"username": u.username, "password": u.password})
    assert r.status_code == 401


def test_disabling_user_ends_existing_session(client, make_user, login_as, db):
    u = make_user()
    c = login_as(u)
    db.execute("UPDATE User SET active = 0 WHERE id = ?", (u.id,))
    db.commit()
    assert c.get("/api/me").status_code == 401


def test_lockout_after_five_failures_until_fifteen_minutes_pass(client, make_user, clock):
    u = make_user()
    bad = {"username": u.username, "password": "wrong wrong wrong"}
    for _ in range(5):
        assert client.post("/api/login", json=bad).status_code == 401
    locked = client.post("/api/login", json={"username": u.username, "password": u.password})
    assert locked.status_code == 429
    assert "15 minutes" in locked.json()["detail"]
    clock.advance(minutes=14)
    assert client.post("/api/login", json={"username": u.username, "password": u.password}).status_code == 429
    clock.advance(minutes=1, seconds=1)
    assert client.post("/api/login", json={"username": u.username, "password": u.password}).status_code == 200


def test_lockout_is_per_username(client, make_user, clock):
    a, b = make_user(), make_user()
    for _ in range(5):
        client.post("/api/login", json={"username": a.username, "password": "wrong wrong wrong"})
    assert client.post("/api/login", json={"username": b.username, "password": b.password}).status_code == 200


def test_successful_login_resets_failure_count(client, make_user, clock):
    u = make_user()
    bad = {"username": u.username, "password": "wrong wrong wrong"}
    for _ in range(4):
        client.post("/api/login", json=bad)
    assert client.post("/api/login", json={"username": u.username, "password": u.password}).status_code == 200
    for _ in range(4):
        assert client.post("/api/login", json=bad).status_code == 401


def test_session_older_than_timeout_is_rejected(client, make_user, login_as, db, clock):
    u = make_user()
    c = login_as(u)
    clock.advance(hours=7)
    assert c.get("/api/me").status_code == 200  # default timeout is 8 hours of inactivity
    clock.advance(hours=8, seconds=1)
    assert c.get("/api/me").status_code == 401
    assert db.execute("SELECT COUNT(*) FROM Session").fetchone()[0] == 0


def test_session_timeout_comes_from_settings(client, make_user, login_as, db, clock):
    db.execute("INSERT INTO Setting (key, value) VALUES ('session_timeout_hours', '1')")
    db.commit()
    c = login_as(make_user())
    clock.advance(minutes=61)
    assert c.get("/api/me").status_code == 401


@pytest.fixture
def probe(app):
    @app.get("/api/_probe/edit", dependencies=[Depends(require("edit"))])
    def probe_get():
        return {"ok": True}

    @app.post("/api/_probe/edit", dependencies=[Depends(require("edit"))])
    def probe_post():
        return {"ok": True}

    @app.get("/api/_probe/admin", dependencies=[Depends(require("admin"))])
    def probe_admin():
        return {"ok": True}


def test_permission_checked_on_server(probe, make_user, login_as, client):
    assert client.get("/api/_probe/edit").status_code == 401
    reader = login_as(make_user({"read"}))
    assert reader.get("/api/_probe/edit").status_code == 403
    assert reader.get("/api/_probe/admin").status_code == 403
    editor = login_as(make_user({"read", "edit"}))
    assert editor.get("/api/_probe/edit").status_code == 200
    assert editor.get("/api/_probe/admin").status_code == 403
    assert login_as(make_user(admin=True)).get("/api/_probe/admin").status_code == 200


def test_mutating_request_needs_csrf_header(probe, make_user, login_as):
    c = login_as(make_user({"read", "edit"}))
    token = c.headers.pop("X-CSRF-Token")
    assert c.post("/api/_probe/edit").status_code == 403
    assert c.post("/api/_probe/edit", headers={"X-CSRF-Token": token + "x"}).status_code == 403
    assert c.post("/api/_probe/edit", headers={"X-CSRF-Token": token}).status_code == 200
    assert c.get("/api/_probe/edit").status_code == 200  # reads need no token


def test_require_rejects_unknown_permission():
    with pytest.raises(ValueError):
        require("bogus")
