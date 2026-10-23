"""Changing a partnership's kind and years, and refusing a partner who is one's own ancestor."""
import os

import pytest

from app.db import connect


@pytest.fixture
def db(settings, client):
    c = connect(os.path.join(settings.data_dir, "family_tree.db"))
    yield c
    c.close()


@pytest.fixture
def full(make_user, login_as):
    return login_as(make_user({"read", "add", "edit", "delete"}))


def person(c, name, **extra):
    r = c.post("/api/people", json={"given_names": name, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def link(c, a, b, relation, **extra):
    return c.post("/api/links", json={"a": a, "b": b, "relation": relation, **extra})


def count(db, table):
    return db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def audit_rows(db):
    return [(a["action"], a["record_type"]) for a in db.execute("SELECT * FROM AuditEntry ORDER BY id")]


# Editing a partnership

def partnership(full, db):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "spouse", partnership_kind="partner", start_year=1970).status_code == 201
    return db.execute("SELECT id FROM Partnership").fetchone()["id"]


def test_partnership_kind_and_years_can_be_edited(full, db):
    pid = partnership(full, db)
    r = full.patch(f"/api/links/c:{pid}", json={"kind": "married", "start_year": 1972, "end_year": 1990})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": f"c:{pid}", "kind": "married", "start_year": 1972, "end_year": 1990}
    row = db.execute("SELECT kind, start_year, end_year FROM Partnership").fetchone()
    assert tuple(row) == ("married", 1972, 1990)
    assert audit_rows(db)[-1] == ("update", "partnership")
    assert db.execute("SELECT record_id FROM AuditEntry ORDER BY id DESC").fetchone()[0] == pid


def test_partnership_edit_can_clear_a_year_and_keeps_unsent_fields(full, db):
    pid = partnership(full, db)
    assert full.patch(f"/api/links/c:{pid}", json={"end_year": 2000}).status_code == 200
    assert full.patch(f"/api/links/c:{pid}", json={"start_year": None}).status_code == 200
    assert tuple(db.execute("SELECT kind, start_year, end_year FROM Partnership").fetchone()) == ("partner", None, 2000)


@pytest.mark.parametrize(
    "body",
    [{"kind": "engaged"}, {"start_year": 0}, {"end_year": 10000}, {"start_year": 1980, "end_year": 1979}, {"end_year": 1960}],
)
def test_partnership_edit_validation(full, db, body):
    pid = partnership(full, db)  # starts 1970, so an end of 1960 is before the start
    r = full.patch(f"/api/links/c:{pid}", json=body)
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Please check") or "earlier" in r.json()["detail"]
    assert tuple(db.execute("SELECT kind, start_year, end_year FROM Partnership").fetchone()) == ("partner", 1970, None)


def test_partnership_end_before_start_message_is_plain(full, db):
    pid = partnership(full, db)
    r = full.patch(f"/api/links/c:{pid}", json={"end_year": 1960})
    assert r.json()["detail"] == "The year it ended cannot be earlier than the year it started."


def test_partnership_edit_unknown_is_404(full, db):
    assert full.patch("/api/links/c:999", json={"kind": "married"}).status_code == 404
    assert full.patch("/api/links/p:1-2", json={"kind": "married"}).status_code == 404
    assert full.patch("/api/links/nonsense", json={"kind": "married"}).status_code == 404


def test_partnership_edit_needs_edit_permission(full, db, make_user, login_as):
    pid = partnership(full, db)
    adder = login_as(make_user({"read", "add"}))
    assert adder.patch(f"/api/links/c:{pid}", json={"kind": "married"}).status_code == 403
    assert db.execute("SELECT kind FROM Partnership").fetchone()[0] == "partner"


# Partners who are ancestor and descendant

def test_partner_link_to_own_grandchild_is_rejected(full, db):
    arthur, george, oliver = person(full, "Arthur"), person(full, "George"), person(full, "Oliver")
    assert link(full, arthur, george, "parent").status_code == 201
    assert link(full, george, oliver, "parent").status_code == 201
    for a, b in ((arthur, oliver), (oliver, arthur)):
        r = link(full, a, b, "spouse")
        assert r.status_code == 422
        assert r.json()["detail"] == "Arthur is an ancestor of Oliver, so they cannot be recorded as partners."
    assert link(full, george, arthur, "spouse").status_code == 422
    assert count(db, "Partnership") == 0
    assert full.get("/api/tree").json()["people"][2]["generation"] == 2


def test_unrelated_partners_and_siblings_still_work(full, db):
    a, b, c, d = person(full, "A"), person(full, "B"), person(full, "C"), person(full, "D")
    assert link(full, a, b, "parent").status_code == 201
    assert link(full, b, c, "sibling").status_code == 201  # c gets b's parent a
    assert link(full, b, d, "spouse").status_code == 201
    assert count(db, "Partnership") == 1
