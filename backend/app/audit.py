import sqlite3

from fastapi import APIRouter, Depends, Query

from app.security import get_conn, require

router = APIRouter(prefix="/api")


def record(conn: sqlite3.Connection, user_id: int, action: str, record_type: str, record_id: int | None) -> None:
    """Add an audit entry. Does not commit: the caller commits it together with the change it describes."""
    conn.execute(
        "INSERT INTO AuditEntry (user_id, action, record_type, record_id) VALUES (?, ?, ?, ?)",
        (user_id, action, record_type, record_id),
    )


@router.get("/audit", dependencies=[Depends(require("admin"))])
def list_audit(limit: int = Query(100, ge=1, le=500), conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute(
        "SELECT a.id, a.user_id, u.username, a.action, a.record_type, a.record_id, a.created_at"
        " FROM AuditEntry a LEFT JOIN User u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]
