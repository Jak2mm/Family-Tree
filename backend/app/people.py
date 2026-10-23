import json
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import audit, photos
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
        **relations_for(conn, person_id),
        "albums": photos.albums_for(conn, person_id),
    }


def relations_for(conn: sqlite3.Connection, person_id: int) -> dict:
    """Parents, children, siblings and partnerships, each with the link id the profile needs for Undo."""
    def person_entry(row, **extra):
        return {"id": row["id"], "name": display_name(row["given_names"], row["family_name"]), **extra}

    parents = [
        person_entry(r, link_id=f"p:{r['id']}-{person_id}", kind=r["kind"])
        for r in conn.execute(
            "SELECT l.kind, p.* FROM ParentLink l JOIN Person p ON p.id = l.parent_id"
            " WHERE l.child_id = ? ORDER BY p.id",
            (person_id,),
        )
    ]
    children = [
        person_entry(r, link_id=f"p:{person_id}-{r['id']}", kind=r["kind"])
        for r in conn.execute(
            "SELECT l.kind, p.* FROM ParentLink l JOIN Person p ON p.id = l.child_id"
            " WHERE l.parent_id = ? ORDER BY p.id",
            (person_id,),
        )
    ]
    own_parents = {p["id"] for p in parents}
    siblings = []
    if own_parents:
        marks = ",".join("?" * len(own_parents))
        for r in conn.execute(
            f"SELECT DISTINCT p.* FROM ParentLink l JOIN Person p ON p.id = l.child_id"
            f" WHERE l.parent_id IN ({marks}) AND l.child_id <> ? ORDER BY p.id",
            (*own_parents, person_id),
        ):
            theirs = {x[0] for x in conn.execute("SELECT parent_id FROM ParentLink WHERE child_id = ?", (r["id"],))}
            siblings.append(person_entry(r, half=theirs != own_parents))
    partnerships = [
        person_entry(r, link_id=f"c:{r['pid']}", kind=r["kind"], start_year=r["start_year"], end_year=r["end_year"])
        for r in conn.execute(
            "SELECT c.id AS pid, c.kind, c.start_year, c.end_year, p.* FROM Partnership c"
            " JOIN Person p ON p.id = CASE WHEN c.person_a_id = :p THEN c.person_b_id ELSE c.person_a_id END"
            " WHERE c.person_a_id = :p OR c.person_b_id = :p ORDER BY c.id",
            {"p": person_id},
        )
    ]
    return {"parents": parents, "children": children, "siblings": siblings, "partnerships": partnerships}


def person_links(conn: sqlite3.Connection, person_id: int) -> list[dict]:
    """Every relationship the person is part of, from their point of view: kind is parent, child or partner."""
    rels = relations_for(conn, person_id)
    return [
        {"kind": kind, "id": r["id"], "name": r["name"], "link_id": r["link_id"]}
        for kind, key in (("parent", "parents"), ("child", "children"), ("partner", "partnerships"))
        for r in rels[key]
    ]


def photo_files_for(conn: sqlite3.Connection, person_id: int) -> list[str]:
    """File names of every photo the person owns, read before the rows are deleted.
    The caller deletes these files from the photos folder once the transaction has committed."""
    return [
        r["file_name"]
        for r in conn.execute(
            "SELECT ph.file_name FROM Photo ph JOIN Album a ON a.id = ph.album_id WHERE a.person_id = ? ORDER BY ph.id",
            (person_id,),
        )
    ]


def delete_person(conn: sqlite3.Connection, person_id: int) -> list[str]:
    """Delete a person with their links, places, albums and photo rows, without committing.
    Returns the photo file names so the caller can remove the files after it commits."""
    files = photo_files_for(conn, person_id)
    conn.execute("DELETE FROM ParentLink WHERE parent_id = :p OR child_id = :p", {"p": person_id})
    conn.execute("DELETE FROM Partnership WHERE person_a_id = :p OR person_b_id = :p", {"p": person_id})
    conn.execute("UPDATE Person SET profile_photo_id = NULL WHERE id = ?", (person_id,))
    conn.execute("DELETE FROM Photo WHERE album_id IN (SELECT id FROM Album WHERE person_id = ?)", (person_id,))
    conn.execute("DELETE FROM Album WHERE person_id = ?", (person_id,))
    conn.execute("DELETE FROM PlaceLived WHERE person_id = ?", (person_id,))
    conn.execute("DELETE FROM Person WHERE id = ?", (person_id,))
    return files


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
def remove_person(
    person_id: int,
    request: Request,
    links: Literal["refuse", "remove"] = Query("refuse"),
    user: CurrentUser = Depends(require("delete")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    get_person_row(conn, person_id)
    if links == "refuse":
        found = person_links(conn, person_id)
        if found:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "This person still has relationships (parents, children or partners). Remove them first, or delete the person together with their relationships.",
                    "links": found,
                },
            )
    try:
        files = delete_person(conn, person_id)
        audit.record(conn, user.id, "delete", "person", person_id)
    except Exception:
        conn.rollback()
        raise
    conn.commit()
    photos.remove_files(request.app.state.settings.photos_dir, files)  # only after the commit
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
