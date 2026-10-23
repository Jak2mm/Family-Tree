import sqlite3

from fastapi import APIRouter, Depends, Query

from app.security import get_conn, require

router = APIRouter(prefix="/api")

# How the two people of an entry are joined in the activity list.
JOINERS = {"parent_link": " → ", "partnership": " and "}


def name_of(conn: sqlite3.Connection, person_id: int | None) -> str | None:
    if person_id is None:
        return None
    row = conn.execute("SELECT given_names, family_name FROM Person WHERE id = ?", (person_id,)).fetchone()
    return f"{row[0]} {row[1]}".strip() if row else None


def record(
    conn: sqlite3.Connection,
    user_id: int,
    action: str,
    record_type: str,
    record_id: int | None,
    person: int | None = None,
    other: int | None = None,
    label: str | None = None,
) -> None:
    """Add an audit entry. Does not commit: the caller commits it together with the change it describes.
    `person` (and `other`, for a parent link: the child; for a partnership: the partner) name who it is about;
    call it before deleting them (or pass `label`), so their names are kept for the activity list."""
    if label is None:
        names = [n for n in (name_of(conn, person), name_of(conn, other)) if n]
        label = JOINERS.get(record_type, " and ").join(names) or None
    conn.execute(
        "INSERT INTO AuditEntry (user_id, action, record_type, record_id, person_id, other_person_id, label)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, action, record_type, record_id, person, other, label),
    )


def _subject(row: sqlite3.Row) -> str | None:
    """The people's names now, or as they were when the entry was written if one has since been deleted."""
    if row["person_id"] is None:
        return None
    wanted = [(row["person_id"], row["name1"]), *([(row["other_person_id"], row["name2"])] if row["other_person_id"] is not None else [])]
    if all(name for _, name in wanted):
        return JOINERS.get(row["record_type"], " and ").join(name.strip() for _, name in wanted)
    return row["label"]


@router.get("/audit", dependencies=[Depends(require("admin"))])
def list_audit(limit: int = Query(100, ge=1, le=500), conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute(
        "SELECT a.id, a.user_id, u.username, a.action, a.record_type, a.record_id, a.created_at,"
        " a.person_id, a.other_person_id, a.label,"
        " p1.given_names || ' ' || p1.family_name AS name1, p2.given_names || ' ' || p2.family_name AS name2"
        " FROM AuditEntry a LEFT JOIN User u ON u.id = a.user_id"
        " LEFT JOIN Person p1 ON p1.id = a.person_id LEFT JOIN Person p2 ON p2.id = a.other_person_id"
        " ORDER BY a.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    keys = ("id", "user_id", "username", "action", "record_type", "record_id", "created_at")
    return [{**{k: r[k] for k in keys}, "subject": _subject(r)} for r in rows]
