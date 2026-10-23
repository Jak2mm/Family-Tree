import io
import logging
import os
import sqlite3
import uuid
import warnings

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from PIL import Image, ImageDraw, ImageOps
from pydantic import BaseModel, Field

from app import audit
from app.security import CurrentUser, get_conn, require

router = APIRouter(prefix="/api")
log = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
THUMB_WIDTH = 320
ALLOWED_FORMATS = {"JPEG", "PNG", "GIF", "WEBP"}
NOT_A_PICTURE = "That file is not a valid picture (JPEG, PNG, GIF or WebP)"
OFFLINE = "Photo storage is offline. Please try again when the NAS is available."

# Reject absurd pixel counts (decompression bombs) instead of decoding them.
Image.MAX_IMAGE_PIXELS = 100_000_000


class NewAlbum(BaseModel):
    title: str = Field(min_length=1, max_length=100)


def nas_available(photos_dir: str) -> bool:
    return os.path.isdir(photos_dir) and os.access(photos_dir, os.W_OK)


def _to_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA") or "transparency" in img.info:
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        return flat
    return img.convert("RGB")


def _jpeg(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88, optimize=True)  # no exif or icc passed: metadata is dropped
    return out.getvalue()


def process_image(data: bytes) -> tuple[bytes, bytes]:
    """Validate a picture by content and return (full JPEG, 320 px wide JPEG thumbnail).

    Raises ValueError with a plain message if it is not a JPEG, PNG, GIF or WebP, or is damaged.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                if probe.format not in ALLOWED_FORMATS:
                    raise ValueError(NOT_A_PICTURE)
                probe.verify()
            with Image.open(io.BytesIO(data)) as img:  # verify() leaves the image unusable: reopen
                img.load()  # first frame only for GIF
                upright = ImageOps.exif_transpose(img)  # before the metadata is dropped
                full = _to_rgb(upright)
    except ValueError:
        raise
    except Exception:  # corrupt, truncated, too large, or not an image at all
        raise ValueError(NOT_A_PICTURE) from None
    thumb = full
    if full.width > THUMB_WIDTH:
        thumb = full.resize((THUMB_WIDTH, max(1, round(full.height * THUMB_WIDTH / full.width))), Image.LANCZOS)
    return _jpeg(full), _jpeg(thumb)


def _paths(photos_dir: str, base: str) -> tuple[str, str]:
    return os.path.join(photos_dir, f"{base}.jpg"), os.path.join(photos_dir, f"{base}_thumb.jpg")


def remove_files(photos_dir: str, bases: list[str]) -> None:
    """Delete photo files after the database commit. Failures are logged, never raised."""
    for base in bases:
        for path in _paths(photos_dir, base):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
            except OSError as exc:
                log.warning("Could not delete photo file %s: %s", path, exc)


def albums_for(conn: sqlite3.Connection, person_id: int) -> list[dict]:
    albums = [{"id": a["id"], "title": a["title"], "photos": []} for a in conn.execute("SELECT id, title FROM Album WHERE person_id = ? ORDER BY id", (person_id,))]
    by_id = {a["id"]: a for a in albums}
    for p in conn.execute(
        "SELECT ph.id, ph.album_id, ph.caption, ph.year FROM Photo ph JOIN Album a ON a.id = ph.album_id WHERE a.person_id = ? ORDER BY ph.id",
        (person_id,),
    ):
        by_id[p["album_id"]]["photos"].append({"id": p["id"], "caption": p["caption"], "year": p["year"]})
    return albums


def _placeholder() -> bytes:
    img = Image.new("RGB", (320, 240), (210, 210, 210))
    d = ImageDraw.Draw(img)
    d.rectangle((110, 80, 210, 160), outline=(140, 140, 140), width=4)
    d.line((110, 80, 210, 160), fill=(140, 140, 140), width=4)
    d.line((110, 160, 210, 80), fill=(140, 140, 140), width=4)
    return _jpeg(img)


PLACEHOLDER = _placeholder()


@router.post("/people/{person_id}/albums", status_code=201)
def add_album(
    person_id: int,
    body: NewAlbum,
    user: CurrentUser = Depends(require("add")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    if conn.execute("SELECT 1 FROM Person WHERE id = ?", (person_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="That person could not be found.")
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Please enter an album title.")
    cur = conn.execute("INSERT INTO Album (person_id, title) VALUES (?, ?)", (person_id, title))
    audit.record(conn, user.id, "create", "album", cur.lastrowid)
    conn.commit()
    return {"id": cur.lastrowid, "title": title, "photos": []}


@router.post("/albums/{album_id}/photos", status_code=201)
async def add_photo(
    album_id: int,
    request: Request,
    file: UploadFile = File(...),
    caption: str | None = Form(default=None, max_length=500),
    year: int | None = Form(default=None, ge=1000, le=2100),
    user: CurrentUser = Depends(require("add")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    photos_dir = request.app.state.settings.photos_dir
    if conn.execute("SELECT 1 FROM Album WHERE id = ?", (album_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="That album could not be found.")
    if not nas_available(photos_dir):
        raise HTTPException(status_code=503, detail=OFFLINE)
    chunks, size = [], 0
    while chunk := await file.read(64 * 1024):
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="That picture is too large. The limit is 15 MB.")
        chunks.append(chunk)
    try:
        full, thumb = process_image(b"".join(chunks))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    base = uuid.uuid4().hex
    full_path, thumb_path = _paths(photos_dir, base)
    try:
        for path, content in ((full_path, full), (thumb_path, thumb)):
            with open(path, "wb") as f:
                f.write(content)
    except OSError as exc:
        log.warning("Could not write photo %s: %s", base, exc)
        remove_files(photos_dir, [base])
        raise HTTPException(status_code=503, detail=OFFLINE)
    caption = (caption or "").strip() or None
    try:
        cur = conn.execute(
            "INSERT INTO Photo (album_id, file_name, caption, year, uploaded_by) VALUES (?, ?, ?, ?, ?)",
            (album_id, base, caption, year, user.id),
        )
        audit.record(conn, user.id, "create", "photo", cur.lastrowid)
        conn.commit()
    except Exception:
        conn.rollback()
        remove_files(photos_dir, [base])
        raise
    return {"id": cur.lastrowid, "caption": caption, "year": year}


def _serve(request: Request, conn: sqlite3.Connection, photo_id: int, thumb: bool) -> Response:
    row = conn.execute("SELECT file_name FROM Photo WHERE id = ?", (photo_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="That photo could not be found.")
    path = _paths(request.app.state.settings.photos_dir, row["file_name"])[1 if thumb else 0]
    try:
        with open(path, "rb") as f:
            content = f.read()
    except OSError:
        return Response(PLACEHOLDER, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    return Response(content, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/photos/{photo_id}/file", dependencies=[Depends(require("read"))])
def photo_file(photo_id: int, request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return _serve(request, conn, photo_id, thumb=False)


@router.get("/photos/{photo_id}/thumb", dependencies=[Depends(require("read"))])
def photo_thumb(photo_id: int, request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return _serve(request, conn, photo_id, thumb=True)


@router.delete("/photos/{photo_id}", status_code=204)
def remove_photo(
    photo_id: int,
    request: Request,
    user: CurrentUser = Depends(require("delete")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    row = conn.execute("SELECT file_name FROM Photo WHERE id = ?", (photo_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="That photo could not be found.")
    try:
        conn.execute("UPDATE Person SET profile_photo_id = NULL WHERE profile_photo_id = ?", (photo_id,))
        conn.execute("DELETE FROM Photo WHERE id = ?", (photo_id,))
        audit.record(conn, user.id, "delete", "photo", photo_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    remove_files(request.app.state.settings.photos_dir, [row["file_name"]])
    return Response(status_code=204)


@router.delete("/albums/{album_id}", status_code=204)
def remove_album(
    album_id: int,
    request: Request,
    user: CurrentUser = Depends(require("delete")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    if conn.execute("SELECT 1 FROM Album WHERE id = ?", (album_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="That album could not be found.")
    photos = conn.execute("SELECT id, file_name FROM Photo WHERE album_id = ? ORDER BY id", (album_id,)).fetchall()
    try:
        conn.execute("UPDATE Person SET profile_photo_id = NULL WHERE profile_photo_id IN (SELECT id FROM Photo WHERE album_id = ?)", (album_id,))
        conn.execute("DELETE FROM Photo WHERE album_id = ?", (album_id,))
        conn.execute("DELETE FROM Album WHERE id = ?", (album_id,))
        for p in photos:
            audit.record(conn, user.id, "delete", "photo", p["id"])
        audit.record(conn, user.id, "delete", "album", album_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    remove_files(request.app.state.settings.photos_dir, [p["file_name"] for p in photos])
    return Response(status_code=204)


@router.put("/people/{person_id}/profile-photo/{photo_id}")
def set_profile_photo(
    person_id: int,
    photo_id: int,
    user: CurrentUser = Depends(require("edit")),
    conn: sqlite3.Connection = Depends(get_conn),
):
    from app import people  # imported here: people imports this module

    people.get_person_row(conn, person_id)
    photo = conn.execute(
        "SELECT a.person_id FROM Photo ph JOIN Album a ON a.id = ph.album_id WHERE ph.id = ?", (photo_id,)
    ).fetchone()
    if photo is None:
        raise HTTPException(status_code=404, detail="That photo could not be found.")
    if photo["person_id"] != person_id:
        raise HTTPException(status_code=422, detail="That photo does not belong to this person's albums.")
    conn.execute(
        "UPDATE Person SET profile_photo_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
        (photo_id, person_id),
    )
    audit.record(conn, user.id, "update", "person", person_id)
    conn.commit()
    return people.profile(conn, person_id)
