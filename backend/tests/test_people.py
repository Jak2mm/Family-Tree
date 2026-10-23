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


def audit_rows(db):
    return [(a["action"], a["record_type"]) for a in db.execute("SELECT * FROM AuditEntry ORDER BY id")]


# Preferences

def test_new_user_gets_default_preferences(full):
    r = full.get("/api/me/preferences")
    assert r.status_code == 200
    body = r.json()
    assert body["date_format"] == "DD-MM-YYYY"
    assert body["layout"] == 1
    assert isinstance(body["card_fields"], list)


def test_preferences_round_trip(full):
    r = full.put("/api/me/preferences", json={"layout": 3, "card_fields": ["name", "age"], "date_format": "YYYY-MM-DD"})
    assert r.status_code == 200
    expected = {"layout": 3, "card_fields": ["name", "age"], "date_format": "YYYY-MM-DD"}
    assert r.json() == expected
    assert full.get("/api/me/preferences").json() == expected


def test_preferences_are_per_user(make_user, login_as):
    a, b = login_as(make_user({"read"})), login_as(make_user({"read"}))
    a.put("/api/me/preferences", json={"layout": 4})
    assert b.get("/api/me/preferences").json()["layout"] == 1


@pytest.mark.parametrize(
    "body",
    [
        {"date_format": "MM-DD-YYYY"},
        {"layout": 0},
        {"layout": 5},
        {"card_fields": ["name", "shoe size"]},
    ],
)
def test_invalid_preferences_rejected(full, body):
    assert full.put("/api/me/preferences", json=body).status_code == 422


def test_preferences_need_login(client):
    assert client.get("/api/me/preferences").status_code == 401


# Creating and reading people

def test_create_with_only_birth_year(full):
    r = full.post("/api/people", json={"given_names": "Ada", "family_name": "Lovelace", "birth_date": "1932"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert full.get(f"/api/people/{pid}").json()["birth_date"] == "1932"


def test_invalid_birth_date_gives_plain_message(full):
    r = full.post("/api/people", json={"given_names": "Ada", "birth_date": "1932-02-30"})
    assert r.status_code == 422
    assert "birth date" in r.json()["detail"].lower()
    assert "Traceback" not in r.json()["detail"]


def test_death_before_birth_rejected(full):
    r = full.post("/api/people", json={"given_names": "Ada", "birth_date": "1950-05", "death_date": "1949"})
    assert r.status_code == 422
    assert "death" in r.json()["detail"].lower()


def test_death_same_year_as_birth_allowed(full):
    r = full.post("/api/people", json={"given_names": "Baby", "birth_date": "1950", "death_date": "1950"})
    assert r.status_code == 201


def test_names_and_bio_round_trip(full):
    given = "Zoë " + "x" * 196
    assert len(given) == 200
    bio = "é'" * 10000
    assert len(bio) == 20000
    r = full.post("/api/people", json={"given_names": given, "family_name": "O'Brien-Müller", "bio": bio})
    assert r.status_code == 201
    got = full.get(f"/api/people/{r.json()['id']}").json()
    assert got["given_names"] == given
    assert got["family_name"] == "O'Brien-Müller"
    assert got["bio"] == bio


def test_oversized_name_and_bio_rejected(full):
    assert full.post("/api/people", json={"given_names": "x" * 201}).status_code == 422
    assert full.post("/api/people", json={"given_names": "A", "bio": "x" * 20001}).status_code == 422
    assert full.post("/api/people", json={"given_names": "  "}).status_code == 422


def test_profile_has_all_keys(full):
    pid = full.post("/api/people", json={"given_names": "Ada", "occupation": "Mathematician", "birth_place": "London"}).json()["id"]
    got = full.get(f"/api/people/{pid}").json()
    for key in ("parents", "children", "siblings", "partnerships", "albums", "places_lived"):
        assert got[key] == []
    assert got["occupation"] == "Mathematician" and got["birth_place"] == "London"
    assert got["profile_photo_id"] is None


def test_get_missing_person_404(full):
    assert full.get("/api/people/999").status_code == 404


def test_list_people_sorted_case_insensitively(full):
    for given, family in [("Zed", "adams"), ("Bob", "Brown"), ("Amy", "Adams"), ("Al", "adams")]:
        full.post("/api/people", json={"given_names": given, "family_name": family, "birth_date": "1900"})
    rows = full.get("/api/people").json()
    assert [r["name"] for r in rows] == ["Al adams", "Amy Adams", "Zed adams", "Bob Brown"]
    assert set(rows[0]) == {"id", "name", "birth_date", "death_date", "profile_photo_id"}


def test_name_without_family_name(full):
    full.post("/api/people", json={"given_names": "Cher"})
    assert full.get("/api/people").json()[0]["name"] == "Cher"


# Editing

def test_patch_updates_only_given_fields(full):
    pid = full.post("/api/people", json={"given_names": "Ada", "birth_date": "1900", "occupation": "Cook"}).json()["id"]
    r = full.patch(f"/api/people/{pid}", json={"occupation": "Chef"})
    assert r.status_code == 200
    got = full.get(f"/api/people/{pid}").json()
    assert got["occupation"] == "Chef" and got["birth_date"] == "1900" and got["given_names"] == "Ada"


def test_patch_can_clear_a_date(full):
    pid = full.post("/api/people", json={"given_names": "Ada", "death_date": "1990"}).json()["id"]
    full.patch(f"/api/people/{pid}", json={"death_date": None})
    assert full.get(f"/api/people/{pid}").json()["death_date"] is None


def test_patch_checks_death_against_stored_birth(full):
    pid = full.post("/api/people", json={"given_names": "Ada", "birth_date": "1900"}).json()["id"]
    assert full.patch(f"/api/people/{pid}", json={"death_date": "1899"}).status_code == 422
    assert full.patch(f"/api/people/{pid}", json={"birth_date": "1900-13"}).status_code == 422
    assert full.patch(f"/api/people/{pid}", json={"given_names": None}).status_code == 422


def test_patch_missing_person_404(full):
    assert full.patch("/api/people/999", json={"occupation": "x"}).status_code == 404


# Places lived

def test_add_and_remove_place(full):
    pid = full.post("/api/people", json={"given_names": "Ada"}).json()["id"]
    r = full.post(f"/api/people/{pid}/places", json={"place": "Parkdale, VIC", "from_year": 1960, "to_year": 1975})
    assert r.status_code == 201
    place = r.json()
    assert place["place"] == "Parkdale, VIC" and place["from_year"] == 1960
    assert full.get(f"/api/people/{pid}").json()["places_lived"] == [place]
    assert full.delete(f"/api/people/{pid}/places/{place['id']}").status_code == 204
    assert full.get(f"/api/people/{pid}").json()["places_lived"] == []


def test_place_validation(full):
    pid = full.post("/api/people", json={"given_names": "Ada"}).json()["id"]
    assert full.post(f"/api/people/{pid}/places", json={"place": ""}).status_code == 422
    r = full.post(f"/api/people/{pid}/places", json={"place": "X", "from_year": 1990, "to_year": 1980})
    assert r.status_code == 422
    assert full.post("/api/people/999/places", json={"place": "X"}).status_code == 404


def test_delete_place_of_another_person_404(full):
    a = full.post("/api/people", json={"given_names": "A"}).json()["id"]
    b = full.post("/api/people", json={"given_names": "B"}).json()["id"]
    place = full.post(f"/api/people/{a}/places", json={"place": "X"}).json()
    assert full.delete(f"/api/people/{b}/places/{place['id']}").status_code == 404


# Deleting

def test_delete_person_removes_places(full, db):
    pid = full.post("/api/people", json={"given_names": "Ada"}).json()["id"]
    full.post(f"/api/people/{pid}/places", json={"place": "X"})
    assert full.delete(f"/api/people/{pid}").status_code == 204
    assert full.get(f"/api/people/{pid}").status_code == 404
    assert db.execute("SELECT COUNT(*) FROM PlaceLived").fetchone()[0] == 0


def test_delete_person_with_links_is_refused(full, db):
    a = full.post("/api/people", json={"given_names": "Parent"}).json()["id"]
    b = full.post("/api/people", json={"given_names": "Child"}).json()["id"]
    db.execute("INSERT INTO ParentLink (parent_id, child_id, kind) VALUES (?, ?, 'biological')", (a, b))
    db.commit()
    r = full.delete(f"/api/people/{a}")
    assert r.status_code == 409
    assert "relationship" in r.json()["detail"].lower()
    assert full.get(f"/api/people/{a}").status_code == 200
    assert db.execute("SELECT COUNT(*) FROM ParentLink").fetchone()[0] == 1


def test_delete_person_with_partnership_is_refused(full, db):
    a = full.post("/api/people", json={"given_names": "A"}).json()["id"]
    b = full.post("/api/people", json={"given_names": "B"}).json()["id"]
    db.execute("INSERT INTO Partnership (person_a_id, person_b_id, kind) VALUES (?, ?, 'married')", (a, b))
    db.commit()
    assert full.delete(f"/api/people/{b}").status_code == 409


def test_delete_missing_person_404(full):
    assert full.delete("/api/people/999").status_code == 404


# Permissions

def test_anonymous_gets_401(client):
    assert client.get("/api/people").status_code == 401


def test_read_only_user(make_user, login_as, full):
    pid = full.post("/api/people", json={"given_names": "Ada"}).json()["id"]
    place = full.post(f"/api/people/{pid}/places", json={"place": "X"}).json()
    ro = login_as(make_user({"read"}))
    assert ro.get("/api/people").status_code == 200
    assert ro.get(f"/api/people/{pid}").status_code == 200
    assert ro.post("/api/people", json={"given_names": "X"}).status_code == 403
    assert ro.patch(f"/api/people/{pid}", json={"occupation": "x"}).status_code == 403
    assert ro.delete(f"/api/people/{pid}").status_code == 403
    assert ro.post(f"/api/people/{pid}/places", json={"place": "Y"}).status_code == 403
    assert ro.delete(f"/api/people/{pid}/places/{place['id']}").status_code == 403


def test_user_without_read_cannot_list(make_user, login_as):
    c = login_as(make_user(set()))
    assert c.get("/api/people").status_code == 403


def test_add_without_edit(make_user, login_as, full):
    adder = login_as(make_user({"read", "add"}))
    pid = adder.post("/api/people", json={"given_names": "Ada"}).json()["id"]
    assert adder.patch(f"/api/people/{pid}", json={"occupation": "x"}).status_code == 403
    assert adder.post(f"/api/people/{pid}/places", json={"place": "X"}).status_code == 403


def test_edit_without_delete(make_user, login_as, full):
    pid = full.post("/api/people", json={"given_names": "Ada"}).json()["id"]
    editor = login_as(make_user({"read", "edit"}))
    assert editor.patch(f"/api/people/{pid}", json={"occupation": "x"}).status_code == 200
    place = editor.post(f"/api/people/{pid}/places", json={"place": "X"}).json()
    assert editor.delete(f"/api/people/{pid}/places/{place['id']}").status_code == 204
    assert editor.delete(f"/api/people/{pid}").status_code == 403


# Audit

def test_every_write_is_audited(full, db):
    pid = full.post("/api/people", json={"given_names": "Ada"}).json()["id"]
    full.patch(f"/api/people/{pid}", json={"occupation": "x"})
    place = full.post(f"/api/people/{pid}/places", json={"place": "X"}).json()
    full.delete(f"/api/people/{pid}/places/{place['id']}")
    full.delete(f"/api/people/{pid}")
    assert audit_rows(db) == [
        ("create", "person"),
        ("update", "person"),
        ("create", "place"),
        ("delete", "place"),
        ("delete", "person"),
    ]


def test_failed_write_is_not_audited(full, db):
    full.post("/api/people", json={"given_names": "Ada", "birth_date": "1932-02-30"})
    assert audit_rows(db) == []
