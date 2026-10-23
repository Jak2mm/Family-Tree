"""Siblings are full when they share the same biological and adoptive parents; step and foster parents
do not make anyone a half-sibling or a sibling, and sibling links copy only those parents."""
import os

import pytest

from app.db import connect


@pytest.fixture
def full(make_user, login_as):
    return login_as(make_user({"read", "add", "edit", "delete"}))


@pytest.fixture
def db(settings, client):
    c = connect(os.path.join(settings.data_dir, "family_tree.db"))
    yield c
    c.close()


def person(c, name):
    return c.post("/api/people", json={"given_names": name}).json()["id"]


def link(c, a, b, relation, **extra):
    return c.post("/api/links", json={"a": a, "b": b, "relation": relation, **extra})


def siblings(c, pid):
    return {s["name"]: s["half"] for s in c.get(f"/api/people/{pid}").json()["siblings"]}


@pytest.fixture
def family(full):
    """George and Joan with children David and Susan; Ray is Joan's later partner."""
    ids = {n: person(full, n) for n in ("George", "Joan", "David", "Susan", "Ray", "Adam")}
    for parent in ("George", "Joan"):
        for child in ("David", "Susan"):
            assert link(full, ids[parent], ids[child], "parent").status_code == 201
    return ids


def test_a_step_parent_does_not_make_full_siblings_half(full, family):
    assert link(full, family["Ray"], family["David"], "parent", parent_kind="step").status_code == 201
    assert siblings(full, family["Susan"]) == {"David": False}
    assert siblings(full, family["David"]) == {"Susan": False}


def test_a_foster_parent_alone_does_not_make_siblings(full, family):
    assert link(full, family["Ray"], family["David"], "parent", parent_kind="foster").status_code == 201
    assert link(full, family["Ray"], family["Adam"], "parent").status_code == 201
    assert "Adam" not in siblings(full, family["David"])


def test_shared_adoptive_parents_make_full_siblings(full):
    mum, dad, a, b = (person(full, n) for n in ("Mum", "Dad", "A", "B"))
    for p in (mum, dad):
        link(full, p, a, "parent")
        link(full, p, b, "parent", parent_kind="adoptive")
    assert siblings(full, a) == {"B": False}


def test_one_shared_biological_parent_is_half(full, family):
    assert link(full, family["Ray"], family["Adam"], "parent").status_code == 201
    assert link(full, family["Joan"], family["Adam"], "parent").status_code == 201
    assert siblings(full, family["Susan"]) == {"David": False, "Adam": True}


def test_sibling_link_ignores_a_step_parent(full, family, db):
    assert link(full, family["Ray"], family["David"], "parent", parent_kind="step").status_code == 201
    r = link(full, family["Susan"], family["David"], "sibling")
    assert r.status_code == 409 and "already siblings" in r.json()["detail"]
    newcomer = person(full, "Newcomer")
    assert link(full, newcomer, family["David"], "sibling").status_code == 201
    got = {(r[0], r[1]) for r in db.execute("SELECT parent_id, kind FROM ParentLink WHERE child_id = ?", (newcomer,))}
    assert got == {(family["George"], "biological"), (family["Joan"], "biological")}  # not Ray, the step-parent
