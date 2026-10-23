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


def _serve(settings):
    import socket
    import threading
    import time
    import uvicorn
    from app.main import create_app

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(settings, start_scheduler=False), host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)
    return server, thread, f"http://127.0.0.1:{port}"


def test_seed_keeps_its_session_when_the_cookie_is_secure_over_plain_http(settings):
    import dataclasses
    import json
    import urllib.request

    server, thread, url = _serve(dataclasses.replace(settings, cookie_secure=True))
    try:
        req = urllib.request.Request(url + "/api/setup", method="POST", headers={"Content-Type": "application/json"},
                                     data=json.dumps({"username": "admin", "password": "a long enough password"}).encode())
        urllib.request.urlopen(req).read()
        api = seed.Api(url)
        assert seed.seed(api, "admin", "a long enough password", force=False) == len(SAMPLE["people"])
        assert len(api.call("GET", "/api/people")) == len(SAMPLE["people"])
        try:
            seed.seed(seed.Api(url), "admin", "a long enough password", force=False)
        except SystemExit as e:
            assert "already has" in str(e)
        else:
            raise AssertionError("second run should refuse")
    finally:
        server.should_exit = True
        thread.join(timeout=10)
