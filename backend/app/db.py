import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS User (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    can_read INTEGER NOT NULL DEFAULT 1 CHECK (can_read IN (0, 1)),
    can_add INTEGER NOT NULL DEFAULT 0 CHECK (can_add IN (0, 1)),
    can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
    can_delete INTEGER NOT NULL DEFAULT 0 CHECK (can_delete IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS Person (
    id INTEGER PRIMARY KEY,
    given_names TEXT NOT NULL,
    family_name TEXT NOT NULL DEFAULT '',
    birth_date TEXT,
    birth_place TEXT,
    death_date TEXT,
    occupation TEXT,
    bio TEXT NOT NULL DEFAULT '',
    profile_photo_id INTEGER REFERENCES Photo(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS PlaceLived (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
    place TEXT NOT NULL,
    from_year INTEGER,
    to_year INTEGER
);

CREATE TABLE IF NOT EXISTS ParentLink (
    parent_id INTEGER NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
    child_id INTEGER NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('biological', 'adoptive', 'step', 'foster')),
    PRIMARY KEY (parent_id, child_id),
    CHECK (parent_id <> child_id)
);

CREATE TABLE IF NOT EXISTS Partnership (
    id INTEGER PRIMARY KEY,
    person_a_id INTEGER NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
    person_b_id INTEGER NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('married', 'de facto', 'partner', 'other')),
    start_year INTEGER,
    end_year INTEGER,
    CHECK (person_a_id <> person_b_id)
);

CREATE TABLE IF NOT EXISTS Album (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
    title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Photo (
    id INTEGER PRIMARY KEY,
    album_id INTEGER NOT NULL REFERENCES Album(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL UNIQUE,
    caption TEXT,
    year INTEGER,
    uploaded_by INTEGER REFERENCES User(id) ON DELETE SET NULL,
    uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS Setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS UserPreference (
    user_id INTEGER PRIMARY KEY REFERENCES User(id) ON DELETE CASCADE,
    display_options TEXT NOT NULL DEFAULT '{}',
    last_layout TEXT
);

CREATE TABLE IF NOT EXISTS AuditEntry (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES User(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS Session (
    token TEXT PRIMARY KEY,  -- SHA-256 of the cookie token, never the token itself
    user_id INTEGER NOT NULL REFERENCES User(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS LoginAttempt (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    ip TEXT NOT NULL,
    attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_user ON Session(user_id);
CREATE INDEX IF NOT EXISTS idx_loginattempt_pair ON LoginAttempt(username, ip);
CREATE INDEX IF NOT EXISTS idx_parentlink_child ON ParentLink(child_id);
CREATE INDEX IF NOT EXISTS idx_partnership_a ON Partnership(person_a_id);
CREATE INDEX IF NOT EXISTS idx_partnership_b ON Partnership(person_b_id);
CREATE INDEX IF NOT EXISTS idx_album_person ON Album(person_id);
CREATE INDEX IF NOT EXISTS idx_photo_album ON Photo(album_id);
CREATE INDEX IF NOT EXISTS idx_placelived_person ON PlaceLived(person_id);
"""


def connect(path: str, check_same_thread: bool = True) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=check_same_thread)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
