from app.tree import compute_generations


def test_grandparent_parent_child():
    gens = compute_generations([1, 2, 3], [(1, 2), (2, 3)], [])
    assert gens == {1: 0, 2: 1, 3: 2}


def test_unlinked_person_is_generation_zero():
    assert compute_generations([1], [], []) == {1: 0}


def test_partner_without_known_ancestors_matches_partner():
    # 1 -> 2 -> 3; person 4 (no ancestors) is the partner of 2
    gens = compute_generations([1, 2, 3, 4], [(1, 2), (2, 3)], [(2, 4)])
    assert gens[2] == gens[4] == 1
    assert gens[3] == 2
    assert gens[1] == 0


def test_partners_take_the_larger_generation_and_ancestors_stay_put():
    # Person 5 has a long ancestry (generation 2), partner 3 has none (generation 0).
    gens = compute_generations([1, 2, 3, 4, 5, 6], [(1, 2), (2, 5), (3, 6), (5, 6)], [(3, 5)])
    assert gens[5] == 2
    assert gens[3] == 2  # raised to match
    assert gens[1] == 0 and gens[2] == 1  # 5's ancestors not moved
    assert gens[6] == 3


def test_children_of_a_raised_partner_move_down():
    gens = compute_generations([1, 2, 3, 4, 5], [(1, 2), (2, 3), (4, 5)], [(3, 4)])
    assert gens[4] == 2
    assert gens[5] == 3


def test_two_partnerships_with_children_from_each():
    # Person 1 has partners 2 and 3; child 4 with 2, child 5 with 3.
    gens = compute_generations(
        [1, 2, 3, 4, 5],
        [(1, 4), (2, 4), (1, 5), (3, 5)],
        [(1, 2), (1, 3)],
    )
    assert gens == {1: 0, 2: 0, 3: 0, 4: 1, 5: 1}


def test_cycle_does_not_hang():
    gens = compute_generations([1, 2], [(1, 2), (2, 1)], [])
    assert set(gens) == {1, 2}


def test_tree_people_carry_occupation_and_full_dates(make_user, login_as):
    c = login_as(make_user({"read", "add"}))
    r = c.post("/api/people", json={"given_names": "Ann", "birth_date": "1950-03-07", "death_date": "2010", "occupation": "Teacher"})
    assert r.status_code == 201, r.text
    c.post("/api/people", json={"given_names": "Bob"})
    people = c.get("/api/tree").json()["people"]
    ann, bob = people
    assert (ann["occupation"], ann["birth_date"], ann["death_date"]) == ("Teacher", "1950-03-07", "2010")
    assert (ann["birth_year"], ann["death_year"]) == (1950, 2010)
    assert (bob["occupation"], bob["birth_date"], bob["death_date"]) == (None, None, None)
