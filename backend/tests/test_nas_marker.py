"""FAMILY_TREE_NAS_MARKER: while the marker file is missing, photos and backups count as offline even if
the folders exist (an unmounted share leaves empty local folders), and they recover by themselves."""
import io
import os
from dataclasses import replace
from datetime import datetime, timezone

import pytest
from PIL import Image

from app import backup
from app.config import load_settings, marker_missing
from app.db import connect, init_db


@pytest.fixture
def settings(tmp_path):
    from app.config import Settings
    nas = tmp_path / "nas"
    (nas / "photos").mkdir(parents=True)
    (nas / "backups").mkdir()
    return Settings(data_dir=str(tmp_path / "data"), photos_dir=str(nas / "photos"), backups_dir=str(nas / "backups"),
                    secret_key="k", nas_marker=str(nas / ".family-tree-nas-ok"))


def png():
    buf = io.BytesIO()
    Image.new("RGB", (50, 50), (1, 2, 3)).save(buf, "PNG")
    return buf.getvalue()


def test_env_var_sets_marker_and_default_is_no_check(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMILY_TREE_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("FAMILY_TREE_NAS_MARKER", raising=False)
    assert load_settings().nas_marker is None and marker_missing(load_settings()) is False
    monkeypatch.setenv("FAMILY_TREE_NAS_MARKER", "/nas/.family-tree-nas-ok")
    assert load_settings().nas_marker == "/nas/.family-tree-nas-ok"


def test_photo_upload_refused_without_marker_and_works_after_it_appears(make_user, login_as, settings):
    full = login_as(make_user({"read", "add", "edit", "delete"}))
    pid = full.post("/api/people", json={"given_names": "Ann"}).json()["id"]
    aid = full.post(f"/api/people/{pid}/albums", json={"title": "A"}).json()["id"]

    def upload():
        return full.post(f"/api/albums/{aid}/photos", files={"file": ("p.png", png(), "image/png")})

    r = upload()
    assert r.status_code == 503 and "offline" in r.json()["detail"]
    assert os.listdir(settings.photos_dir) == []  # nothing written into the unmounted folder
    assert full.get("/api/people").status_code == 200 and full.get("/api/health").status_code == 200
    open(settings.nas_marker, "w").close()  # the NAS comes back: no restart needed
    assert upload().status_code == 201
    assert len(os.listdir(settings.photos_dir)) == 2


def test_backup_refused_without_marker_and_status_warns_then_recovers(make_user, login_as, settings):
    admin = login_as(make_user(admin=True))
    now = datetime(2026, 12, 14, 2, 0, tzinfo=timezone.utc)
    result = backup.run_backup(settings, now)
    assert result.ok is False and "backups folder" in result.error
    assert os.listdir(settings.backups_dir) == []
    status = admin.get("/api/backup/status").json()
    assert status["nas_available"] is False and status["warning"]
    open(settings.nas_marker, "w").close()
    assert backup.run_backup(settings, now).ok is True
    assert admin.get("/api/backup/status").json()["nas_available"] is True


def test_command_line_backup_also_refuses_without_marker(settings, capsys):
    os.makedirs(settings.data_dir)
    conn = connect(os.path.join(settings.data_dir, "family_tree.db"))
    init_db(conn)
    conn.close()
    assert backup.main(["run"], settings) == 1
    assert "not available" in capsys.readouterr().err
    assert os.listdir(settings.backups_dir) == []
