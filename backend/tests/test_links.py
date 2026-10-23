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


# Parent and child links

def test_parent_link_means_a_is_parent_of_b(full, db):
    a, b = person(full, "A"), person(full, "B")
    r = link(full, a, b, "parent")
    assert r.status_code == 201
    row = db.execute("SELECT * FROM ParentLink").fetchone()
    assert (row["parent_id"], row["child_id"], row["kind"]) == (a, b, "biological")
    assert r.json()["ids"] == [f"p:{a}-{b}"]


def test_child_link_means_a_is_child_of_b(full, db):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "child", parent_kind="adoptive").status_code == 201
    row = db.execute("SELECT * FROM ParentLink").fetchone()
    assert (row["parent_id"], row["child_id"], row["kind"]) == (b, a, "adoptive")


def test_invalid_parent_kind_rejected(full):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "parent", parent_kind="cousin").status_code == 422


def test_self_link_rejected(full, db):
    a = person(full, "A")
    for relation in ("parent", "child", "spouse", "sibling"):
        assert link(full, a, a, relation).status_code == 422
    assert count(db, "ParentLink") == 0 and count(db, "Partnership") == 0


def test_missing_person_is_404(full):
    a = person(full, "A")
    assert link(full, a, 999, "parent").status_code == 404


def test_parent_loop_rejected_and_cannot_be_forced(full, db):
    a, b, c = person(full, "A"), person(full, "B"), person(full, "C")
    assert link(full, a, b, "parent").status_code == 201
    assert link(full, b, c, "parent").status_code == 201
    assert link(full, b, a, "parent").status_code == 422
    r = link(full, c, a, "parent")  # grandchild as parent
    assert r.status_code == 422
    assert full.post("/api/links?force=1", json={"a": c, "b": a, "relation": "parent"}).status_code == 422
    assert count(db, "ParentLink") == 2


def test_duplicate_parent_link_rejected(full, db):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "parent").status_code == 201
    assert link(full, a, b, "parent").status_code == 422
    assert link(full, b, a, "child").status_code == 422
    assert count(db, "ParentLink") == 1


def test_age_gap_under_12_years_warns_and_force_accepts(full, db):
    parent = person(full, "Young", birth_date="2000-06-01")
    child = person(full, "Kid", birth_date="2011-06-01")
    r = link(full, parent, child, "parent")
    assert r.status_code == 409
    assert r.json()["warning"] is True
    assert count(db, "ParentLink") == 0
    r = full.post("/api/links?force=1", json={"a": parent, "b": child, "relation": "parent"})
    assert r.status_code == 201
    assert count(db, "ParentLink") == 1


def test_exactly_12_years_and_partial_dates_do_not_warn(full):
    parent = person(full, "P", birth_date="2000-06-01")
    child = person(full, "C", birth_date="2012-06-01")
    assert link(full, parent, child, "parent").status_code == 201
    p2 = person(full, "P2", birth_date="2000")
    c2 = person(full, "C2", birth_date="2012")  # could be 12+ years apart: not provable
    assert link(full, p2, c2, "parent").status_code == 201


def test_child_born_before_parent_warns(full):
    parent = person(full, "P", birth_date="1990")
    child = person(full, "C", birth_date="1980")
    assert link(full, parent, child, "parent").status_code == 409


# Partnerships

def test_spouse_link_creates_partnership_with_default_kind(full, db):
    a, b = person(full, "A"), person(full, "B")
    r = link(full, a, b, "spouse")
    assert r.status_code == 201
    row = db.execute("SELECT * FROM Partnership").fetchone()
    assert (row["person_a_id"], row["person_b_id"], row["kind"], row["start_year"]) == (a, b, "partner", None)
    assert r.json()["ids"] == [f"c:{row['id']}"]


def test_spouse_link_with_kind_and_year(full, db):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "spouse", partnership_kind="married", start_year=1980).status_code == 201
    row = db.execute("SELECT * FROM Partnership").fetchone()
    assert (row["kind"], row["start_year"]) == ("married", 1980)


def test_invalid_partnership_kind_rejected(full):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "spouse", partnership_kind="friends").status_code == 422


def test_duplicate_partnership_rejected_in_either_order(full, db):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "spouse").status_code == 201
    assert link(full, a, b, "spouse").status_code == 422
    assert link(full, b, a, "spouse").status_code == 422
    assert count(db, "Partnership") == 1


# Siblings

def test_sibling_with_no_parents_needs_a_parent(full, db):
    a, b = person(full, "A"), person(full, "B")
    r = link(full, a, b, "sibling")
    assert r.status_code == 409
    assert r.json()["needs_parent"] is True
    assert count(db, "ParentLink") == 0


def test_sibling_with_parent_id_makes_that_person_parent_of_both(full, db):
    a, b, p = person(full, "A"), person(full, "B"), person(full, "P")
    r = link(full, a, b, "sibling", parent_id=p)
    assert r.status_code == 201
    assert len(r.json()["ids"]) == 2
    pairs = {(x["parent_id"], x["child_id"]) for x in db.execute("SELECT * FROM ParentLink")}
    assert pairs == {(p, a), (p, b)}


def test_sibling_parent_id_cannot_be_one_of_the_pair(full):
    a, b = person(full, "A"), person(full, "B")
    assert link(full, a, b, "sibling", parent_id=a).status_code == 422
    assert link(full, a, b, "sibling", parent_id=999).status_code == 404


def test_sibling_links_other_person_to_the_same_parents(full, db):
    a, b, m, f = person(full, "A"), person(full, "B"), person(full, "M"), person(full, "F")
    link(full, m, a, "parent")
    link(full, f, a, "parent")
    r = link(full, b, a, "sibling")
    assert r.status_code == 201
    assert len(r.json()["ids"]) == 2
    pairs = {(x["parent_id"], x["child_id"]) for x in db.execute("SELECT * FROM ParentLink WHERE child_id = ?", (b,))}
    assert pairs == {(m, b), (f, b)}


def test_sibling_works_in_either_direction(full, db):
    a, b, m = person(full, "A"), person(full, "B"), person(full, "M")
    link(full, m, b, "parent")
    assert link(full, a, b, "sibling").status_code == 201
    assert db.execute("SELECT COUNT(*) FROM ParentLink WHERE child_id = ?", (a,)).fetchone()[0] == 1


def test_sibling_when_already_siblings_is_409(full):
    a, b, m = person(full, "A"), person(full, "B"), person(full, "M")
    link(full, m, a, "parent")
    link(full, m, b, "parent")
    r = link(full, a, b, "sibling")
    assert r.status_code == 409
    assert "already" in r.json()["detail"].lower()


def test_sibling_with_different_parents_explains_half_siblings(full, db):
    a, b, m1, m2 = person(full, "A"), person(full, "B"), person(full, "M1"), person(full, "M2")
    link(full, m1, a, "parent")
    link(full, m2, b, "parent")
    r = link(full, a, b, "sibling")
    assert r.status_code == 409
    assert "half" in r.json()["detail"].lower()
    assert count(db, "ParentLink") == 2


def test_sibling_age_warning_applies_to_copied_parents(full, db):
    m = person(full, "M", birth_date="2000")
    a = person(full, "A", birth_date="2020")
    b = person(full, "B", birth_date="2005")
    link(full, m, a, "parent")
    assert link(full, b, a, "sibling").status_code == 409
    assert full.post("/api/links?force=1", json={"a": b, "b": a, "relation": "sibling"}).status_code == 201


def test_sibling_cannot_create_a_loop(full, db):
    # G is parent of P, P is parent of A. Linking G as sibling of A would make P parent of G.
    g, p, a = person(full, "G"), person(full, "P"), person(full, "A")
    link(full, g, p, "parent")
    link(full, p, a, "parent")
    assert link(full, g, a, "sibling").status_code == 422
    assert count(db, "ParentLink") == 2


# Undo

def test_undo_parent_link_restores_prior_state(full, db):
    a, b = person(full, "A"), person(full, "B")
    before = count(db, "ParentLink")
    link_id = link(full, a, b, "parent").json()["ids"][0]
    assert full.delete(f"/api/links/{link_id}").status_code == 204
    assert count(db, "ParentLink") == before
    assert link(full, a, b, "parent").status_code == 201  # can be linked again


def test_undo_partnership(full, db):
    a, b = person(full, "A"), person(full, "B")
    link_id = link(full, a, b, "spouse").json()["ids"][0]
    assert full.delete(f"/api/links/{link_id}").status_code == 204
    assert count(db, "Partnership") == 0


def test_undo_each_sibling_link(full, db):
    a, b, m, f = person(full, "A"), person(full, "B"), person(full, "M"), person(full, "F")
    link(full, m, a, "parent")
    link(full, f, a, "parent")
    ids = link(full, b, a, "sibling").json()["ids"]
    for link_id in ids:
        assert full.delete(f"/api/links/{link_id}").status_code == 204
    assert count(db, "ParentLink") == 2


@pytest.mark.parametrize("link_id", ["p:999-998", "c:999", "x:1", "p:abc", "p:1-", "p:-1", "p:1", "c:1-2", "c:", "5", "p:١-٢"])
def test_undo_unknown_link_is_404(full, link_id):
    assert full.delete(f"/api/links/{link_id}").status_code == 404


def test_stale_parent_link_id_never_deletes_another_link(full, db):
    a, b, c, d = person(full, "A"), person(full, "B"), person(full, "C"), person(full, "D")
    old = link(full, a, b, "parent").json()["ids"][0]
    assert full.delete(f"/api/links/{old}").status_code == 204
    new = link(full, c, d, "parent").json()["ids"][0]
    assert new != old
    assert full.delete(f"/api/links/{old}").status_code == 404
    assert db.execute("SELECT COUNT(*) FROM ParentLink WHERE parent_id = ? AND child_id = ?", (c, d)).fetchone()[0] == 1


def test_stale_partnership_id_never_deletes_another_link(full, db):
    a, b, c, d = person(full, "A"), person(full, "B"), person(full, "C"), person(full, "D")
    old = link(full, a, b, "spouse").json()["ids"][0]
    assert full.delete(f"/api/links/{old}").status_code == 204
    new = link(full, c, d, "spouse").json()["ids"][0]
    assert new != old
    assert full.delete(f"/api/links/{old}").status_code == 404
    assert count(db, "Partnership") == 1


def test_profile_parent_link_ids_can_be_undone(full, db):
    a, b = person(full, "A"), person(full, "B")
    link(full, a, b, "parent")
    assert full.get(f"/api/people/{a}").json()["children"][0]["link_id"] == f"p:{a}-{b}"
    assert full.get(f"/api/people/{b}").json()["parents"][0]["link_id"] == f"p:{a}-{b}"


def test_link_writes_are_audited(full, db):
    a, b = person(full, "A"), person(full, "B")
    db.execute("DELETE FROM AuditEntry")
    db.commit()
    parent_id = link(full, a, b, "parent").json()["ids"][0]
    partner_id = link(full, a, b, "spouse").json()["ids"][0]
    full.delete(f"/api/links/{parent_id}")
    full.delete(f"/api/links/{partner_id}")
    assert audit_rows(db) == [
        ("create", "parent_link"), ("create", "partnership"), ("delete", "parent_link"), ("delete", "partnership"),
    ]


def test_rejected_links_are_not_audited(full, db):
    a = person(full, "A")
    db.execute("DELETE FROM AuditEntry")
    db.commit()
    link(full, a, a, "parent")
    assert audit_rows(db) == []


# Permissions

def test_read_only_user_cannot_write_links(make_user, login_as, full, db):
    a, b = person(full, "A"), person(full, "B")
    link_id = link(full, a, b, "parent").json()["ids"][0]
    ro = login_as(make_user({"read"}))
    assert link(ro, a, b, "spouse").status_code == 403
    assert ro.delete(f"/api/links/{link_id}").status_code == 403
    assert ro.get("/api/tree").status_code == 200


def test_add_without_edit_cannot_undo_and_edit_without_add_cannot_link(make_user, login_as, full):
    a, b = person(full, "A"), person(full, "B")
    link_id = link(full, a, b, "parent").json()["ids"][0]
    adder = login_as(make_user({"read", "add"}))
    editor = login_as(make_user({"read", "edit"}))
    assert adder.delete(f"/api/links/{link_id}").status_code == 403
    assert link(editor, a, b, "spouse").status_code == 403
    assert link(adder, a, b, "spouse").status_code == 201
    assert editor.delete(f"/api/links/{link_id}").status_code == 204


def test_anonymous_cannot_read_tree(client):
    assert client.get("/api/tree").status_code == 401


# Profile relations

def test_profile_lists_parents_children_partners_and_half_siblings(full):
    # Person X has partner Y (child C1) and partner Z (child C2): C1 and C2 are half-siblings.
    x, y, z = person(full, "X"), person(full, "Y"), person(full, "Z")
    c1, c2, c3 = person(full, "C1"), person(full, "C2"), person(full, "C3")
    for p, c in ((x, c1), (y, c1), (x, c2), (z, c2), (x, c3), (y, c3)):
        assert link(full, p, c, "parent").status_code == 201
    pid = link(full, x, y, "spouse", partnership_kind="married", start_year=1990).json()["ids"][0]
    link(full, x, z, "spouse", partnership_kind="de facto")

    xp = full.get(f"/api/people/{x}").json()
    assert sorted(c["name"] for c in xp["children"]) == ["C1", "C2", "C3"]
    assert all(c["link_id"].startswith("p:") for c in xp["children"])
    assert xp["parents"] == [] and xp["siblings"] == []
    partners = {p["name"]: p for p in xp["partnerships"]}
    assert set(partners) == {"Y", "Z"}
    assert partners["Y"]["link_id"] == pid
    assert (partners["Y"]["kind"], partners["Y"]["start_year"], partners["Y"]["end_year"]) == ("married", 1990, None)
    assert partners["Z"]["kind"] == "de facto"

    c1p = full.get(f"/api/people/{c1}").json()
    assert sorted(p["name"] for p in c1p["parents"]) == ["X", "Y"]
    assert {s["name"]: s["half"] for s in c1p["siblings"]} == {"C2": True, "C3": False}
    yp = full.get(f"/api/people/{y}").json()
    assert [p["name"] for p in yp["partnerships"]] == ["X"]


# Tree

def test_tree_endpoint(full):
    g = person(full, "Gran", family_name="Lee", birth_date="1930-05-01", death_date="2001")
    p = person(full, "Pat", birth_date="1955")
    c = person(full, "Chris")
    s = person(full, "Sam")
    link(full, g, p, "parent")
    link(full, p, c, "parent")
    link(full, s, p, "spouse")
    tree = full.get("/api/tree").json()
    people = {x["id"]: x for x in tree["people"]}
    assert people[g] == {
        "id": g, "name": "Gran Lee", "birth_year": 1930, "death_year": 2001, "generation": 0, "photo_id": None,
        "occupation": None, "birth_date": "1930-05-01", "death_date": "2001",
    }
    assert people[p]["generation"] == 1 and people[s]["generation"] == 1 and people[c]["generation"] == 2
    assert people[c]["birth_year"] is None and people[c]["death_year"] is None
    assert sorted(tree["parent_links"]) == sorted([[g, p], [p, c]])
    assert tree["partnerships"] == [[s, p]]


def test_two_partnerships_with_children_from_each_lay_out_in_one_generation(full):
    x, y, z = person(full, "X"), person(full, "Y"), person(full, "Z")
    c1, c2 = person(full, "C1"), person(full, "C2")
    for p, c in ((x, c1), (y, c1), (x, c2), (z, c2)):
        link(full, p, c, "parent")
    link(full, x, y, "spouse")
    link(full, x, z, "spouse")
    people = {p["id"]: p["generation"] for p in full.get("/api/tree").json()["people"]}
    assert people == {x: 0, y: 0, z: 0, c1: 1, c2: 1}


# Deleting a person

def add_media(db, pid):
    """Give a person two places, an album and photos; return the photo id."""
    db.execute("INSERT INTO PlaceLived (person_id, place) VALUES (?, 'Perth')", (pid,))
    album = db.execute("INSERT INTO Album (person_id, title) VALUES (?, 'Holidays')", (pid,)).lastrowid
    photo = db.execute("INSERT INTO Photo (album_id, file_name) VALUES (?, ?)", (album, f"f{pid}a.jpg")).lastrowid
    db.execute("INSERT INTO Photo (album_id, file_name) VALUES (?, ?)", (album, f"f{pid}b.jpg"))
    db.execute("UPDATE Person SET profile_photo_id = ? WHERE id = ?", (photo, pid))
    db.commit()


def test_delete_with_links_default_refuses_and_lists_them(full, db):
    a, b, c = person(full, "Ann"), person(full, "Bob"), person(full, "Cy")
    link(full, a, b, "parent")
    link(full, c, a, "spouse")
    r = full.delete(f"/api/people/{a}")
    assert r.status_code == 409
    body = r.json()
    assert "relationship" in body["detail"].lower()
    found = sorted((x["kind"], x["name"]) for x in body["links"])
    assert found == [("child", "Bob"), ("partner", "Cy")]
    assert count(db, "ParentLink") == 1 and count(db, "Partnership") == 1
    assert full.delete(f"/api/people/{a}?links=refuse").status_code == 409


def test_delete_with_links_remove_leaves_no_orphans(full, db):
    a, b, c, d = person(full, "A"), person(full, "B"), person(full, "C"), person(full, "D")
    link(full, a, b, "parent")
    link(full, c, a, "parent")
    link(full, a, d, "spouse")
    link(full, c, d, "parent")  # unrelated to a: must survive
    add_media(db, a)
    add_media(db, b)
    db.execute("DELETE FROM AuditEntry")
    db.commit()
    assert full.delete(f"/api/people/{a}?links=remove").status_code == 204

    assert db.execute("SELECT COUNT(*) FROM Person WHERE id = ?", (a,)).fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM ParentLink WHERE parent_id = ? OR child_id = ?", (a, a)).fetchone()[0] == 0
    assert count(db, "Partnership") == 0
    assert count(db, "ParentLink") == 1
    assert db.execute("SELECT COUNT(*) FROM Album WHERE person_id = ?", (a,)).fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM PlaceLived WHERE person_id = ?", (a,)).fetchone()[0] == 0
    # Only B's album, its two photos and its place remain.
    assert count(db, "Album") == 1 and count(db, "Photo") == 2 and count(db, "PlaceLived") == 1
    assert db.execute("SELECT COUNT(*) FROM Photo WHERE album_id NOT IN (SELECT id FROM Album)").fetchone()[0] == 0
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    assert audit_rows(db) == [("delete", "person")]


def test_delete_without_links_but_with_albums_and_photos_leaves_no_orphans(full, db):
    a = person(full, "Solo")
    add_media(db, a)
    assert full.delete(f"/api/people/{a}").status_code == 204
    for table in ("Album", "Photo", "PlaceLived", "Person"):
        assert count(db, table) == 0
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_failed_remove_rolls_back_everything(full, db, monkeypatch):
    from fastapi.testclient import TestClient

    from app import audit

    a, b = person(full, "A"), person(full, "B")
    link(full, a, b, "parent")
    link(full, a, b, "spouse")
    add_media(db, a)

    def boom(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(audit, "record", boom)  # runs after every row has been deleted
    c = TestClient(full.app, raise_server_exceptions=False)
    c.cookies.update(full.cookies)
    c.headers.update(full.headers)
    assert c.delete(f"/api/people/{a}?links=remove").status_code == 500
    assert db.execute("SELECT COUNT(*) FROM Person WHERE id = ?", (a,)).fetchone()[0] == 1
    assert count(db, "ParentLink") == 1 and count(db, "Partnership") == 1
    assert count(db, "Album") == 1 and count(db, "Photo") == 2 and count(db, "PlaceLived") == 1
    assert db.execute("SELECT profile_photo_id FROM Person WHERE id = ?", (a,)).fetchone()[0] is not None


def test_delete_remove_needs_delete_permission(make_user, login_as, full):
    a, b = person(full, "A"), person(full, "B")
    link(full, a, b, "parent")
    editor = login_as(make_user({"read", "add", "edit"}))
    assert editor.delete(f"/api/people/{a}?links=remove").status_code == 403


def test_invalid_links_option_rejected(full):
    a = person(full, "A")
    assert full.delete(f"/api/people/{a}?links=maybe").status_code == 422
