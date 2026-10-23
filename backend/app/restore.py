"""Restore the live database from a backup (command line: python -m app.backup restore <file>)."""
import os
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app import trash
from app.config import Settings, marker_missing, zone_for
from app.db import connect


class RestoreError(Exception):
    """A restore was refused; the message is plain language for the person running it."""


def _open_readonly(path: str) -> sqlite3.Connection:
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)


def _validate(path: str) -> None:
    from app.backup import _TABLES  # imported here: app.backup imports this module
    if not os.path.isfile(path):
        raise RestoreError("That backup file could not be found.")
    try:
        conn = _open_readonly(path)
        try:
            ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        ok, tables = False, set()
    if not ok or not _TABLES <= tables:
        raise RestoreError("That file is not a complete family tree backup, so nothing was changed.")


def restore_backup(settings: Settings, path: str) -> dict[str, int]:
    """Replace the live database with a backup. The old one is kept next to it as <name>.before-restore-<time>.
    Photo files the backup needs are brought back from the deleted-photos folder; returns the counts."""
    from app.backup import acquire_app_lock, live_path

    os.makedirs(settings.data_dir, exist_ok=True)
    try:
        lock = acquire_app_lock(settings)
    except RestoreError:
        raise RestoreError("The app is running. Please stop it first, then restore, then start it again.") from None
    try:
        if marker_missing(settings):  # checked before anything is touched, so a later run has nothing to undo
            raise RestoreError(
                "The NAS is offline, so deleted photos could not be brought back. "
                "Mount it and run the restore again; nothing was changed."
            )
        before = _restore_locked(settings, path)
        conn = connect(live_path(settings))
        try:
            bases = [r[0] for r in conn.execute("SELECT file_name FROM Photo") if r[0]]
        finally:
            conn.close()
        return {**trash.bring_back(settings, bases), "before": before}
    finally:
        lock.close()


def _before_name(settings: Settings, live: str) -> str:
    """A new name for the copy of the database being replaced; an earlier copy is never overwritten."""
    stamp = datetime.now(timezone.utc).astimezone(zone_for(settings)).strftime("%Y%m%d-%H%M%S")
    name, n = f"{live}.before-restore-{stamp}", 1
    while os.path.exists(name):
        n += 1
        name = f"{live}.before-restore-{stamp}-{n}"
    return name


def _restore_locked(settings: Settings, path: str) -> str | None:
    """Returns the path of the copy kept of the replaced database (None if there was none)."""
    from app.backup import _snapshot, live_path
    live = live_path(settings)
    before = None
    _validate(path)
    staged = live + ".restoring"
    try:
        src = _open_readonly(path)
        dst = sqlite3.connect(staged)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        if os.path.exists(live):
            before = _before_name(settings, live)
            try:
                _snapshot(live, before + ".tmp")
            except sqlite3.DatabaseError:  # a damaged live database is a reason to restore, so copy it as it is
                shutil.copy2(live, before + ".tmp")
            os.replace(before + ".tmp", before)
        os.replace(staged, live)
        for extra in ("-wal", "-shm"):  # only now: leftovers from the old database must not be applied to the new one
            if os.path.exists(live + extra):
                os.remove(live + extra)
    except OSError as e:
        raise RestoreError(f"The restore could not be completed ({e}). The original database was left in place.") from e
    finally:
        if os.path.exists(staged):
            os.remove(staged)
    return before
