import itertools
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import connect
from app.main import create_app
from app.security import hash_password

ALL_PERMS = {"read", "add", "edit", "delete"}


@pytest.fixture
def settings(tmp_path):
    return Settings(
        data_dir=str(tmp_path / "data"),
        photos_dir=str(tmp_path / "photos"),
        backups_dir=str(tmp_path / "backups"),
        secret_key="test-secret",
    )


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def make_user(client, settings):
    """Create a user directly in the database; returns an object with id, username, password."""
    counter = itertools.count(1)

    def _make(perms: set[str] | None = None, *, admin: bool = False):
        perms = ALL_PERMS if admin else (perms if perms is not None else {"read"})
        username = f"user{next(counter)}"
        password = "correct horse battery"
        conn = connect(os.path.join(settings.data_dir, "family_tree.db"))
        cur = conn.execute(
            "INSERT INTO User (username, password_hash, is_admin, can_read, can_add, can_edit, can_delete)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (username, hash_password(password), int(admin), *(int(p in perms) for p in ("read", "add", "edit", "delete"))),
        )
        conn.commit()
        conn.close()
        return SimpleNamespace(id=cur.lastrowid, username=username, password=password)

    return _make


@pytest.fixture
def login_as(app, client):
    """Return a new test client signed in as the given user, with session cookie and CSRF header set."""

    def _login(user):
        c = TestClient(app)
        r = c.post("/api/login", json={"username": user.username, "password": user.password})
        assert r.status_code == 200, r.text
        c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        return c

    return _login
