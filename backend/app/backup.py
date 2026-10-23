"""Scheduled backups of the live database to the backups folder, and restore.

Photos are already on the NAS and are not copied. Command line:
    python -m app.backup run              take a backup now
    python -m app.backup restore <file>   replace the live database (stop the app first)
"""
import argparse
import fcntl
import json
import logging
import os
import re
import shutil
import sqlite3
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

from app import trash
from app.config import Settings, load_settings, marker_missing, zone_for
from app.db import SCHEMA, connect
from app.restore import RestoreError, restore_backup  # noqa: F401 (restore_backup is part of this module's command line)

log = logging.getLogger(__name__)

TICK_SECONDS = 60
RETRY_AFTER = timedelta(minutes=15)
DEFAULT_TIMES = ["02:00"]
DEFAULT_RETENTION = 14
_PAIR = re.compile(r"^(family-tree-\d{8}-\d{6})(?:\.db|-export\.json)$")  # only files this app made
_TABLES = set(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", SCHEMA))
_lock = threading.Lock()  # one backup at a time (scheduler and "Back up now")


@dataclass(frozen=True)
class BackupResult:
    ok: bool
    path: str | None
    size: int
    error: str | None


class _BackupError(Exception):
    pass


def live_path(settings: Settings) -> str:
    return os.path.join(settings.data_dir, "family_tree.db")


def lock_path(settings: Settings) -> str:
    return os.path.join(settings.data_dir, "family_tree.lock")


def acquire_app_lock(settings: Settings):
    """Take the exclusive lock a running app holds for its whole life; returns the open file (close it to release)."""
    f = open(lock_path(settings), "a")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        raise RestoreError("The app is already running against this data folder. Stop it first.") from None
    return f


# ---- stored settings and state (Setting rows) ----

def read_setting(conn: sqlite3.Connection, key: str):
    row = conn.execute("SELECT value FROM Setting WHERE key = ?", (key,)).fetchone()
    try:
        return json.loads(row[0]) if row else None
    except ValueError:
        return None


def write_setting(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute("INSERT INTO Setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, json.dumps(value)))


def load_schedule(conn: sqlite3.Connection) -> tuple[list[str], list[int] | None, int]:
    """(times, weekdays or None for every day, retention); malformed stored values fall back to the defaults."""
    times, days, keep = read_setting(conn, "backup_times"), read_setting(conn, "backup_days"), read_setting(conn, "backup_retention")
    if not (isinstance(times, list) and times and all(isinstance(t, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t) for t in times)):
        times = DEFAULT_TIMES
    if not (isinstance(days, list) and all(type(d) is int and 0 <= d <= 6 for d in days)):
        days = None
    if not (type(keep) is int and 1 <= keep <= 365):
        keep = DEFAULT_RETENTION
    return times, days, keep


# ---- schedule ----

def _slot_instant(day, text: str, zone) -> datetime:
    """The UTC instant of a local wall-clock time. A time skipped by the clocks going forward means the first
    moment after the gap; a time that happens twice (clocks going back) means its first occurrence."""
    hour, minute = map(int, text.split(":"))
    wall = datetime.combine(day, time(hour, minute))
    instant = wall.replace(tzinfo=zone, fold=0).astimezone(timezone.utc)
    if instant.astimezone(zone).replace(tzinfo=None) != wall:  # the time does not exist: step back to the end of the gap
        while (instant - timedelta(minutes=1)).astimezone(zone).replace(tzinfo=None) >= wall:
            instant -= timedelta(minutes=1)
        while instant.astimezone(zone).replace(tzinfo=None) < wall:
            instant += timedelta(minutes=1)
    return instant


def due_now(schedule: list[str], days: list[int] | None, last_run: datetime | None, now: datetime) -> bool:
    """True once a scheduled time today has passed with no run since it. All datetimes are aware; they are
    compared as instants, never as wall-clock readings."""
    zone = now.tzinfo
    if days is not None and now.weekday() not in days:
        return False
    for text in schedule:
        slot = _slot_instant(now.date(), text, zone)
        if now >= slot and (last_run is None or last_run.astimezone(timezone.utc) < slot):
            return True
    return False


def next_run(schedule: list[str], days: list[int] | None, now: datetime) -> datetime | None:
    for offset in range(8):
        day = (now + timedelta(days=offset)).date()
        if days is not None and day.weekday() not in days:
            continue
        for slot in sorted(_slot_instant(day, text, now.tzinfo) for text in schedule):
            if slot > now:
                return slot.astimezone(now.tzinfo)
    return None


def tick(settings: Settings, now: datetime) -> None:
    """One scheduler check: run a backup if one is due, or retry a failed one every 15 minutes."""
    local = now.astimezone(zone_for(settings))
    conn = connect(live_path(settings))
    try:
        times, days, _ = load_schedule(conn)
        last, last_ok = read_setting(conn, "backup_last"), read_setting(conn, "backup_last_ok")
    finally:
        conn.close()
    if isinstance(last, dict) and last.get("ok") is False:
        due = now >= datetime.fromisoformat(last["at"]).astimezone(timezone.utc) + RETRY_AFTER  # a failed retry leaves the daily schedule alone
    else:
        due = due_now(times, days, datetime.fromisoformat(last_ok) if last_ok else None, local)
    if due:
        run_and_record(settings, local)


def scheduler_loop(settings: Settings, stop: threading.Event, clock: Callable[[], datetime] | None = None,
                   sleep: Callable[[float], object] | None = None, periodic: tuple[Callable[[Settings, datetime], None], ...] = ()) -> None:
    clock = clock or (lambda: datetime.now(timezone.utc))
    sleep = sleep or stop.wait
    while not stop.is_set():
        now = clock()
        for job in (tick, *periodic):
            try:
                job(settings, now)
            except Exception:
                log.exception("Scheduled job %s failed; will try again at the next check.", getattr(job, "__name__", job))
        sleep(TICK_SECONDS)


# ---- backup ----

def run_and_record(settings: Settings, now: datetime) -> BackupResult:
    """Run a backup and store the outcome where the status endpoint and scheduler read it."""
    with _lock:
        result = run_backup(settings, now)
        try:
            trash.purge(settings)  # deleted photos older than 30 days; a problem here never fails the backup
        except Exception:
            log.exception("Could not clear old deleted photos")
        if os.path.isfile(live_path(settings)):
            at = now.astimezone(zone_for(settings)).isoformat()
            conn = connect(live_path(settings))
            try:
                write_setting(conn, "backup_last", {"at": at, "ok": result.ok, "size": result.size, "error": result.error, "path": result.path})
                if result.ok:
                    write_setting(conn, "backup_last_ok", at)
                conn.commit()
            finally:
                conn.close()
        return result


def _folder_problem(folder: str, settings: Settings | None = None) -> str | None:
    if settings is not None and marker_missing(settings):
        return "The backups folder is not available. Check that the NAS is switched on and connected."
    if not os.path.exists(folder):
        return "The backups folder is not available. Check that the NAS is switched on and connected."
    if not os.path.isdir(folder):
        return "The backups folder path is not a folder. Check the backups setting."
    if not os.access(folder, os.W_OK):
        return "The backups folder is read-only. Check the NAS share permissions."
    return None


def _count_people(path: str) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT COUNT(*) FROM Person").fetchone()[0]
    finally:
        conn.close()


def _snapshot(source: str, target: str) -> None:
    """Consistent copy of a database (SQLite online backup), left as a single self-contained file."""
    src, dst = sqlite3.connect(source), sqlite3.connect(target)
    try:
        src.backup(dst)
        dst.execute("PRAGMA journal_mode = DELETE")
    finally:
        dst.close()
        src.close()


def _write_export(db_path: str, out_path: str) -> None:
    """Readable JSON of the family data. Deliberately leaves out users, password hashes and sessions."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    def rows(sql):
        return [dict(r) for r in conn.execute(sql)]

    try:
        albums = rows("SELECT * FROM Album ORDER BY id")
        photos = rows("SELECT id, album_id, file_name, caption, year FROM Photo ORDER BY id")
        for album in albums:
            album["photos"] = [p for p in photos if p["album_id"] == album["id"]]
        data = {
            "people": rows("SELECT * FROM Person ORDER BY id"),
            "places_lived": rows("SELECT * FROM PlaceLived ORDER BY id"),
            "parent_links": rows("SELECT parent_id, child_id, kind FROM ParentLink ORDER BY parent_id, child_id"),
            "partnerships": rows("SELECT * FROM Partnership ORDER BY id"),
            "albums": albums,
        }
    finally:
        conn.close()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _prune(folder: str, keep: int) -> None:
    stems = sorted({m.group(1) for name in os.listdir(folder) if (m := _PAIR.match(name))}, reverse=True)
    for stem in stems[keep:]:
        for suffix in (".db", "-export.json"):
            try:
                os.remove(os.path.join(folder, stem + suffix))
            except OSError:
                log.warning("Could not remove old backup %s%s", stem, suffix)


def run_backup(settings: Settings, now: datetime) -> BackupResult:
    """Back up the live database into the backups folder. Never raises: problems come back as ok=False."""
    live, folder = live_path(settings), settings.backups_dir
    problem = _folder_problem(folder, settings)
    if problem is None and not os.path.isfile(live):
        problem = "The family tree database could not be found."
    if problem:
        return BackupResult(False, None, 0, problem)
    base = "family-tree-" + now.astimezone(zone_for(settings)).strftime("%Y%m%d-%H%M%S")
    final_db, final_json = (os.path.join(folder, base + s) for s in (".db", "-export.json"))
    tmp_db, tmp_json = (os.path.join(folder, f".{base}{s}.tmp") for s in (".db", "-export.json"))
    try:
        _snapshot(live, tmp_db)
        check = sqlite3.connect(tmp_db)
        try:
            intact = check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        finally:
            check.close()
        live_conn = connect(live)
        try:
            same = _count_people(tmp_db) == live_conn.execute("SELECT COUNT(*) FROM Person").fetchone()[0]
        finally:
            live_conn.close()
        if not (intact and same):
            raise _BackupError("The new backup failed its safety check, so it was not kept. It will be tried again.")
        _write_export(tmp_db, tmp_json)
        os.replace(tmp_json, final_json)
        os.replace(tmp_db, final_db)  # the .db appearing means the backup is complete
        keep = load_schedule(live_conn := connect(live))[2]
        live_conn.close()
        _prune(folder, keep)
        return BackupResult(True, final_db, os.path.getsize(final_db), None)
    except _BackupError as e:
        return BackupResult(False, None, 0, str(e))
    except (OSError, sqlite3.Error) as e:
        return BackupResult(False, None, 0, f"The backup could not be written ({e}). Check the NAS and try again.")
    finally:
        for leftover in (tmp_db, tmp_json) + (() if os.path.exists(final_db) else (final_json,)):
            try:
                os.remove(leftover)
            except OSError:
                pass


# ---- restore: see app/restore.py ----

def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.backup")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run", help="take a backup now")
    sub.add_parser("restore", help="replace the live database (stop the app first)").add_argument("file")
    args = parser.parse_args(argv)
    settings = settings or load_settings()
    try:
        if args.command == "run":
            result = run_and_record(settings, datetime.now(timezone.utc))
            if not result.ok:
                raise RestoreError(result.error)
            print(f"Backup saved to {result.path}")
        else:
            photos = restore_backup(settings, args.file)
            print("Restored. The previous database was kept as family_tree.db.before-restore. You can start the app again.")
            if marker_missing(settings):
                print("The NAS is offline, so deleted photos could not be brought back. Run the restore again when it is online.")
            if photos["restored"]:
                print(f"{photos['restored']} photo files were brought back from the deleted-photos folder.")
            if photos["missing"]:
                print(f"{photos['missing']} photo files could not be found; those photos will show a placeholder.")
    except RestoreError as e:
        print(str(e), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
