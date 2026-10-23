import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "seed_sample_family.py"
spec = importlib.util.spec_from_file_location("seed_sample_family", SCRIPT)
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

SAMPLE = seed.build_sample()
BORN = {p["key"]: int(p["birth_date"][:4]) for p in SAMPLE["people"] if p["birth_date"]}
KEYS = {p["key"] for p in SAMPLE["people"]}


def parents_of(key):
    return {a for a, b in SAMPLE["parent_links"] if b == key}


def test_sample_has_about_twenty_people_and_known_keys():
    assert 18 <= len(SAMPLE["people"]) <= 26
    assert len(KEYS) == len(SAMPLE["people"])
    for a, b in SAMPLE["parent_links"]:
        assert a in KEYS and b in KEYS and a != b
    for a, b, *_ in SAMPLE["partnerships"]:
        assert a in KEYS and b in KEYS and a != b
    assert len(set(SAMPLE["parent_links"])) == len(SAMPLE["parent_links"])


def test_no_parent_is_younger_than_a_child():
    for parent, child in SAMPLE["parent_links"]:
        if parent in BORN and child in BORN:
            assert BORN[child] - BORN[parent] >= 16, (parent, child)


def test_no_loops_in_ancestry():
    def climb(key, seen):
        assert key not in seen, f"loop through {key}"
        for p in parents_of(key):
            climb(p, seen | {key})
    for key in KEYS:
        climb(key, frozenset())


def test_four_generations_and_a_remarriage_and_half_siblings():
    def depth(key):
        return 1 + max((depth(p) for p in parents_of(key)), default=0)
    assert max(depth(k) for k in KEYS) == 4
    partners = [x for a, b, *_ in SAMPLE["partnerships"] for x in (a, b)]
    assert any(partners.count(k) >= 2 for k in KEYS)
    siblings = [(a, b) for a in KEYS for b in KEYS if a < b and parents_of(a) and parents_of(b) and parents_of(a) & parents_of(b)]
    halves = [(a, b) for a, b in siblings if len(parents_of(a) & parents_of(b)) == 1 and parents_of(a) != parents_of(b)]
    assert halves, "expected at least one pair of half-siblings sharing exactly one parent"


def test_births_spread_over_several_decades_and_one_unknown_year():
    assert max(BORN.values()) - min(BORN.values()) > 80
    assert len(BORN) < len(SAMPLE["people"])


def test_dates_are_valid_partial_dates_and_deaths_follow_births():
    import re
    for p in SAMPLE["people"]:
        for field in ("birth_date", "death_date"):
            assert p[field] is None or re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?)?", p[field])
        if p["birth_date"] and p["death_date"]:
            assert p["death_date"] >= p["birth_date"]
