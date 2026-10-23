import logging
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Settings:
    data_dir: str
    photos_dir: str
    backups_dir: str
    secret_key: str
    timezone: str = "UTC"
    cookie_secure: bool = False


def load_settings() -> Settings:
    """Read settings from environment variables, with local defaults.

    FAMILY_TREE_DATA_DIR (default ./data) holds the database. Photos and
    backups default to sub-folders of it but are normally pointed at NAS
    mounts. If no secret key is given, one is generated once and kept in
    the data folder so sessions survive restarts. FAMILY_TREE_COOKIE_SECURE=true marks the sign-in
    cookie HTTPS-only (use it when the app is reached over https, e.g. tailscale serve).
    """
    data_dir = os.environ.get("FAMILY_TREE_DATA_DIR", "./data")
    photos_dir = os.environ.get("FAMILY_TREE_PHOTOS_DIR", os.path.join(data_dir, "photos"))
    backups_dir = os.environ.get("FAMILY_TREE_BACKUPS_DIR", os.path.join(data_dir, "backups"))
    secret_key = os.environ.get("FAMILY_TREE_SECRET_KEY") or _persisted_secret(data_dir)
    timezone = os.environ.get("FAMILY_TREE_TIMEZONE", "UTC")
    try:
        ZoneInfo(timezone)
    except Exception:  # unknown name, bad characters or missing tz data
        log.warning("FAMILY_TREE_TIMEZONE %r is not a known time zone; using UTC.", timezone)
        timezone = "UTC"
    cookie_secure = os.environ.get("FAMILY_TREE_COOKIE_SECURE", "").strip().lower() in ("1", "true", "yes", "on")
    return Settings(data_dir, photos_dir, backups_dir, secret_key, timezone, cookie_secure)


def zone_for(settings: Settings) -> ZoneInfo:
    try:
        return ZoneInfo(settings.timezone)
    except Exception:
        return ZoneInfo("UTC")


def _persisted_secret(data_dir: str) -> str:
    path = Path(data_dir) / "secret_key"
    if path.exists():
        existing = path.read_text().strip()
        if existing:
            return existing
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(32)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        # Another worker created it first (or it is empty): use theirs if usable.
        existing = path.read_text().strip()
        if existing:
            return existing
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key
