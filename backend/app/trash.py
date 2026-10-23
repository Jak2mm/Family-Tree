"""Deleted photo files are kept for a while in a hidden folder on the NAS, <photos>/.deleted, so that
restoring an older backup can bring them back. Each backup run removes those deleted more than 30 days ago.

Nothing here writes anything while the NAS is offline (marker missing): the photos folder may then be an
empty local folder, and files must never be created there.
"""
import logging
import os
import time

from app.config import Settings, marker_missing

log = logging.getLogger(__name__)

FOLDER = ".deleted"
KEEP_DAYS = 30
SUFFIXES = (".jpg", "_thumb.jpg")


def folder(settings: Settings) -> str:
    return os.path.join(settings.photos_dir, FOLDER)


def _online(settings: Settings) -> bool:
    return not marker_missing(settings) and os.path.isdir(settings.photos_dir)


def _free_name(target_dir: str, name: str) -> str:
    """`name`, or `name.1`, `name.2`... if a file of that name is already there (never overwrite)."""
    candidate, n = os.path.join(target_dir, name), 0
    while os.path.exists(candidate):
        n += 1
        candidate = os.path.join(target_dir, f"{name}.{n}")
    return candidate


def move_to_trash(settings: Settings, bases: list[str]) -> None:
    """Move a deleted photo's files (full size and thumbnail) into the trash. Call after the database commit.
    Problems are logged, never raised: the photo is already gone from the family tree."""
    if not bases:
        return
    if not _online(settings):
        log.warning("Photo storage is offline; %d deleted photo(s) were left in place on the NAS.", len(bases))
        return
    target = folder(settings)
    for base in bases:
        for suffix in SUFFIXES:
            source = os.path.join(settings.photos_dir, base + suffix)
            if not os.path.isfile(source):
                continue
            try:
                os.makedirs(target, exist_ok=True)
                dest = _free_name(target, base + suffix)
                os.rename(source, dest)
                os.utime(dest)  # the 30 days count from the deletion, not from the upload
            except OSError as exc:
                log.warning("Could not move deleted photo file %s to the trash: %s", source, exc)


def purge(settings: Settings) -> int:
    """Remove trash files deleted more than KEEP_DAYS ago. Returns how many were removed."""
    if not _online(settings) or not os.path.isdir(folder(settings)):
        return 0
    cutoff = time.time() - KEEP_DAYS * 24 * 3600
    removed = 0
    for entry in os.scandir(folder(settings)):
        try:
            if entry.is_file(follow_symlinks=False) and entry.stat(follow_symlinks=False).st_mtime < cutoff:
                os.remove(entry.path)
                removed += 1
        except OSError as exc:
            log.warning("Could not remove old deleted photo %s: %s", entry.path, exc)
    return removed


def bring_back(settings: Settings, bases: list[str]) -> dict[str, int]:
    """After a restore: move back from the trash every file the restored photos need and is missing.
    Returns {"restored": files moved back, "missing": files found neither in place nor in the trash}."""
    restored = missing = 0
    if not _online(settings):
        return {"restored": 0, "missing": 0}
    trash = folder(settings)
    for base in bases:
        for suffix in SUFFIXES:
            name = base + suffix
            if os.path.isfile(os.path.join(settings.photos_dir, name)):
                continue
            copies = [c for c in (os.path.join(trash, name), *(os.path.join(trash, f"{name}.{n}") for n in range(1, 50))) if os.path.isfile(c)]
            if not copies:
                missing += 1
                continue
            newest = max(copies, key=os.path.getmtime)
            try:
                os.rename(newest, os.path.join(settings.photos_dir, name))
                restored += 1
            except OSError as exc:
                log.warning("Could not bring back photo file %s: %s", name, exc)
                missing += 1
    return {"restored": restored, "missing": missing}
