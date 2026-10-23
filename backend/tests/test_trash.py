"""Deleted photo files go to <photos>/.deleted for 30 days, so a restore can bring them back."""
import io
import os
import time
from dataclasses import replace
from datetime import datetime, timezone

import pytest
from PIL import Image

from app import backup, trash
from app.db import connect

DAY = 24 * 3600


def png():
    buf = io.BytesIO()
    Image.new("RGB", (50, 50), (1, 2, 3)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def full(make_user, login_as, settings):
    os.makedirs(settings.photos_dir, exist_ok=True)
    os.makedirs(settings.backups_dir, exist_ok=True)
    return login_as(make_user({"read", "add", "edit", "delete"}))


def add_photo(full, pid=None):
    pid = pid or full.post("/api/people", json={"given_names": "Ann"}).json()["id"]
    aid = full.post(f"/api/people/{pid}/albums", json={"title": "A"}).json()["id"]
    r = full.post(f"/api/albums/{aid}/photos", files={"file": ("p.png", png(), "image/png")})
    assert r.status_code == 201, r.text
    return pid, aid, r.json()["id"]


def base_of(settings, photo_id):
    conn = connect(os.path.join(settings.data_dir, "family_tree.db"))
    try:
        return conn.execute("SELECT file_name FROM Photo WHERE id = ?", (photo_id,)).fetchone()[0]
    finally:
        conn.close()


def in_photos(settings):
    return sorted(f for f in os.listdir(settings.photos_dir) if not f.startswith("."))


def in_trash(settings):
    folder = os.path.join(settings.photos_dir, ".deleted")
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


@pytest.mark.parametrize("what", ["photo", "album", "person"])
def test_deleting_moves_the_files_to_the_trash(full, settings, what):
    pid, aid, photo = add_photo(full)
    base = base_of(settings, photo)
    path = {"photo": f"/api/photos/{photo}", "album": f"/api/albums/{aid}", "person": f"/api/people/{pid}?links=remove"}[what]
    assert full.delete(path).status_code == 204
    assert in_photos(settings) == []
    assert in_trash(settings) == sorted([f"{base}.jpg", f"{base}_thumb.jpg"])
    # the move counts as the deletion time, so the 30 days start now
    assert time.time() - os.path.getmtime(os.path.join(settings.photos_dir, ".deleted", f"{base}.jpg")) < 60


def test_a_name_already_in_the_trash_is_not_overwritten(full, settings):
    _, _, photo = add_photo(full)
    base = base_of(settings, photo)
    os.makedirs(os.path.join(settings.photos_dir, ".deleted"))
    with open(os.path.join(settings.photos_dir, ".deleted", f"{base}.jpg"), "wb") as f:
        f.write(b"older copy")
    assert full.delete(f"/api/photos/{photo}").status_code == 204
    names = in_trash(settings)
    assert len(names) == 3 and f"{base}.jpg" in names
    with open(os.path.join(settings.photos_dir, ".deleted", f"{base}.jpg"), "rb") as f:
        assert f.read() == b"older copy"


def test_nothing_is_written_locally_when_the_nas_is_offline(full, settings, app):
    _, _, photo = add_photo(full)
    marker = os.path.join(os.path.dirname(settings.photos_dir), "marker")
    app.state.settings = replace(settings, nas_marker=marker)  # marker missing: the NAS counts as offline
    assert full.delete(f"/api/photos/{photo}").status_code == 204
    assert not os.path.exists(os.path.join(settings.photos_dir, ".deleted"))
    assert len(in_photos(settings)) == 2  # left alone, never deleted outright


def test_purge_removes_only_trash_older_than_30_days(settings):
    folder = os.path.join(settings.photos_dir, ".deleted")
    os.makedirs(folder)
    for name, age_days in (("old.jpg", 31), ("new.jpg", 29)):
        path = os.path.join(folder, name)
        open(path, "wb").close()
        stamp = time.time() - age_days * DAY
        os.utime(path, (stamp, stamp))
    assert trash.purge(settings) == 1
    assert os.listdir(folder) == ["new.jpg"]


def test_purge_does_nothing_when_the_nas_is_offline(settings):
    folder = os.path.join(settings.photos_dir, ".deleted")
    os.makedirs(folder)
    path = os.path.join(folder, "old.jpg")
    open(path, "wb").close()
    os.utime(path, (0, 0))
    assert trash.purge(replace(settings, nas_marker=os.path.join(settings.photos_dir, "missing"))) == 0
    assert os.listdir(folder) == ["old.jpg"]


def test_each_backup_purges_the_trash_and_a_failed_purge_does_not_fail_it(full, settings, monkeypatch, make_user, login_as):
    folder = os.path.join(settings.photos_dir, ".deleted")
    os.makedirs(folder)
    old = os.path.join(folder, "old.jpg")
    open(old, "wb").close()
    os.utime(old, (0, 0))
    assert backup.run_and_record(settings, datetime.now(timezone.utc)).ok
    assert not os.path.exists(old)

    def broken(_settings):
        raise OSError("disk trouble")

    monkeypatch.setattr(trash, "purge", broken)
    assert backup.run_and_record(settings, datetime.now(timezone.utc)).ok
    r = login_as(make_user(admin=True)).post("/api/backup/run")  # "Back up now"
    assert r.status_code == 200 and r.json()["ok"] is True


def test_restore_brings_photo_files_back_from_the_trash(full, settings, client):
    _, _, keep = add_photo(full)
    _, _, gone = add_photo(full)
    lost_base, gone_base = base_of(settings, keep), base_of(settings, gone)
    result = backup.run_backup(settings, datetime.now(timezone.utc))
    assert result.ok
    assert full.delete(f"/api/photos/{gone}").status_code == 204
    for suffix in (".jpg", "_thumb.jpg"):  # a file lost some other way cannot be brought back
        os.remove(os.path.join(settings.photos_dir, lost_base + suffix))
    client.__exit__(None, None, None)  # stop the app: restore refuses while it runs

    summary = backup.restore_backup(settings, result.path)

    assert (summary["restored"], summary["missing"]) == (2, 2)
    assert in_photos(settings) == sorted([f"{gone_base}.jpg", f"{gone_base}_thumb.jpg"])
    assert in_trash(settings) == []


def test_restore_command_reports_the_photo_files(full, settings, client, capsys):
    _, _, gone = add_photo(full)
    result = backup.run_backup(settings, datetime.now(timezone.utc))
    full.delete(f"/api/photos/{gone}")
    client.__exit__(None, None, None)
    assert backup.main(["restore", result.path], settings=settings) == 0
    out = capsys.readouterr().out
    assert "2 photo files were brought back" in out


def test_the_trash_is_never_served(full, settings):
    _, _, photo = add_photo(full)
    base = base_of(settings, photo)
    full.delete(f"/api/photos/{photo}")
    conn = connect(os.path.join(settings.data_dir, "family_tree.db"))
    conn.execute("INSERT INTO Album (person_id, title) VALUES ((SELECT MIN(id) FROM Person), 'x')")
    conn.execute("INSERT INTO Photo (id, album_id, file_name) VALUES (500, last_insert_rowid(), ?)", (f".deleted/{base}",))
    conn.commit()
    conn.close()
    with open(os.path.join(settings.photos_dir, ".deleted", f"{base}.jpg"), "rb") as f:
        trashed = f.read()
    for kind in ("file", "thumb"):
        r = full.get(f"/api/photos/500/{kind}")
        assert r.content != trashed
        assert r.headers["cache-control"] == "no-store"  # the placeholder
    assert full.get(f"/api/photos/{photo}/file").status_code == 404
