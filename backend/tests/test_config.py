import os

from app import config
from app.config import load_settings


def test_load_settings_honours_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMILY_TREE_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("FAMILY_TREE_PHOTOS_DIR", str(tmp_path / "p"))
    monkeypatch.setenv("FAMILY_TREE_BACKUPS_DIR", str(tmp_path / "b"))
    monkeypatch.setenv("FAMILY_TREE_SECRET_KEY", "abc")
    s = load_settings()
    assert (s.data_dir, s.photos_dir, s.backups_dir, s.secret_key) == (
        str(tmp_path / "d"), str(tmp_path / "p"), str(tmp_path / "b"), "abc")


def test_secret_is_generated_once_and_reused(tmp_path):
    first = config._persisted_secret(str(tmp_path))
    assert len(first) == 64
    assert config._persisted_secret(str(tmp_path)) == first


def test_concurrent_create_uses_other_workers_secret(monkeypatch, tmp_path):
    real_open = os.open

    def racing_open(path, flags, mode=0o777):
        # Simulate another worker winning the race to create the file.
        with open(path, "w") as f:
            f.write("other-worker-key")
        return real_open(path, flags, mode)

    monkeypatch.setattr(config.os, "open", racing_open)
    assert config._persisted_secret(str(tmp_path)) == "other-worker-key"
    assert (tmp_path / "secret_key").read_text() == "other-worker-key"


def test_empty_secret_file_is_regenerated(tmp_path):
    (tmp_path / "secret_key").write_text("")
    key = config._persisted_secret(str(tmp_path))
    assert len(key) == 64
    assert (tmp_path / "secret_key").read_text() == key


def test_timezone_defaults_to_utc_and_honours_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMILY_TREE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FAMILY_TREE_SECRET_KEY", "abc")
    monkeypatch.delenv("FAMILY_TREE_TIMEZONE", raising=False)
    assert load_settings().timezone == "UTC"
    monkeypatch.setenv("FAMILY_TREE_TIMEZONE", "Australia/Sydney")
    assert load_settings().timezone == "Australia/Sydney"


def test_invalid_timezone_falls_back_to_utc_with_a_warning(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("FAMILY_TREE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FAMILY_TREE_SECRET_KEY", "abc")
    monkeypatch.setenv("FAMILY_TREE_TIMEZONE", "Mars/Olympus")
    assert load_settings().timezone == "UTC"
    assert "Mars/Olympus" in caplog.text
