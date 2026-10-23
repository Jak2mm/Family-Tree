import re
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import audit
from app.dates import add_years, provably_before
from app.people import display_name, get_person_row
from app.security import CurrentUser, get_conn, require

router = APIRouter(prefix="/api")

MIN_PARENT_AGE = 12


class NewLink(BaseModel):
    a: int
    b: int
    relation: Literal["parent", "child", "spouse", "sibling"]
    parent_kind: Literal["biological", "adoptive", "step", "foster"] = "biological"
    partnership_kind: Literal["married", "de facto", "partner", "other"] = "partner"
    start_year: int | None = Field(default=None, ge=1, le=9999)
    parent_id: int | None = None


class Conflict(Exception):
    """A 409 the client can act on. `extra` carries flags such as warning or needs_parent."""

    def __init__(self, detail: str, **extra):
        self.detail, self.extra = detail, extra


def reject(detail: str) -> HTTPException:
    return HTTPException(status_code=422, detail=detail)


def parents_of(conn: sqlite3.Connection, person_id: int) -> dict[int, str]:
    """Parent id -> link kind."""
    rows = conn.execute("SELECT parent_id, kind FROM ParentLink WHERE child_id = ?", (person_id,))
    return {r["parent_id"]: r["kind"] for r in rows}


def ancestors_of(conn: sqlite3.Connection, person_id: int) -> set[int]:
    seen: set[int] = set()
    todo = [person_id]
    while todo:
        for parent in parents_of(conn, todo.pop()):
            if parent not in seen:
                seen.add(parent)
                todo.append(parent)
    return seen


def name_of(conn: sqlite3.Connection, person_id: int) -> str:
    row = get_person_row(conn, person_id)
    return display_name(row["given_names"], row["family_name"])


def check_parent_link(conn: sqlite3.Connection, parent: int, child: int) -> None:
    """Raise 422 for a link that can never be valid: self, duplicate, or a loop."""
    if parent == child:
        raise reject("A person cannot be linked to themselves.")
    if conn.execute("SELECT 1 FROM ParentLink WHERE parent_id = ? AND child_id = ?", (parent, child)).fetchone():
        raise reject(f"{name_of(conn, parent)} is already recorded as a parent of {name_of(conn, child)}.")
    if child in ancestors_of(conn, parent):
        raise reject(f"{name_of(conn, child)} is an ancestor of {name_of(conn, parent)}, so this would make someone their own ancestor.")


def too_young(conn: sqlite3.Connection, parent: int, child: int) -> bool:
    """True if the child was provably born less than 12 years after the parent."""
    born = {r["id"]: r["birth_date"] for r in conn.execute("SELECT id, birth_date FROM Person WHERE id IN (?, ?)", (parent, child))}
    if not born[parent] or not born[child]:
        return False
    return provably_before(born[child], add_years(born[parent], MIN_PARENT_AGE))


def sibling_links(conn: sqlite3.Connection, a: int, b: int, parent_id: int | None) -> list[tuple[int, int, str]]:
    """(parent, child, kind) rows that make a and b siblings."""
    pa, pb = parents_of(conn, a), parents_of(conn, b)
    if pa and pb:
        if set(pa) == set(pb):
            raise Conflict("They are already siblings.")
        raise Conflict("They have different parents. To make them half-siblings, link one of them to the other's parent instead.")
    if pa or pb:
        source, target = (pa, b) if pa else (pb, a)
        return [(parent, target, kind) for parent, kind in source.items()]
    if parent_id is None:
        raise Conflict("Neither person has a parent yet. Pick or add a parent first.", needs_parent=True)
    if parent_id in (a, b):
        raise reject("The parent must be someone other than the two siblings.")
    get_person_row(conn, parent_id)
    return [(parent_id, a, "biological"), (parent_id, b, "biological")]


def create_partnership(conn: sqlite3.Connection, user: CurrentUser, body: NewLink) -> list[str]:
    if conn.execute(
        "SELECT 1 FROM Partnership WHERE (person_a_id = :a AND person_b_id = :b) OR (person_a_id = :b AND person_b_id = :a)",
        {"a": body.a, "b": body.b},
    ).fetchone():
        raise reject(f"{name_of(conn, body.a)} and {name_of(conn, body.b)} are already recorded as partners.")
    cur = conn.execute(
        "INSERT INTO Partnership (person_a_id, person_b_id, kind, start_year) VALUES (?, ?, ?, ?)",
        (body.a, body.b, body.partnership_kind, body.start_year),
    )
    audit.record(conn, user.id, "create", "partnership", cur.lastrowid)
    return [f"c:{cur.lastrowid}"]


def create_parent_links(conn: sqlite3.Connection, user: CurrentUser, body: NewLink, force: bool) -> list[str]:
    if body.relation == "parent":
        rows = [(body.a, body.b, body.parent_kind)]
    elif body.relation == "child":
        rows = [(body.b, body.a, body.parent_kind)]
    else:
        rows = sibling_links(conn, body.a, body.b, body.parent_id)
    for parent, child, _ in rows:
        check_parent_link(conn, parent, child)
    if not force:
        for parent, child, _ in rows:
            if too_young(conn, parent, child):
                raise Conflict(
                    f"{name_of(conn, child)} was born less than {MIN_PARENT_AGE} years after {name_of(conn, parent)}. Link them anyway?",
                    warning=True,
                )
    ids = []
    for parent, child, kind in rows:
        conn.execute("INSERT INTO ParentLink (parent_id, child_id, kind) VALUES (?, ?, ?)", (parent, child, kind))
        audit.record(conn, user.id, "create", "parent_link", child)
        ids.append(f"p:{parent}-{child}")
    return ids


@router.post("/links", status_code=201)
def create_link(
    body: NewLink,
    force: int = Query(0),
    user: CurrentUser = Depends(require("add")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    if body.a == body.b:
        raise reject("A person cannot be linked to themselves.")
    get_person_row(conn, body.a)
    get_person_row(conn, body.b)
    try:
        if body.relation == "spouse":
            ids = create_partnership(conn, user, body)
        else:
            ids = create_parent_links(conn, user, body, bool(force))
    except Conflict as c:
        conn.rollback()
        return JSONResponse(status_code=409, content={"detail": c.detail, **c.extra})
    except HTTPException:
        conn.rollback()
        raise
    conn.commit()
    return {"ids": ids}


LINK_ID = re.compile(r"^(?:(p):(\d+)-(\d+)|(c):(\d+))$", re.ASCII)


@router.delete("/links/{link_id}", status_code=204)
def undo_link(link_id: str, user: CurrentUser = Depends(require("edit")), conn: sqlite3.Connection = Depends(get_conn)):
    """Undo one link. Parent link ids are `p:<parent>-<child>` and partnership ids `c:<id>`; both name the
    relationship itself, so an id that no longer exists is a 404 and can never remove a different link."""
    m = LINK_ID.match(link_id)
    if m is None:
        raise HTTPException(status_code=404, detail="That relationship could not be found.")
    if m.group(1):
        parent, child = int(m.group(2)), int(m.group(3))
        cur = conn.execute("DELETE FROM ParentLink WHERE parent_id = ? AND child_id = ?", (parent, child))
        action, record_id = "parent_link", child
    else:
        record_id = int(m.group(5))
        cur = conn.execute("DELETE FROM Partnership WHERE id = ?", (record_id,))
        action = "partnership"
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="That relationship could not be found.")
    audit.record(conn, user.id, "delete", action, record_id)
    conn.commit()
    return Response(status_code=204)
