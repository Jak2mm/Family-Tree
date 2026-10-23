import os

import pytest

from app.db import connect


@pytest.fixture
def db(settings, client):
    c = connect(os.path.join(settings.data_dir, "family_tree.db"))
    yield c
    c.close()


NEW = {"username": "carol", "password": "carol's password", "can_read": True, "can_add": True}


def test_admin_creates_user_with_chosen_permissions(make_user, login_as, client, db):
    admin = login_as(make_user(admin=True))
    r = admin.post("/api/users", json=NEW)
    assert r.status_code == 201
    body = r.json()
    assert (body["can_read"], body["can_add"], body["can_edit"], body["can_delete"]) == (True, True, False, False)
    assert body["is_admin"] is False and body["active"] is True
    assert "password_hash" not in body
    carol = client.post("/api/login", json={"username": "carol", "password": NEW["password"]})
    assert carol.status_code == 200
    audit = db.execute("SELECT action, record_type, record_id FROM AuditEntry").fetchall()
    assert [(a["action"], a["record_type"], a["record_id"]) for a in audit] == [("create", "user", body["id"])]


def test_duplicate_username_rejected_case_insensitively(make_user, login_as):
    admin = login_as(make_user(admin=True))
    admin.post("/api/users", json=NEW)
    r = admin.post("/api/users", json={**NEW, "username": "CAROL"})
    assert r.status_code == 409
    assert "already" in r.json()["detail"]


def test_non_admin_cannot_manage_users_or_view_audit(make_user, login_as):
    c = login_as(make_user({"read", "add", "edit", "delete"}))
    assert c.get("/api/users").status_code == 403
    assert c.post("/api/users", json=NEW).status_code == 403
    assert c.patch("/api/users/1", json={"active": False}).status_code == 403
    assert c.get("/api/audit").status_code == 403


def test_anonymous_cannot_list_users(client):
    assert client.get("/api/users").status_code == 401


def test_admin_lists_users(make_user, login_as):
    make_user({"read"})
    admin = login_as(make_user(admin=True))
    users = admin.get("/api/users").json()
    assert len(users) == 2
    assert all("password_hash" not in u for u in users)


def test_patch_permissions_and_audit(make_user, login_as, db):
    target = make_user({"read"})
    admin = login_as(make_user(admin=True))
    r = admin.patch(f"/api/users/{target.id}", json={"can_edit": True})
    assert r.status_code == 200 and r.json()["can_edit"] is True
    actions = [(a["action"], a["record_id"]) for a in db.execute("SELECT action, record_id FROM AuditEntry")]
    assert actions == [("update", target.id)]
    log = admin.get("/api/audit").json()
    assert log[0]["action"] == "update" and log[0]["username"] is not None


def test_patch_password_changes_login_and_ends_sessions(make_user, login_as, client):
    target = make_user()
    session = login_as(target)
    admin = login_as(make_user(admin=True))
    assert admin.patch(f"/api/users/{target.id}", json={"password": "brand new password"}).status_code == 200
    assert session.get("/api/me").status_code == 401
    assert client.post("/api/login", json={"username": target.username, "password": target.password}).status_code == 401
    assert client.post("/api/login", json={"username": target.username, "password": "brand new password"}).status_code == 200


def test_disable_user_blocks_login_and_ends_sessions(make_user, login_as, client):
    target = make_user()
    session = login_as(target)
    admin = login_as(make_user(admin=True))
    assert admin.patch(f"/api/users/{target.id}", json={"active": False}).status_code == 200
    assert session.get("/api/me").status_code == 401
    assert client.post("/api/login", json={"username": target.username, "password": target.password}).status_code == 401


def test_admin_cannot_disable_own_account(make_user, login_as):
    me = make_user(admin=True)
    admin = login_as(me)
    r = admin.patch(f"/api/users/{me.id}", json={"active": False})
    assert r.status_code == 400


def test_patch_unknown_user_is_404(make_user, login_as):
    assert login_as(make_user(admin=True)).patch("/api/users/999", json={"can_read": False}).status_code == 404


def test_admin_flag_cannot_be_changed_through_the_api(make_user, login_as, client):
    target = make_user()
    admin = login_as(make_user(admin=True))
    admin.patch(f"/api/users/{target.id}", json={"is_admin": True})
    assert login_as(target).get("/api/users").status_code == 403
    assert admin.post("/api/users", json={**NEW, "is_admin": True}).json()["is_admin"] is False


def test_admin_changes_need_csrf(make_user, login_as):
    admin = login_as(make_user(admin=True))
    del admin.headers["X-CSRF-Token"]
    assert admin.post("/api/users", json=NEW).status_code == 403


def test_non_ascii_usernames_are_case_insensitive(make_user, login_as, client):
    admin = login_as(make_user(admin=True))
    assert admin.post("/api/users", json={**NEW, "username": "\u00c9lodie"}).status_code == 201
    for name in ("\u00e9lodie", "\u00c9LODIE", "\u00c9lodie"):
        r = client.post("/api/login", json={"username": name, "password": NEW["password"]})
        assert r.status_code == 200, name
        client.post("/api/logout", headers={"X-CSRF-Token": r.json()["csrf_token"]})
    dup = admin.post("/api/users", json={**NEW, "username": "\u00e9lodie"})
    assert dup.status_code == 409


def test_username_is_unicode_normalised(make_user, login_as, client):
    admin = login_as(make_user(admin=True))
    admin.post("/api/users", json={**NEW, "username": "Zoe\u0301"})  # decomposed e-acute
    r = client.post("/api/login", json={"username": "Zo\u00e9", "password": NEW["password"]})
    assert r.status_code == 200


def test_admin_cannot_remove_a_permission_from_an_administrator(make_user, login_as, db):
    me = make_user(admin=True)
    admin = login_as(me)
    for flag in ("can_read", "can_add", "can_edit", "can_delete"):
        r = admin.patch(f"/api/users/{me.id}", json={flag: False})
        assert r.status_code == 400
        assert r.json()["detail"] == "An administrator always has every permission."
    row = db.execute("SELECT can_read, can_add, can_edit, can_delete FROM User WHERE id = ?", (me.id,)).fetchone()
    assert tuple(row) == (1, 1, 1, 1)
    assert admin.get("/api/tree").status_code == 200
    # a password change on an admin row is still allowed
    assert admin.patch(f"/api/users/{me.id}", json={"password": "another long password"}).status_code == 200


def test_administrator_holds_every_permission_even_if_flags_are_off(make_user, login_as, db):
    me = make_user(admin=True)
    db.execute("UPDATE User SET can_read = 0, can_add = 0, can_edit = 0, can_delete = 0 WHERE id = ?", (me.id,))
    db.commit()
    admin = login_as(me)
    assert admin.get("/api/tree").status_code == 200
    r = admin.post("/api/people", json={"given_names": "Ann", "family_name": "Smith"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert admin.patch(f"/api/people/{pid}", json={"occupation": "Nurse"}).status_code == 200
    assert admin.delete(f"/api/people/{pid}").status_code in (200, 204)
