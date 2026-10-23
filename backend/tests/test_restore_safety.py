"""Restoring never destroys an earlier pre-restore copy, and refuses while the NAS is offline."""
import glob
import os
import sqlite3
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from app import backup
from app.backup import RestoreError, live_path, restore_backup, run_backup
from app.db import connect, init_db


@pytest.fixture
def live(settings):
    for folder in (settings.data_dir, settings.photos_dir, settings.backups_dir):
        os.makedirs(folder, exist_ok=True)
    conn = connect(live_path(settings))
    init_db(conn)
    conn.execute("INSERT INTO Person (given_names) VALUES ('Ann')")
    conn.commit()
    conn.close()
    return settings


def add(settings, name):
    conn = connect(live_path(settings))
    conn.execute("INSERT INTO Person (given_names) VALUES (?)", (name,))
    conn.commit()
    conn.close()


def names(path):
    c = sqlite3.connect(path)
    try:
        return sorted(r[0] for r in c.execute("SELECT given_names FROM Person"))
    finally:
        c.close()


def copies(settings):
    return sorted(glob.glob(live_path(settings) + ".before-restore*"))


def test_two_restores_in_a_row_keep_both_earlier_databases(live):
    result = run_backup(live, datetime.now(timezone.utc))
    add(live, "OnlyInLive")
    first = restore_backup(live, result.path)
    second = restore_backup(live, result.path)
    kept = copies(live)
    assert len(kept) == 2
    assert first["before"] != second["before"] and {first["before"], second["before"]} == set(kept)
    assert names(first["before"]) == ["Ann", "OnlyInLive"]
    assert names(second["before"]) == ["Ann"]
    assert all(os.path.basename(p).startswith("family_tree.db.before-restore-") for p in kept)


def test_restore_refuses_while_the_nas_is_offline_and_changes_nothing(live, capsys):
    result = run_backup(live, datetime.now(timezone.utc))
    add(live, "OnlyInLive")
    offline = replace(live, nas_marker=os.path.join(live.photos_dir, "..", "missing-marker"))
    with pytest.raises(RestoreError, match="nothing was changed"):
        restore_backup(offline, result.path)
    assert names(live_path(live)) == ["Ann", "OnlyInLive"]
    assert copies(live) == []
    assert backup.main(["restore", result.path], offline) == 1
    err = capsys.readouterr().err
    assert "NAS is offline" in err and "nothing was changed" in err
    assert names(live_path(live)) == ["Ann", "OnlyInLive"]


def test_command_line_names_the_kept_copy(live, capsys):
    result = run_backup(live, datetime.now(timezone.utc))
    assert backup.main(["restore", result.path], live) == 0
    out = capsys.readouterr().out
    assert os.path.basename(copies(live)[0]) in out
