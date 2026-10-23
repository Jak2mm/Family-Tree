import sqlite3

import pytest

from app.db import connect, init_db

TABLES = {
    "Person", "PlaceLived", "ParentLink", "Partnership", "Album",
    "Photo", "User", "Setting", "UserPreference", "AuditEntry", "Session", "LoginAttempt",
}


@pytest.fixture
def conn(tmp_path):
    c = connect(str(tmp_path / "t.db"))
    init_db(c)
    yield c
    c.close()


def add_person(conn, name="A"):
    cur = conn.execute("INSERT INTO Person (given_names, family_name) VALUES (?, 'Smith')", (name,))
    return cur.lastrowid


def test_tables_exist(conn):
    names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert TABLES <= names


def test_init_db_is_idempotent(conn):
    init_db(conn)


def test_pragmas(conn):
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_parent_link_requires_existing_people(conn):
    p = add_person(conn)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO ParentLink (parent_id, child_id, kind) VALUES (?, 999, 'biological')", (p,))


def test_person_cannot_be_own_parent(conn):
    p = add_person(conn)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO ParentLink (parent_id, child_id, kind) VALUES (?, ?, 'biological')", (p, p))


def test_parent_link_kind_checked(conn):
    a, b = add_person(conn), add_person(conn, "B")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO ParentLink (parent_id, child_id, kind) VALUES (?, ?, 'bogus')", (a, b))


def test_partnership_with_self_rejected(conn):
    p = add_person(conn)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO Partnership (person_a_id, person_b_id, kind) VALUES (?, ?, 'married')", (p, p))


def test_deleting_person_removes_links_and_albums(conn):
    a, b = add_person(conn), add_person(conn, "B")
    conn.execute("INSERT INTO ParentLink (parent_id, child_id, kind) VALUES (?, ?, 'biological')", (a, b))
    conn.execute("INSERT INTO Partnership (person_a_id, person_b_id, kind) VALUES (?, ?, 'married')", (a, b))
    conn.execute("INSERT INTO Album (person_id, title) VALUES (?, 't')", (a,))
    conn.execute("DELETE FROM Person WHERE id = ?", (a,))
    for t in ("ParentLink", "Partnership", "Album"):
        assert conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] == 0

