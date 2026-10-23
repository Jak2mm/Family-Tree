#!/usr/bin/env python3
"""Load a made-up four-generation sample family into a running Family Tree app.

It only uses the app's normal web address (the public API), signing in as an admin. Standard
library only, so it runs anywhere Python 3 is installed:

    python3 scripts/seed_sample_family.py --username admin --password 'your password'

Options: --url (default http://localhost:8000), --force (add the sample even if people already
exist). The user name and password can also come from FAMILY_TREE_ADMIN_USER and
FAMILY_TREE_ADMIN_PASSWORD. If the password is not given it is asked for.
"""
import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

# key: (given names, family name, birth date, death date, occupation, birth place)
PEOPLE = {
    "arthur": ("Arthur", "Bennett", "1921-03-14", "1998-07-02", "Carpenter", "Ballarat, Victoria"),
    "margaret": ("Margaret", "Bennett", "1924", "2012-11-20", "Nurse", "Bendigo, Victoria"),
    "george": ("George", "Bennett", "1947-05-09", None, "Teacher", "Ballarat, Victoria"),
    "helen": ("Helen", "Murray", "1950-06", None, "Accountant", "Ballarat, Victoria"),
    "frank": ("Frank", "Murray", "1948", "2019-02-11", "Farmer", "Horsham, Victoria"),
    "joan": ("Joan", "Fisher", "1952-09-30", None, "Librarian", "Geelong, Victoria"),
    "ray": ("Ray", "Fisher", None, None, "Plumber", None),
    "patricia": ("Patricia", "Bennett", "1955", None, "Pharmacist", "Hobart, Tasmania"),
    "david": ("David", "Bennett", "1974-01-22", None, "Electrician", "Melbourne, Victoria"),
    "susan": ("Susan", "Bennett", "1977-08-05", None, "Nurse", "Melbourne, Victoria"),
    "adam": ("Adam", "Fisher", "1982", None, "Chef", "Geelong, Victoria"),
    "michael": ("Michael", "Bennett", "1987-04-18", None, "Engineer", "Melbourne, Victoria"),
    "karen": ("Karen", "Reid", "1975", None, "Vet", "Horsham, Victoria"),
    "peter": ("Peter", "Murray", "1979-12-01", None, "Surveyor", "Horsham, Victoria"),
    "emma": ("Emma", "Bennett", "1976", None, "Graphic designer", "Perth, Western Australia"),
    "tom": ("Tom", "Reid", "1973-10-10", None, "Paramedic", "Sydney, New South Wales"),
    "anna": ("Anna", "Murray", "1981", None, "Dentist", "Brisbane, Queensland"),
    "oliver": ("Oliver", "Bennett", "2003-02-14", None, "Student", "Melbourne, Victoria"),
    "ruby": ("Ruby", "Bennett", "2006", None, "Student", "Melbourne, Victoria"),
    "lily": ("Lily", "Reid", "2004-07-07", None, "Apprentice baker", "Horsham, Victoria"),
    "mia": ("Mia", "Bennett", "2010-03-03", None, None, "Melbourne, Victoria"),
    "jack": ("Jack", "Murray", "2012", None, None, "Brisbane, Queensland"),
}

# (parent, child). Half-siblings: George's children by Joan (David, Susan) and by Patricia (Michael);
# Joan's children by George (David, Susan) and by Ray (Adam). Mia has one recorded parent.
PARENT_LINKS = [
    ("arthur", "george"), ("margaret", "george"), ("arthur", "helen"), ("margaret", "helen"),
    ("george", "david"), ("joan", "david"), ("george", "susan"), ("joan", "susan"),
    ("ray", "adam"), ("joan", "adam"), ("george", "michael"), ("patricia", "michael"),
    ("helen", "karen"), ("frank", "karen"), ("helen", "peter"), ("frank", "peter"),
    ("david", "oliver"), ("emma", "oliver"), ("david", "ruby"), ("emma", "ruby"),
    ("karen", "lily"), ("tom", "lily"), ("susan", "mia"),
    ("peter", "jack"), ("anna", "jack"),
]

# (person, person, kind, start year)
PARTNERSHIPS = [
    ("arthur", "margaret", "married", 1945), ("helen", "frank", "married", 1972),
    ("george", "joan", "married", 1972), ("george", "patricia", "married", 1985),
    ("joan", "ray", "de facto", 1980), ("david", "emma", "married", 2001),
    ("karen", "tom", "de facto", 2002), ("peter", "anna", "married", 2010),
]

# (person, place, from year, to year)
PLACES = [
    ("arthur", "Ballarat, Victoria", 1921, 1998), ("margaret", "Bendigo, Victoria", 1924, 1945),
    ("margaret", "Ballarat, Victoria", 1945, 2012), ("george", "Ballarat, Victoria", 1947, 1972),
    ("george", "Melbourne, Victoria", 1972, None), ("david", "Melbourne, Victoria", 1974, 2001),
    ("david", "Perth, Western Australia", 2001, 2008), ("david", "Melbourne, Victoria", 2008, None),
    ("karen", "Horsham, Victoria", 1975, None), ("peter", "Brisbane, Queensland", 2008, None),
]


def build_sample() -> dict:
    """The whole sample as plain data (no network), so it can be checked on its own."""
    people = [
        {"key": key, "given_names": g, "family_name": f, "birth_date": b, "death_date": d,
         "occupation": job, "birth_place": place,
         "bio": f"{g} is a made-up person in the sample family." if g else ""}
        for key, (g, f, b, d, job, place) in PEOPLE.items()
    ]
    return {"people": people, "parent_links": PARENT_LINKS, "partnerships": PARTNERSHIPS, "places": PLACES}


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        # The session cookie is kept by hand: a normal cookie jar refuses to send a "Secure" cookie over
        # plain http://localhost, which is how this script usually talks to an app that uses COOKIE_SECURE=true.
        self.cookie = ""
        self.csrf = ""

    def call(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"} if data else {}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if method != "GET":
            headers["X-CSRF-Token"] = self.csrf
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                for line in resp.headers.get_all("Set-Cookie") or []:
                    pair = line.split(";", 1)[0].strip()
                    if pair.startswith("session=") and pair != "session=":
                        self.cookie = pair
                text = resp.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read().decode()).get("detail", "")
            except ValueError:
                detail = ""
            raise SystemExit(f"The app refused {method} {path} ({e.code}): {detail}") from None
        except urllib.error.URLError as e:
            raise SystemExit(f"Could not reach the app at {self.base} ({e.reason}). Is it running?") from None


def seed(api: Api, username: str, password: str, force: bool) -> int:
    me = api.call("POST", "/api/login", {"username": username, "password": password})
    api.csrf = me["csrf_token"]
    if not me["is_admin"]:
        raise SystemExit("Please sign in as an admin user.")
    existing = api.call("GET", "/api/people")
    if existing and not force:
        raise SystemExit(f"The app already has {len(existing)} people, so nothing was added. Use --force to add the sample anyway.")
    sample = build_sample()
    ids = {}
    for p in sample["people"]:
        body = {k: v for k, v in p.items() if k != "key" and v is not None}
        ids[p["key"]] = api.call("POST", "/api/people", body)["id"]
    for parent, child in sample["parent_links"]:
        api.call("POST", "/api/links", {"a": ids[parent], "b": ids[child], "relation": "parent"})
    for a, b, kind, year in sample["partnerships"]:
        api.call("POST", "/api/links", {"a": ids[a], "b": ids[b], "relation": "spouse", "partnership_kind": kind, "start_year": year})
    for key, place, start, end in sample["places"]:
        body = {"place": place, "from_year": start, "to_year": end}
        api.call("POST", f"/api/people/{ids[key]}/places", {k: v for k, v in body.items() if v is not None})
    return len(ids)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Add a made-up sample family to a running Family Tree app.")
    parser.add_argument("--url", default=os.environ.get("FAMILY_TREE_URL", "http://localhost:8000"))
    parser.add_argument("--username", default=os.environ.get("FAMILY_TREE_ADMIN_USER"))
    parser.add_argument("--password", default=os.environ.get("FAMILY_TREE_ADMIN_PASSWORD"))
    parser.add_argument("--force", action="store_true", help="add the sample even if people already exist")
    args = parser.parse_args(argv)
    username = args.username or input("Admin username: ")
    password = args.password or getpass.getpass("Admin password: ")
    count = seed(Api(args.url), username, password, args.force)
    print(f"Added {count} sample people. Open {args.url} to look at them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
