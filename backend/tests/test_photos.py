import io
import logging
import os
import shutil
import struct
import zlib

import pytest
from PIL import Image

from app import photos
from app.db import connect

NOT_PICTURE = "That file is not a valid picture (JPEG, PNG, GIF or WebP)"


def make_image(fmt="JPEG", size=(640, 480), mode="RGB", exif_orientation=None):
    img = Image.new(mode, size, (200, 30, 30) if mode == "RGB" else (200, 30, 30, 128))
    buf = io.BytesIO()
    kwargs = {}
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        exif[0x010F] = "SecretCameraMaker"
        kwargs["exif"] = exif
    img.save(buf, fmt, **kwargs)
    return buf.getvalue()


def truncated_jpeg():
    data = make_image("JPEG", (800, 600))
    return data[: len(data) // 2]


@pytest.fixture
def full(make_user, login_as):
    return login_as(make_user({"read", "add", "edit", "delete"}))


@pytest.fixture
def db(settings, client):
    c = connect(os.path.join(settings.data_dir, "family_tree.db"))
    yield c
    c.close()


@pytest.fixture
def album(full, settings):
    os.makedirs(settings.photos_dir, exist_ok=True)
    pid = full.post("/api/people", json={"given_names": "Ann"}).json()["id"]
    aid = full.post(f"/api/people/{pid}/albums", json={"title": "  Holidays "}).json()["id"]
    return pid, aid


def upload(client, aid, data, name="pic.jpg", **fields):
    return client.post(f"/api/albums/{aid}/photos", files={"file": (name, data, "application/octet-stream")}, data=fields)


def stored_files(settings):
    return sorted(os.listdir(settings.photos_dir)) if os.path.isdir(settings.photos_dir) else []


def photo_count(db):
    return db.execute("SELECT COUNT(*) FROM Photo").fetchone()[0]


# Albums

def test_create_album_trims_title_and_shows_on_profile(full):
    pid = full.post("/api/people", json={"given_names": "Ann"}).json()["id"]
    r = full.post(f"/api/people/{pid}/albums", json={"title": "  Holidays "})
    assert r.status_code == 201
    assert r.json()["title"] == "Holidays"
    assert full.get(f"/api/people/{pid}").json()["albums"] == [{"id": r.json()["id"], "title": "Holidays", "photos": []}]


@pytest.mark.parametrize("title", ["", "   ", "x" * 101])
def test_album_title_validated(full, title):
    pid = full.post("/api/people", json={"given_names": "Ann"}).json()["id"]
    assert full.post(f"/api/people/{pid}/albums", json={"title": title}).status_code == 422


def test_album_for_unknown_person_is_404(full):
    assert full.post("/api/people/999/albums", json={"title": "x"}).status_code == 404


# Upload

@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "GIF", "WEBP"])
def test_valid_upload_stores_random_jpeg_and_thumbnail(full, album, settings, db, fmt):
    pid, aid = album
    r = upload(full, aid, make_image(fmt), name="holiday snap.png", caption="Beach", year="1999")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["caption"] == "Beach" and body["year"] == 1999
    assert "file_name" not in body
    base = db.execute("SELECT file_name FROM Photo WHERE id = ?", (body["id"],)).fetchone()[0]
    assert "holiday" not in base and len(base) == 32
    assert stored_files(settings) == sorted([f"{base}.jpg", f"{base}_thumb.jpg"])
    with Image.open(os.path.join(settings.photos_dir, f"{base}_thumb.jpg")) as t:
        assert t.format == "JPEG" and t.width == 320
    with Image.open(os.path.join(settings.photos_dir, f"{base}.jpg")) as f:
        assert f.format == "JPEG" and f.size == (640, 480)
    assert full.get(f"/api/people/{pid}").json()["albums"][0]["photos"] == [{"id": body["id"], "caption": "Beach", "year": 1999}]


def test_exif_stripped_and_orientation_applied(full, album, settings, db):
    _, aid = album
    r = upload(full, aid, make_image("JPEG", (640, 480), exif_orientation=6))
    base = db.execute("SELECT file_name FROM Photo WHERE id = ?", (r.json()["id"],)).fetchone()[0]
    with Image.open(os.path.join(settings.photos_dir, f"{base}.jpg")) as f:
        assert dict(f.getexif()) == {}
        assert f.size == (480, 640)


def test_small_image_thumbnail_not_upscaled(full, album, settings, db):
    _, aid = album
    r = upload(full, aid, make_image("PNG", (100, 50)))
    base = db.execute("SELECT file_name FROM Photo WHERE id = ?", (r.json()["id"],)).fetchone()[0]
    with Image.open(os.path.join(settings.photos_dir, f"{base}_thumb.jpg")) as t:
        assert t.size == (100, 50)


def test_transparent_png_goes_onto_white(full, album, settings, db):
    _, aid = album
    img = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    r = upload(full, aid, buf.getvalue())
    base = db.execute("SELECT file_name FROM Photo WHERE id = ?", (r.json()["id"],)).fetchone()[0]
    with Image.open(os.path.join(settings.photos_dir, f"{base}.jpg")) as f:
        assert min(f.getpixel((10, 10))) > 240


def test_unicode_file_name_uploads(full, album):
    _, aid = album
    assert upload(full, aid, make_image(), name="Nonna ñ 家族.jpg").status_code == 201


@pytest.mark.parametrize("data", [b"just some text, not a picture", truncated_jpeg(), b""])
def test_bad_images_rejected_and_nothing_saved(full, album, settings, db, data):
    _, aid = album
    r = upload(full, aid, data, name="fake.jpg")
    assert r.status_code == 422
    assert r.json()["detail"] == NOT_PICTURE
    assert photo_count(db) == 0
    assert stored_files(settings) == []


def test_unsupported_format_rejected(full, album, settings, db):
    _, aid = album
    r = upload(full, aid, make_image("BMP"), name="x.jpg")
    assert r.status_code == 422 and r.json()["detail"] == NOT_PICTURE
    assert stored_files(settings) == []


def test_decompression_bomb_rejected(full, album, settings, db, monkeypatch):
    _, aid = album
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    r = upload(full, aid, make_image("PNG", (200, 200)))
    assert r.status_code == 422 and r.json()["detail"] == NOT_PICTURE
    assert photo_count(db) == 0 and stored_files(settings) == []


def test_oversize_upload_is_413(full, album, settings, db):
    _, aid = album
    r = upload(full, aid, b"\0" * (15 * 1024 * 1024 + 1))
    assert r.status_code == 413
    assert "15" in r.json()["detail"]
    assert photo_count(db) == 0 and stored_files(settings) == []


@pytest.mark.parametrize("fields", [{"year": "999"}, {"year": "2101"}, {"year": "abc"}, {"caption": "x" * 501}])
def test_bad_caption_or_year_rejected(full, album, db, fields):
    _, aid = album
    assert upload(full, aid, make_image(), **fields).status_code == 422
    assert photo_count(db) == 0


def test_upload_to_unknown_album_is_404(full, settings):
    os.makedirs(settings.photos_dir)
    assert upload(full, 999, make_image()).status_code == 404


def test_upload_records_audit(full, album, db):
    _, aid = album
    upload(full, aid, make_image())
    assert ("create", "photo") in [(a["action"], a["record_type"]) for a in db.execute("SELECT * FROM AuditEntry")]


# Offline NAS

def test_upload_offline_is_503_and_app_keeps_working(full, album, settings, db):
    pid, aid = album
    shutil.rmtree(settings.photos_dir)
    r = upload(full, aid, make_image())
    assert r.status_code == 503
    assert r.json()["detail"] == "Photo storage is offline. Please try again when the NAS is available."
    assert photo_count(db) == 0
    assert full.get("/api/people").status_code == 200
    assert full.get(f"/api/people/{pid}").status_code == 200


def test_nas_available(settings):
    assert not photos.nas_available(settings.photos_dir)
    os.makedirs(settings.photos_dir)
    assert photos.nas_available(settings.photos_dir)
    shutil.rmtree(settings.photos_dir)
    open(settings.photos_dir, "w").close()
    assert not photos.nas_available(settings.photos_dir)


def test_files_offline_give_placeholder(full, album, settings):
    _, aid = album
    pid_photo = upload(full, aid, make_image()).json()["id"]
    shutil.rmtree(settings.photos_dir)
    for kind in ("file", "thumb"):
        r = full.get(f"/api/photos/{pid_photo}/{kind}")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"
        assert r.headers["cache-control"] == "no-store"
        Image.open(io.BytesIO(r.content)).verify()


def test_missing_file_gives_placeholder(full, album, settings):
    _, aid = album
    photo = upload(full, aid, make_image()).json()["id"]
    for name in os.listdir(settings.photos_dir):
        os.remove(os.path.join(settings.photos_dir, name))
    r = full.get(f"/api/photos/{photo}/thumb")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"


# Serving and permissions

def test_serving_photo_headers_and_no_file_name_leak(full, album, db):
    _, aid = album
    photo = upload(full, aid, make_image()).json()["id"]
    base = db.execute("SELECT file_name FROM Photo").fetchone()[0]
    for kind, width in (("file", 640), ("thumb", 320)):
        r = full.get(f"/api/photos/{photo}/{kind}")
        assert r.status_code == 200
        assert r.headers["cache-control"] == "private, max-age=3600"
        assert Image.open(io.BytesIO(r.content)).width == width
        assert base not in "".join(f"{k}{v}" for k, v in r.headers.items())


def test_read_only_user_can_view_not_change(full, album, make_user, login_as):
    pid, aid = album
    photo = upload(full, aid, make_image()).json()["id"]
    ro = login_as(make_user({"read"}))
    assert ro.get(f"/api/photos/{photo}/file").status_code == 200
    assert ro.get(f"/api/photos/{photo}/thumb").status_code == 200
    assert upload(ro, aid, make_image()).status_code == 403
    assert ro.delete(f"/api/photos/{photo}").status_code == 403
    assert ro.post(f"/api/people/{pid}/albums", json={"title": "x"}).status_code == 403
    assert ro.put(f"/api/people/{pid}/profile-photo/{photo}").status_code == 403
    assert ro.delete(f"/api/albums/{aid}").status_code == 403


def test_unauthenticated_and_no_read_permission(full, album, app, make_user, login_as):
    from fastapi.testclient import TestClient

    _, aid = album
    photo = upload(full, aid, make_image()).json()["id"]
    assert TestClient(app).get(f"/api/photos/{photo}/file").status_code == 401
    assert TestClient(app).get(f"/api/photos/{photo}/thumb").status_code == 401
    noread = login_as(make_user({"add"}))
    assert noread.get(f"/api/photos/{photo}/file").status_code == 403


def test_unknown_photo_is_404(full):
    assert full.get("/api/photos/999/file").status_code == 404
    assert full.get("/api/photos/999/thumb").status_code == 404
    assert full.delete("/api/photos/999").status_code == 404
    assert full.delete("/api/albums/999").status_code == 404


# Delete

def test_delete_photo_removes_row_files_and_clears_profile(full, album, settings, db):
    pid, aid = album
    photo = upload(full, aid, make_image()).json()["id"]
    assert full.put(f"/api/people/{pid}/profile-photo/{photo}").status_code == 200
    assert full.get(f"/api/people/{pid}").json()["profile_photo_id"] == photo
    assert full.delete(f"/api/photos/{photo}").status_code == 204
    assert photo_count(db) == 0
    assert stored_files(settings) == []
    assert full.get(f"/api/people/{pid}").json()["profile_photo_id"] is None
    assert full.get(f"/api/photos/{photo}/file").status_code == 404
    assert ("delete", "photo") in [(a["action"], a["record_type"]) for a in db.execute("SELECT * FROM AuditEntry")]


def test_delete_photo_while_offline_still_removes_row(full, album, settings, db):
    _, aid = album
    photo = upload(full, aid, make_image()).json()["id"]
    shutil.rmtree(settings.photos_dir)
    assert full.delete(f"/api/photos/{photo}").status_code == 204
    assert photo_count(db) == 0


def test_file_delete_failure_is_logged_not_raised(full, album, settings, db, monkeypatch, caplog):
    _, aid = album
    photo = upload(full, aid, make_image()).json()["id"]

    def boom(path):
        raise PermissionError("nope")

    monkeypatch.setattr(os, "remove", boom)
    assert full.delete(f"/api/photos/{photo}").status_code == 204
    assert photo_count(db) == 0
    assert "nope" in caplog.text


def test_delete_album_removes_photos_and_files(full, album, settings, db):
    pid, aid = album
    first = upload(full, aid, make_image()).json()["id"]
    upload(full, aid, make_image())
    full.put(f"/api/people/{pid}/profile-photo/{first}")
    assert full.delete(f"/api/albums/{aid}").status_code == 204
    assert photo_count(db) == 0 and stored_files(settings) == []
    assert db.execute("SELECT COUNT(*) FROM Album").fetchone()[0] == 0
    assert full.get(f"/api/people/{pid}").json()["profile_photo_id"] is None


def test_delete_person_removes_photo_files(full, album, settings, db):
    pid, aid = album
    upload(full, aid, make_image())
    upload(full, aid, make_image("PNG"))
    assert len(stored_files(settings)) == 4
    assert full.delete(f"/api/people/{pid}").status_code == 204
    assert stored_files(settings) == []
    assert photo_count(db) == 0


def test_delete_person_succeeds_when_nas_offline(full, album, settings, db):
    pid, aid = album
    upload(full, aid, make_image())
    shutil.rmtree(settings.photos_dir)
    assert full.delete(f"/api/people/{pid}").status_code == 204
    assert db.execute("SELECT COUNT(*) FROM Person").fetchone()[0] == 0


# Profile photo

def test_profile_photo_must_belong_to_that_person(full, album):
    pid, aid = album
    other = full.post("/api/people", json={"given_names": "Bob"}).json()["id"]
    photo = upload(full, aid, make_image()).json()["id"]
    r = full.put(f"/api/people/{other}/profile-photo/{photo}")
    assert r.status_code == 422
    assert full.get(f"/api/people/{other}").json()["profile_photo_id"] is None
    assert full.put(f"/api/people/{pid}/profile-photo/{photo}").json()["profile_photo_id"] == photo
    assert full.get("/api/people").json()[0]["profile_photo_id"] == photo


def test_profile_photo_unknown_ids_404(full, album):
    pid, _ = album
    assert full.put(f"/api/people/{pid}/profile-photo/999").status_code == 404
    assert full.put("/api/people/999/profile-photo/1").status_code == 404


# Metadata, error text, pixel cap, upload size, write failures

def _png_with_chunk(kind: bytes, payload: bytes) -> bytes:
    png = make_image("PNG", (20, 20))
    chunk = struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    return png[:33] + chunk + png[33:]  # right after IHDR


def _jpeg_with_comment_and_xmp():
    img = Image.new("RGB", (400, 300), (10, 120, 200))
    buf = io.BytesIO()
    img.save(buf, "JPEG", comment=b"SECRET-COMMENT", xmp=b"<x:xmpmeta>SECRET-XMP</x:xmpmeta>", icc_profile=b"SECRET-ICC" * 20)
    return buf.getvalue()


def _gif_with_comment():
    buf = io.BytesIO()
    Image.new("P", (400, 300)).save(buf, "GIF", comment=b"SECRET-COMMENT")
    return buf.getvalue()


@pytest.mark.parametrize("data", [_jpeg_with_comment_and_xmp(), _gif_with_comment(), _png_with_chunk(b"iTXt", b"XML:com.adobe.xmp\0\0\0\0\0SECRET-XMP")], ids=["jpeg", "gif", "png"])
def test_comments_xmp_and_icc_not_stored(full, album, settings, data):
    _, aid = album
    assert upload(full, aid, data).status_code == 201
    for name in os.listdir(settings.photos_dir):
        with open(os.path.join(settings.photos_dir, name), "rb") as f:
            stored = f.read()
        assert b"SECRET" not in stored
        assert b"xmp" not in stored.lower() and b"ICC_PROFILE" not in stored


def test_pillow_error_text_never_reaches_user_and_cause_is_logged(full, album, settings, db, caplog):
    _, aid = album
    big_text = zlib.compress(b"A" * (3 * 1024 * 1024))
    data = _png_with_chunk(b"zTXt", b"Comment\0\0" + big_text)
    with caplog.at_level(logging.INFO, logger="app.photos"):
        r = upload(full, aid, data)
    assert r.status_code == 422
    assert r.json()["detail"] == NOT_PICTURE
    assert "Rejected upload" in caplog.text and "too large" in caplog.text
    assert photo_count(db) == 0 and stored_files(settings) == []


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
def test_image_between_one_and_two_times_pillow_limit_rejected(full, album, settings, db, monkeypatch):
    _, aid = album
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    monkeypatch.setattr(photos, "MAX_PIXELS", 1000)
    r = upload(full, aid, make_image("PNG", (50, 30)))  # 1500 pixels: 1.5x the limit
    assert r.status_code == 422 and r.json()["detail"] == NOT_PICTURE
    assert photo_count(db) == 0 and stored_files(settings) == []


def test_content_length_over_limit_rejected_before_handler(full, album, settings, db):
    _, aid = album
    limit = photos.MAX_UPLOAD_BYTES + photos.FORM_OVERHEAD
    r = full.post(f"/api/albums/{aid}/photos", content=b"x", headers={"Content-Length": str(limit + 1), "Content-Type": "multipart/form-data; boundary=b"})
    assert r.status_code == 413
    assert "15 MB" in r.json()["detail"]
    assert photo_count(db) == 0 and stored_files(settings) == []


def test_chunked_body_over_limit_rejected(full, album, settings, db):
    _, aid = album
    chunk = b"\0" * (1024 * 1024)

    def body():
        for _ in range(17):
            yield chunk

    r = full.post(f"/api/albums/{aid}/photos", content=body(), headers={"Content-Type": "multipart/form-data; boundary=b"})
    assert r.status_code == 413
    assert photo_count(db) == 0 and stored_files(settings) == []


def test_upload_just_under_cap_succeeds(full, album, settings, db, monkeypatch):
    _, aid = album
    monkeypatch.setattr(photos, "process_image", lambda data: (b"full", b"thumb"))
    r = upload(full, aid, b"\0" * (photos.MAX_UPLOAD_BYTES - 10))
    assert r.status_code == 201
    assert photo_count(db) == 1


def test_write_failure_gives_503_and_leaves_nothing(full, album, settings, db, monkeypatch):
    _, aid = album
    real = photos._write
    calls = []

    def flaky(path, content):
        calls.append(path)
        if len(calls) == 2:  # the thumbnail: the full image is already on disk
            raise OSError("disk full")
        real(path, content)

    monkeypatch.setattr(photos, "_write", flaky)
    r = upload(full, aid, make_image())
    assert r.status_code == 503
    assert photo_count(db) == 0 and stored_files(settings) == []


@pytest.mark.parametrize("path", ["/api/albums/+1/photos", "/api/albums/%2B1/photos", "/api/albums/%201/photos", "/api/albums/1_0/photos", "/api/albums/1/photos/"])
def test_over_limit_content_length_rejected_for_odd_paths(full, album, settings, db, path):
    limit = photos.MAX_UPLOAD_BYTES + photos.FORM_OVERHEAD
    r = full.post(path, content=b"x", headers={"Content-Length": str(limit + 1), "Content-Type": "multipart/form-data; boundary=b"})
    assert r.status_code == 413
    assert photo_count(db) == 0 and stored_files(settings) == []


def test_non_integer_content_length_falls_back_to_counting():
    import asyncio

    limit = photos.UploadSizeLimit.limit
    handled, sent = [], []

    async def inner(scope, receive, send):
        handled.append(True)
        while (await receive())["type"] == "http.request":
            pass

    chunks = [{"type": "http.request", "body": b"\0" * (limit // 2 + 1), "more_body": True}] * 3

    async def receive():
        return chunks.pop(0) if chunks else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/api/albums/1/photos", "headers": [(b"content-length", b"abc")]}
    asyncio.run(photos.UploadSizeLimit(inner)(scope, receive, send))
    assert sent[0]["status"] == 413
