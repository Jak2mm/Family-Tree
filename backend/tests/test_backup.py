import fcntl
import json
import os
import sqlite3
import subprocess
import sys
import threading
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import backup, settings_api
from app.backup import BackupResult, RestoreError, due_now, restore_backup, run_backup, scheduler_loop, tick
from app.db import connect, init_db
from app.main import create_app

UTC = timezone.utc
SYDNEY = ZoneInfo("Australia/Sydney")
BACKEND = os.path.dirname(os.path.dirname(__file__))


def at(h, m=0, day=14, tz=UTC):
    """2026-12-<day> is a Monday when day == 14."""
    return datetime(2026, 12, day, h, m, tzinfo=tz)


@pytest.fixture
def live(settings):
    """A live database with two people, created without starting the app."""
    os.makedirs(settings.data_dir, exist_ok=True)
    os.makedirs(settings.backups_dir, exist_ok=True)
    conn = connect(os.path.join(settings.data_dir, "family_tree.db"))
    init_db(conn)
    conn.execute("INSERT INTO User (username, password_hash) VALUES ('ann', 'SECRET-HASH-VALUE')")
    conn.execute("INSERT INTO Person (id, given_names, family_name, bio, birth_place) VALUES (1, 'Ann', 'Lee', 'Loved gardening', 'Perth')")
    conn.execute("INSERT INTO Person (id, given_names, family_name, bio) VALUES (2, 'Bob', 'Lee', 'A baker')")
    conn.execute("INSERT INTO ParentLink (parent_id, child_id, kind) VALUES (1, 2, 'biological')")
    conn.execute("INSERT INTO Partnership (person_a_id, person_b_id, kind, start_year) VALUES (1, 2, 'partner', 1990)")
    conn.execute("INSERT INTO PlaceLived (person_id, place, from_year) VALUES (1, 'Hobart', 1980)")
    conn.execute("INSERT INTO Album (id, person_id, title) VALUES (1, 1, 'Holidays')")
    conn.execute("INSERT INTO Photo (album_id, file_name, caption, year) VALUES (1, 'abc', 'At the beach', 1985)")
    conn.execute("INSERT INTO Session (token, user_id, csrf_token, created_at, last_seen_at) VALUES ('SESSION-TOKEN', 1, 'c', 'x', 'x')")
    conn.commit()
    conn.close()
    return settings


def people_count(path):
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT COUNT(*) FROM Person").fetchone()[0]
    finally:
        c.close()


def backups_in(settings):
    return sorted(f for f in os.listdir(settings.backups_dir) if f.endswith(".db"))


def live_path(settings):
    return os.path.join(settings.data_dir, "family_tree.db")


# ---- run_backup ----

def test_run_backup_makes_a_good_copy_named_by_local_time(live):
    sydney = replace(live, timezone="Australia/Sydney")
    result = run_backup(sydney, datetime(2026, 12, 14, 15, 30, 5, tzinfo=UTC))  # 02:30:05 next day in Sydney
    assert result.ok and result.error is None
    assert os.path.basename(result.path) == "family-tree-20261215-023005.db"
    assert result.size == os.path.getsize(result.path) > 0
    c = sqlite3.connect(result.path)
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    c.close()
    assert people_count(result.path) == 2
    assert not [f for f in os.listdir(live.backups_dir) if f.endswith(".tmp")]


def test_export_lists_people_and_links_but_no_secrets(live):
    result = run_backup(live, at(2))
    export_path = result.path[:-3] + "-export.json"
    text = Path(export_path).read_text()
    data = json.loads(text)
    assert {p["given_names"]: p["bio"] for p in data["people"]} == {"Ann": "Loved gardening", "Bob": "A baker"}
    assert data["parent_links"] == [{"parent_id": 1, "child_id": 2, "kind": "biological"}]
    assert data["partnerships"][0]["start_year"] == 1990
    assert data["places_lived"][0]["place"] == "Hobart"
    assert data["albums"][0]["title"] == "Holidays"
    assert data["albums"][0]["photos"][0]["caption"] == "At the beach"
    assert data["albums"][0]["photos"][0]["year"] == 1985
    for secret in ("SECRET-HASH-VALUE", "SESSION-TOKEN", "password", "users"):
        assert secret not in text


def test_retention_keeps_newest_pairs_and_leaves_other_files_alone(live):
    for name in ("notes.txt", "family-tree-old.db", "family-tree-20200101-000000.db.bak", "other-export.json"):
        Path(live.backups_dir, name).write_text("keep me")
    for i in range(16):
        assert run_backup(live, at(2) + timedelta(days=i)).ok
    kept = [f for f in backups_in(live) if f.startswith("family-tree-2026")]
    assert len(kept) == 14
    assert kept[-1] == "family-tree-20261229-020000.db"
    assert "family-tree-20261214-020000.db" not in kept and "family-tree-20261215-020000.db" not in kept
    exports = [f for f in os.listdir(live.backups_dir) if f.endswith("-export.json") and f.startswith("family-tree-2026")]
    assert len(exports) == 14
    assert "family-tree-20261214-020000-export.json" not in exports
    for name in ("notes.txt", "family-tree-old.db", "family-tree-20200101-000000.db.bak", "other-export.json"):
        assert os.path.exists(os.path.join(live.backups_dir, name))


def test_retention_setting_is_respected(live):
    conn = connect(live_path(live))
    conn.execute("INSERT INTO Setting (key, value) VALUES ('backup_retention', '2')")
    conn.commit()
    conn.close()
    for i in range(4):
        run_backup(live, at(2) + timedelta(days=i))
    assert len(backups_in(live)) == 2


def test_failed_integrity_or_count_check_is_not_ok_and_leaves_no_backup(live, monkeypatch):
    monkeypatch.setattr(backup, "_count_people", lambda path: 99 if "family-tree-" in path else 2)
    result = run_backup(live, at(2))
    assert not result.ok and "check" in result.error.lower()
    assert backups_in(live) == []
    assert os.listdir(live.backups_dir) == []


def test_missing_folder_gives_plain_error_without_raising(live):
    gone = replace(live, backups_dir=os.path.join(live.backups_dir, "nope"))
    result = run_backup(gone, at(2))
    assert result == BackupResult(ok=False, path=None, size=0, error=result.error)
    assert "backups folder" in result.error and "NAS" in result.error
    assert not os.path.exists(gone.backups_dir)  # a missing NAS mount must not be quietly recreated as a local folder


def test_folder_that_is_a_file_gives_plain_error(live, tmp_path):
    f = tmp_path / "afile"
    f.write_text("x")
    result = run_backup(replace(live, backups_dir=str(f)), at(2))
    assert not result.ok and "backups folder" in result.error


def test_read_only_folder_gives_plain_error(live, monkeypatch):
    real = os.access
    monkeypatch.setattr(os, "access", lambda p, mode, *a, **k: False if str(p) == live.backups_dir and mode == os.W_OK else real(p, mode, *a, **k))
    result = run_backup(live, at(2))
    assert not result.ok and "read-only" in result.error
    assert os.listdir(live.backups_dir) == []


def test_write_failure_midway_leaves_no_partial_files(live, monkeypatch):
    def refuse(src, dst):
        raise OSError(30, "Read-only file system")

    monkeypatch.setattr(os, "replace", refuse)
    result = run_backup(live, at(2))
    assert not result.ok and result.error
    assert os.listdir(live.backups_dir) == []


# ---- due_now ----

def test_due_at_scheduled_time_once_per_day():
    assert not due_now(["02:00"], None, None, at(1, 59))
    assert due_now(["02:00"], None, None, at(2, 0))
    assert due_now(["02:00"], None, at(2, 0) - timedelta(days=1), at(2, 0))
    assert not due_now(["02:00"], None, at(2, 0), at(2, 1))
    assert not due_now(["02:00"], None, at(2, 0), at(23, 59))


def test_missed_time_runs_once_at_next_tick():
    assert due_now(["02:00"], None, at(2) - timedelta(days=1), at(9, 30))
    assert not due_now(["02:00"], None, at(9, 30), at(9, 31))


def test_several_times_a_day():
    times = ["02:00", "14:00"]
    assert not due_now(times, None, at(2, 1), at(13, 59))
    assert due_now(times, None, at(2, 1), at(14, 0))
    assert not due_now(times, None, at(14, 0), at(20, 0))


def test_not_due_on_other_weekdays():
    monday, tuesday = at(3, day=14), at(3, day=15)
    assert due_now(["02:00"], [0], None, monday)
    assert not due_now(["02:00"], [0], None, tuesday)
    assert not due_now(["02:00"], [], None, monday)


def test_schedule_is_read_in_the_configured_zone():
    # 02:00 Sydney (UTC+11 in December) is 15:00 UTC the day before.
    before = datetime(2026, 12, 14, 1, 59, tzinfo=SYDNEY)
    start = datetime(2026, 12, 14, 2, 0, tzinfo=SYDNEY)
    assert start.astimezone(UTC).hour == 15
    assert not due_now(["02:00"], None, None, before)
    assert due_now(["02:00"], None, None, start)
    # A run made at 14:59 UTC on the 13th (01:59 Sydney, 14th) is before the slot, so it is still due.
    assert due_now(["02:00"], None, datetime(2026, 12, 13, 14, 59, tzinfo=UTC), start)
    assert not due_now(["02:00"], None, datetime(2026, 12, 13, 15, 0, tzinfo=UTC), start)


def test_scheduler_uses_the_configured_zone(live):
    sydney = replace(live, timezone="Australia/Sydney")
    tick(sydney, datetime(2026, 12, 13, 14, 59, tzinfo=UTC))  # 01:59 Sydney
    assert backups_in(sydney) == []
    tick(sydney, datetime(2026, 12, 13, 15, 0, tzinfo=UTC))  # 02:00 Sydney
    assert backups_in(sydney) == ["family-tree-20261214-020000.db"]


# ---- scheduler: NAS folder missing, then back ----

def test_nas_missing_app_keeps_working_then_next_tick_after_it_returns_succeeds(live, make_user, login_as, client):
    folder = live.backups_dir
    hidden = folder + ".offline"
    os.rename(folder, hidden)  # the NAS drops off
    admin = login_as(make_user(admin=True))

    tick(live, at(2, 0))  # scheduled run fails
    status = admin.get("/api/backup/status").json()
    assert status["ok"] is False and status["nas_available"] is False
    assert "backups folder" in status["error"]
    assert status["retry"]["retrying"] is True
    assert admin.get("/api/people").status_code == 200  # the app keeps serving
    assert admin.get("/api/health").status_code == 200

    tick(live, at(2, 1))  # too soon to retry
    tick(live, at(2, 14))
    assert admin.get("/api/backup/status").json()["last_run"] == status["last_run"]

    tick(live, at(2, 15))  # still offline: another failure, schedule not reset
    again = admin.get("/api/backup/status").json()
    assert again["ok"] is False and again["last_run"] != status["last_run"]

    os.rename(hidden, folder)  # the NAS returns
    tick(live, at(2, 29))  # not yet 15 minutes since the last failed attempt
    assert backups_in(live) == []
    tick(live, at(2, 30))
    assert backups_in(live) == ["family-tree-20261214-023000.db"]
    good = admin.get("/api/backup/status").json()
    assert good["ok"] is True and good["nas_available"] is True and good["retry"]["retrying"] is False
    assert good["error"] is None

    tick(live, at(2, 31))  # back to the normal schedule: nothing more today
    tick(live, at(23, 0))
    assert len(backups_in(live)) == 1


def test_read_only_folder_then_writable_recovers(live, monkeypatch):
    real = os.access
    state = {"ro": True}
    monkeypatch.setattr(os, "access", lambda p, mode, *a, **k: False if state["ro"] and str(p) == live.backups_dir and mode == os.W_OK else real(p, mode, *a, **k))
    tick(live, at(2, 0))
    assert backups_in(live) == []
    state["ro"] = False
    tick(live, at(2, 15))
    assert len(backups_in(live)) == 1


def test_manual_run_counts_as_todays_run(live):
    assert backup.run_and_record(live, at(2, 5)).ok  # "Back up now" after the 02:00 slot has passed
    tick(live, at(2, 6))
    tick(live, at(23, 0))
    assert len(backups_in(live)) == 1


def test_scheduler_loop_drives_ticks_with_a_fake_clock_and_stops(live, monkeypatch):
    clock_times = iter([at(1, 59), at(2, 0), at(2, 1)])
    stop = threading.Event()
    sleeps = []
    ticks = []

    def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 3:
            stop.set()

    def periodic(settings, now):
        ticks.append(now)

    scheduler_loop(live, stop, clock=lambda: next(clock_times), sleep=sleep, periodic=(periodic,))
    assert sleeps == [60, 60, 60]
    assert len(ticks) == 3
    assert backups_in(live) == ["family-tree-20261214-020000.db"]


def test_scheduler_loop_survives_a_failing_tick(live, monkeypatch):
    calls = []
    stop = threading.Event()

    def boom(settings, now):
        calls.append(now)
        raise RuntimeError("database is locked")

    monkeypatch.setattr(backup, "tick", boom)
    scheduler_loop(live, stop, clock=lambda: at(2), sleep=lambda s: stop.set() if len(calls) == 2 else None)
    assert len(calls) == 2


def test_app_starts_and_stops_its_scheduler_thread(settings, monkeypatch):
    monkeypatch.setattr(settings_api.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, '{"dependencies": []}', ""))
    app = create_app(settings, start_scheduler=True)
    with TestClient(app) as c:
        thread = app.state.scheduler_thread
        assert thread.is_alive() and thread.daemon
        assert c.get("/api/health").status_code == 200
    thread.join(timeout=5)
    assert not thread.is_alive()


def test_app_without_scheduler_has_no_thread(app, client):
    assert getattr(app.state, "scheduler_thread", None) is None


# ---- restore ----

def test_restore_replaces_live_database_and_keeps_the_old_one(live):
    result = run_backup(live, at(2))
    conn = connect(live_path(live))
    conn.execute("INSERT INTO Person (given_names) VALUES ('Carl')")
    conn.execute("DELETE FROM Person WHERE id = 1")
    conn.commit()
    conn.close()
    assert people_count(live_path(live)) == 2

    restore_backup(live, result.path)

    assert people_count(live_path(live)) == 2
    c = sqlite3.connect(live_path(live))
    assert sorted(r[0] for r in c.execute("SELECT given_names FROM Person")) == ["Ann", "Bob"]
    c.close()
    before = live_path(live) + ".before-restore"
    c = sqlite3.connect(before)
    assert sorted(r[0] for r in c.execute("SELECT given_names FROM Person")) == ["Bob", "Carl"]
    c.close()
    # The restored database opens normally with no stale write-ahead files.
    assert not os.path.exists(live_path(live) + "-wal")
    conn = connect(live_path(live))
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()


def test_restore_works_when_live_database_is_missing(live, tmp_path):
    result = run_backup(live, at(2))
    os.remove(live_path(live))
    restore_backup(live, result.path)
    assert people_count(live_path(live)) == 2
    assert not os.path.exists(live_path(live) + ".before-restore")


def test_restore_rejects_files_that_are_not_good_backups(live, tmp_path):
    junk = tmp_path / "junk.db"
    junk.write_bytes(b"this is not a database at all" * 100)
    empty_db = tmp_path / "empty.db"
    sqlite3.connect(empty_db).execute("CREATE TABLE x (a)").connection.close()
    for bad in (str(junk), str(empty_db), str(tmp_path / "missing.db")):
        with pytest.raises(RestoreError):
            restore_backup(live, bad)
    assert people_count(live_path(live)) == 2
    assert not os.path.exists(live_path(live) + ".before-restore")


def lock_file(settings):
    return os.path.join(settings.data_dir, "family_tree.lock")


def test_restore_refuses_while_another_process_holds_the_app_lock(live):
    result = run_backup(live, at(2))
    before = Path(live_path(live)).read_bytes()
    with open(lock_file(live), "w") as held:  # what a running app does
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(RestoreError, match="stop"):
            restore_backup(live, result.path)
    assert Path(live_path(live)).read_bytes() == before
    restore_backup(live, result.path)  # lock released: now it works
    assert people_count(live_path(live)) == 2


def test_app_lifespan_holds_the_lock_until_shutdown(settings, app):
    with TestClient(app):
        with open(lock_file(settings), "w") as probe:
            with pytest.raises(BlockingIOError):
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
    with open(lock_file(settings), "w") as probe:
        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)  # released at shutdown


def test_failed_final_rename_leaves_live_database_and_wal_untouched(live, monkeypatch):
    result = run_backup(live, at(2))
    holder = connect(live_path(live))  # keeps -wal/-shm alive, as a running app would
    holder.execute("INSERT INTO Person (given_names) VALUES ('Carl')")
    holder.commit()
    wal, shm = live_path(live) + "-wal", live_path(live) + "-shm"
    assert os.path.exists(wal) and os.path.exists(shm)
    wal_bytes = Path(wal).read_bytes()
    real = os.replace

    def failing(src, dst, *a, **k):
        if str(dst) == live_path(live):
            raise OSError(5, "Input/output error")
        return real(src, dst, *a, **k)

    monkeypatch.setattr(os, "replace", failing)
    with pytest.raises(RestoreError) as err:
        restore_backup(live, result.path)
    assert "original database was left in place" in str(err.value) and "Traceback" not in str(err.value)
    assert os.path.exists(wal) and os.path.exists(shm) and Path(wal).read_bytes() == wal_bytes
    assert holder.execute("SELECT COUNT(*) FROM Person").fetchone()[0] == 3
    holder.close()
    assert not os.path.exists(live_path(live) + ".restoring")


# ---- daylight saving (Australia/Sydney: forward 2026-10-04, back 2027-04-04) ----

def run_night(settings, first_day, start_utc, times, hours=6):
    """13 earlier good daily backups, then one tick a minute across the night. Returns (earlier, new) backup names."""
    conn = connect(live_path(settings))
    conn.execute("INSERT INTO Setting (key, value) VALUES ('backup_times', ?)", (json.dumps(times),))
    conn.commit()
    conn.close()
    sydney = ZoneInfo("Australia/Sydney")
    hour, minute = map(int, times[0].split(":"))
    for i in range(13, 0, -1):
        day = first_day - timedelta(days=i)
        assert backup.run_and_record(settings, datetime(day.year, day.month, day.day, hour, minute, tzinfo=sydney)).ok
    earlier = set(backups_in(settings))
    assert len(earlier) == 13
    for m in range(hours * 60):
        tick(settings, start_utc + timedelta(minutes=m))
    return earlier, set(backups_in(settings)) - earlier, set(backups_in(settings))


SPRING = (datetime(2026, 10, 4).date(), datetime(2026, 10, 3, 14, 0, tzinfo=UTC))  # 00:00 AEST on the 4th
FALL = (datetime(2027, 4, 4).date(), datetime(2027, 4, 3, 13, 0, tzinfo=UTC))      # 00:00 AEDT on the 4th


@pytest.mark.parametrize("day,start", [SPRING, FALL], ids=["spring-forward", "fall-back"])
@pytest.mark.parametrize("slot", ["02:30", "02:00"])
def test_scheduled_time_in_a_dst_change_runs_exactly_once_and_keeps_history(live, day, start, slot):
    sydney = replace(live, timezone="Australia/Sydney")
    earlier, new, everything = run_night(sydney, day, start, [slot], hours=8)
    assert len(new) == 1, sorted(new)
    assert earlier <= everything and len(everything) == 14


# ---- CLI ----

def test_cli_run_and_restore(live, capsys):
    assert backup.main(["run"], live) == 0
    path = os.path.join(live.backups_dir, backups_in(live)[0])
    assert backup.main(["restore", path], live) == 0
    assert backup.main(["restore", path + ".nope"], live) == 1
    assert capsys.readouterr().err.strip() != ""


def test_cli_run_failure_exits_1_with_message_on_stderr(live, tmp_path):
    env = {
        **os.environ,
        "FAMILY_TREE_DATA_DIR": live.data_dir,
        "FAMILY_TREE_BACKUPS_DIR": str(tmp_path / "no-such-nas"),
        "FAMILY_TREE_SECRET_KEY": "x",
        "PYTHONPATH": BACKEND,
    }
    p = subprocess.run([sys.executable, "-m", "app.backup", "run"], env=env, capture_output=True, text=True, cwd=BACKEND)
    assert p.returncode == 1 and "backups folder" in p.stderr
    env["FAMILY_TREE_BACKUPS_DIR"] = live.backups_dir
    p = subprocess.run([sys.executable, "-m", "app.backup", "run"], env=env, capture_output=True, text=True, cwd=BACKEND)
    assert p.returncode == 0, p.stderr
