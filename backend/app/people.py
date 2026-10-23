import json
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app import audit
from app.dates import parse_date, provably_before
from app.security import CurrentUser, current_user, get_conn, require

router = APIRouter(prefix="/api")

CardField = Literal["name", "photo", "dates", "age", "occupation"]
DEFAULT_CARD_FIELDS = ["name", "photo", "dates"]


class NewPerson(BaseModel):
    given_names: str = Field(min_length=1, max_length=200)
    family_name: str = Field(default="", max_length=200)
    birth_date: str | None = None
    birth_place: str | None = Field(default=None, max_length=200)
    death_date: str | None = None
    occupation: str | None = Field(default=None, max_length=200)
    bio: str = Field(default="", max_length=20000)


class PersonChanges(BaseModel):
    given_names: str | None = Field(default=None, min_length=1, max_length=200)
    family_name: str | None = Field(default=None, max_length=200)
    birth_date: str | None = None
    birth_place: str | None = Field(default=None, max_length=200)
    death_date: str | None = None
    occupation: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=20000)


class NewPlace(BaseModel):
    place: str = Field(min_length=1, max_length=200)
    from_year: int | None = Field(default=None, ge=1, le=9999)
    to_year: int | None = Field(default=None, ge=1, le=9999)


class Preferences(BaseModel):
    layout: int | None = Field(default=None, ge=1, le=4)
    card_fields: list[CardField] | None = None
    date_format: Literal["DD-MM-YYYY", "YYYY-MM-DD"] | None = None


def display_name(given: str, family: str) -> str:
    return f"{given} {family}".strip()


def check_dates(birth: str | None, death: str | None) -> None:
    """Raise a plain-language 422 if a date is malformed or death is before birth."""
    for label, value in (("birth date", birth), ("death date", death)):
        if value is None:
            continue
        try:
            parse_date(value)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"Please check the {label}: use a year (1932), a month (1932-02) or a full date (1932-02-28) that exists.",
            )
    if birth is not None and death is not None and provably_before(death, birth):
        raise HTTPException(status_code=422, detail="The death date cannot be earlier than the birth date.")


def get_person_row(conn: sqlite3.Connection, person_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM Person WHERE id = ?", (person_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="That person could not be found.")
    return row


def places_for(conn: sqlite3.Connection, person_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id, place, from_year, to_year FROM PlaceLived WHERE person_id = ? ORDER BY from_year IS NULL, from_year, id",
        (person_id,),
    )
    return [dict(r) for r in rows]


def profile(conn: sqlite3.Connection, person_id: int) -> dict:
    row = get_person_row(conn, person_id)
    return {
        "id": row["id"],
        "name": display_name(row["given_names"], row["family_name"]),
        "given_names": row["given_names"],
        "family_name": row["family_name"],
        "birth_date": row["birth_date"],
        "birth_place": row["birth_place"],
        "death_date": row["death_date"],
        "occupation": row["occupation"],
        "bio": row["bio"],
        "profile_photo_id": row["profile_photo_id"],
        "places_lived": places_for(conn, person_id),
        # Filled in by the relationships and albums tasks.
        "parents": [],
        "children": [],
        "siblings": [],
        "partnerships": [],
        "albums": [],
    }


def has_links(conn: sqlite3.Connection, person_id: int) -> bool:
    return conn.execute(
        "SELECT 1 FROM ParentLink WHERE parent_id = :p OR child_id = :p"
        " UNION ALL SELECT 1 FROM Partnership WHERE person_a_id = :p OR person_b_id = :p LIMIT 1",
        {"p": person_id},
    ).fetchone() is not None


def delete_person(conn: sqlite3.Connection, person_id: int) -> None:
    """Delete a person and, via cascade, their places and albums. Refuses if they have relationships."""
    if has_links(conn, person_id):
        raise HTTPException(
            status_code=409,
            detail="This person still has relationships (parents, children or partners). Remove those first.",
        )
    conn.execute("DELETE FROM Person WHERE id = ?", (person_id,))


@router.get("/people")
def list_people(_: CurrentUser = Depends(require("read")), conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute(
        "SELECT id, given_names, family_name, birth_date, death_date, profile_photo_id FROM Person"
        " ORDER BY family_name COLLATE NOCASE, given_names COLLATE NOCASE, id"
    )
    return [
        {
            "id": r["id"],
            "name": display_name(r["given_names"], r["family_name"]),
            "birth_date": r["birth_date"],
            "death_date": r["death_date"],
            "profile_photo_id": r["profile_photo_id"],
        }
        for r in rows
    ]


@router.post("/people", status_code=201)
def create_person(body: NewPerson, user: CurrentUser = Depends(require("add")), conn: sqlite3.Connection = Depends(get_conn)):
    given = body.given_names.strip()
    if not given:
        raise HTTPException(status_code=422, detail="Please enter a given name.")
    check_dates(body.birth_date, body.death_date)
    cur = conn.execute(
        "INSERT INTO Person (given_names, family_name, birth_date, birth_place, death_date, occupation, bio)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (given, body.family_name.strip(), body.birth_date, body.birth_place, body.death_date, body.occupation, body.bio),
    )
    audit.record(conn, user.id, "create", "person", cur.lastrowid)
    conn.commit()
    return profile(conn, cur.lastrowid)


@router.get("/people/{person_id}")
def read_person(person_id: int, _: CurrentUser = Depends(require("read")), conn: sqlite3.Connection = Depends(get_conn)):
    return profile(conn, person_id)


@router.patch("/people/{person_id}")
def update_person(
    person_id: int,
    body: PersonChanges,
    user: CurrentUser = Depends(require("edit")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    current = get_person_row(conn, person_id)
    changes = body.model_dump(exclude_unset=True)
    for required in ("given_names", "family_name", "bio"):
        if required in changes and changes[required] is None:
            raise HTTPException(status_code=422, detail=f"The {required.replace('_', ' ')} cannot be left empty.")
    for name in ("given_names", "family_name"):
        if name in changes:
            changes[name] = changes[name].strip()
    if "given_names" in changes and not changes["given_names"]:
        raise HTTPException(status_code=422, detail="Please enter a given name.")
    check_dates(changes.get("birth_date", current["birth_date"]), changes.get("death_date", current["death_date"]))
    if changes:
        columns = ", ".join(f"{name} = ?" for name in changes)  # names come from the model, never the client
        conn.execute(
            f"UPDATE Person SET {columns}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            (*changes.values(), person_id),
        )
    audit.record(conn, user.id, "update", "person", person_id)
    conn.commit()
    return profile(conn, person_id)


@router.delete("/people/{person_id}", status_code=204)
def remove_person(person_id: int, user: CurrentUser = Depends(require("delete")), conn: sqlite3.Connection = Depends(get_conn)):
    get_person_row(conn, person_id)
    delete_person(conn, person_id)
    audit.record(conn, user.id, "delete", "person", person_id)
    conn.commit()
    return Response(status_code=204)


@router.post("/people/{person_id}/places", status_code=201)
def add_place(
    person_id: int,
    body: NewPlace,
    user: CurrentUser = Depends(require("edit")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    get_person_row(conn, person_id)
    place = body.place.strip()
    if not place:
        raise HTTPException(status_code=422, detail="Please enter a place.")
    if body.from_year is not None and body.to_year is not None and body.to_year < body.from_year:
        raise HTTPException(status_code=422, detail="The 'to' year cannot be earlier than the 'from' year.")
    cur = conn.execute(
        "INSERT INTO PlaceLived (person_id, place, from_year, to_year) VALUES (?, ?, ?, ?)",
        (person_id, place, body.from_year, body.to_year),
    )
    audit.record(conn, user.id, "create", "place", cur.lastrowid)
    conn.commit()
    return {"id": cur.lastrowid, "place": place, "from_year": body.from_year, "to_year": body.to_year}


@router.delete("/people/{person_id}/places/{place_id}", status_code=204)
def remove_place(
    person_id: int,
    place_id: int,
    user: CurrentUser = Depends(require("edit")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    cur = conn.execute("DELETE FROM PlaceLived WHERE id = ? AND person_id = ?", (place_id, person_id))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="That place could not be found.")
    audit.record(conn, user.id, "delete", "place", place_id)
    conn.commit()
    return Response(status_code=204)


def read_preferences(conn: sqlite3.Connection, user_id: int) -> dict:
    row = conn.execute("SELECT display_options, last_layout FROM UserPreference WHERE user_id = ?", (user_id,)).fetchone()
    options = json.loads(row["display_options"]) if row else {}
    layout = int(row["last_layout"]) if row and row["last_layout"] else 1
    return {
        "layout": layout,
        "card_fields": options.get("card_fields", DEFAULT_CARD_FIELDS),
        "date_format": options.get("date_format", "DD-MM-YYYY"),
    }


@router.get("/me/preferences")
def get_preferences(user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_conn)):
    return read_preferences(conn, user.id)


@router.put("/me/preferences")
def put_preferences(body: Preferences, user: CurrentUser = Depends(current_user), conn: sqlite3.Connection = Depends(get_conn)):
    """Save the signed-in user's preferences. Fields left out keep their current value."""
    merged = {**read_preferences(conn, user.id), **body.model_dump(exclude_none=True)}
    options = json.dumps({"card_fields": merged["card_fields"], "date_format": merged["date_format"]})
    conn.execute(
        "INSERT INTO UserPreference (user_id, display_options, last_layout) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET display_options = excluded.display_options, last_layout = excluded.last_layout",
        (user.id, options, str(merged["layout"])),
    )
    audit.record(conn, user.id, "update", "preferences", user.id)
    conn.commit()
    return merged
