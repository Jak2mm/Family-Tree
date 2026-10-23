"""The activity list names the people involved, and is not filled with preference changes."""
import os
import sqlite3

import pytest

from app.db import connect, init_db


@pytest.fixture
def admin(make_user, login_as):
    return login_as(make_user(admin=True))


def person(c, given, family):
    return c.post("/api/people", json={"given_names": given, "family_name": family}).json()["id"]


def entries(admin):
    return admin.get("/api/audit").json()


def test_preference_changes_are_not_logged(admin):
    before = len(entries(admin))
    assert admin.put("/api/me/preferences", json={"layout": 2}).status_code == 200
    assert admin.put("/api/me/preferences", json={"date_format": "YYYY-MM-DD"}).status_code == 200
    assert len(entries(admin)) == before
    assert all(e["record_type"] != "preferences" for e in entries(admin))


def test_entries_name_the_people_involved(admin):
    ann, bob, cy = person(admin, "Ann", "Smith"), person(admin, "Bob", "Smith"), person(admin, "Cy", "Jones")
    admin.post("/api/links", json={"a": ann, "b": bob, "relation": "parent"})
    admin.post("/api/links", json={"a": ann, "b": cy, "relation": "spouse"})
    log = entries(admin)
    by = {(e["action"], e["record_type"]): e for e in log}
    assert by[("create", "parent_link")]["subject"] == "Ann Smith → Bob Smith"
    assert by[("create", "partnership")]["subject"] == "Ann Smith and Cy Jones"
    assert [e["subject"] for e in log if e["record_type"] == "person"] == ["Cy Jones", "Bob Smith", "Ann Smith"]


def test_undo_and_edit_of_links_are_named_too(admin):
    ann, bob = person(admin, "Ann", "Smith"), person(admin, "Bob", "Smith")
    pid = admin.post("/api/links", json={"a": ann, "b": bob, "relation": "parent"}).json()["ids"][0]
    cid = admin.post("/api/links", json={"a": bob, "b": person(admin, "Di", "Ray"), "relation": "spouse"}).json()["ids"][0]
    admin.patch(f"/api/links/{cid}", json={"kind": "married"})
    admin.delete(f"/api/links/{cid}")
    admin.delete(f"/api/links/{pid}")
    log = entries(admin)
    assert log[0]["action"] == "delete" and log[0]["subject"] == "Ann Smith → Bob Smith"
    assert log[1]["action"] == "delete" and log[1]["subject"] == "Bob Smith and Di Ray"
    assert log[2]["action"] == "update" and log[2]["subject"] == "Bob Smith and Di Ray"


def test_a_deleted_person_is_still_named_and_a_renamed_one_shows_the_new_name(admin):
    ann, bob = person(admin, "Ann", "Smith"), person(admin, "Bob", "Smith")
    admin.patch(f"/api/people/{bob}", json={"given_names": "Robert"})
    assert admin.delete(f"/api/people/{ann}").status_code == 204
    log = entries(admin)
    assert (log[0]["action"], log[0]["subject"]) == ("delete", "Ann Smith")
    assert [e["subject"] for e in log if e["record_type"] == "person" and e["action"] == "create"] == ["Robert Smith", "Ann Smith"]


def test_entries_without_a_person_have_no_subject(admin, make_user):
    admin.post("/api/users", json={"username": "carol", "password": "carol's password"})
    assert entries(admin)[0]["record_type"] == "user" and entries(admin)[0]["subject"] is None


def test_an_older_database_gets_the_new_columns(tmp_path):
    path = str(tmp_path / "old.db")
    raw = sqlite3.connect(path)
    raw.executescript(
        "CREATE TABLE AuditEntry (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, record_type TEXT NOT NULL,"
        " record_id INTEGER, created_at TEXT NOT NULL DEFAULT 'x');"
        "INSERT INTO AuditEntry (action, record_type, record_id) VALUES ('create', 'person', 1);"
    )
    raw.commit()
    raw.close()
    conn = connect(path)
    init_db(conn)
    init_db(conn)  # a second start changes nothing
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(AuditEntry)")}
    assert {"person_id", "other_person_id", "label"} <= cols
    assert conn.execute("SELECT COUNT(*) FROM AuditEntry").fetchone()[0] == 1
    conn.close()
