import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import audit
from app.security import CurrentUser, get_conn, hash_password, require

router = APIRouter(prefix="/api/users")

Username = Field(min_length=1, max_length=50)
Password = Field(min_length=8, max_length=128)


class NewUser(BaseModel):
    username: str = Username
    password: str = Password
    can_read: bool = True
    can_add: bool = False
    can_edit: bool = False
    can_delete: bool = False


class UserChanges(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=128)
    can_read: bool | None = None
    can_add: bool | None = None
    can_edit: bool | None = None
    can_delete: bool | None = None
    active: bool | None = None


def user_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "is_admin": bool(row["is_admin"]),
        "can_read": bool(row["can_read"]),
        "can_add": bool(row["can_add"]),
        "can_edit": bool(row["can_edit"]),
        "can_delete": bool(row["can_delete"]),
        "active": bool(row["active"]),
    }


def get_user_row(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM User WHERE id = ?", (user_id,)).fetchone()


@router.get("")
def list_users(_: CurrentUser = Depends(require("admin")), conn: sqlite3.Connection = Depends(get_conn)):
    return [user_dict(r) for r in conn.execute("SELECT * FROM User ORDER BY username")]


@router.post("", status_code=201)
def create_user(body: NewUser, admin: CurrentUser = Depends(require("admin")), conn: sqlite3.Connection = Depends(get_conn)):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Please enter a username.")
    try:
        cur = conn.execute(
            "INSERT INTO User (username, password_hash, can_read, can_add, can_edit, can_delete)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (username, hash_password(body.password), body.can_read, body.can_add, body.can_edit, body.can_delete),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That username is already taken.")
    audit.record(conn, admin.id, "create", "user", cur.lastrowid)
    conn.commit()
    return user_dict(get_user_row(conn, cur.lastrowid))


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    body: UserChanges,
    admin: CurrentUser = Depends(require("admin")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    if get_user_row(conn, user_id) is None:
        raise HTTPException(status_code=404, detail="That user could not be found.")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if user_id == admin.id and changes.get("active") is False:
        raise HTTPException(status_code=400, detail="You cannot disable your own account.")
    if "password" in changes:
        changes["password_hash"] = hash_password(changes.pop("password"))
    if changes:
        columns = ", ".join(f"{name} = ?" for name in changes)  # names come from the model, never the client
        conn.execute(f"UPDATE User SET {columns} WHERE id = ?", (*changes.values(), user_id))
        if "password_hash" in changes or changes.get("active") is False:
            conn.execute("DELETE FROM Session WHERE user_id = ?", (user_id,))
    audit.record(conn, admin.id, "update", "user", user_id)
    conn.commit()
    return user_dict(get_user_row(conn, user_id))
