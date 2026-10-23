# Family Tree App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted family tree web app (FastAPI + SQLite + React) with linked people, profile pages, albums on a NAS-mounted folder, four tree layouts, user permissions and scheduled backups.

**Architecture:** One Docker container. FastAPI serves a JSON API under `/api` and the built React app as static files. SQLite lives in `/data`; photos in `/photos` and backups in `/backups` are bind mounts of a NAS share mounted on the VM host. Tree positions are computed by pure functions in the front end; generation numbers come from the backend.

**Tech Stack:** Python 3.13, FastAPI, uvicorn, stdlib `sqlite3` (no ORM), Pillow, argon2-cffi, python-multipart, pip-audit; pytest and httpx for tests. React + TypeScript + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-family-tree-app-design.md`

## Global Constraints

- Backend is Python with FastAPI; database is a SQLite file in `/data`; photos in `/photos`; backups in `/backups`.
- Dates are text with precision: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
- Passwords hashed with argon2id; sessions use HttpOnly cookies with CSRF protection and login rate limiting; no public sign-up; first run creates the admin.
- Permissions are read, add, edit, delete, checked on the server for every endpoint. Add = new people/photos/links, edit = change existing records, delete = remove.
- Uploads: image types only, checked by content; size cap; re-encoded (metadata stripped, thumbnail made); stored with random file names; served only to users with read permission.
- Four tree layouts: 1 generations as rows (oldest top); 2 generations as columns (youngest left, oldest right); 3 = layout 1 by birth-year bands; 4 = layout 2 by birth-year bands. Card fields toggle: name, photo, dates, age, occupation, saved per user.
- Front end is React + TypeScript built at image build time (no Node at runtime); tree drawn with project code (SVG/HTML), no graph library.
- Backups use SQLite's online backup, are verified, and also write a readable JSON export. Backup times, retention and NAS path are admin settings, with "Back up now" and last-backup status.
- The app listens on the VM only (reached over Tailscale, no port forwarding). Keep the dependency list short.
- User-facing errors are plain-language messages; details go to the log. Multi-row changes run in one transaction.
- Decisions this plan fixes where the spec is silent: upload cap 15 MB; session timeout default 8 hours (admin setting); lock a username/IP pair for 15 minutes after 5 failed logins; default backup retention 14; thumbnails 320 px wide.
- Commit messages end with the trailer lines `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_014GCKf8ES3jhwBXtQXc8BRu`.

## Review Focus

1. A person with two partnerships and half-siblings (children from different partnerships) lays out and links correctly.
2. A person with no birth year (or only a year) in layouts 3 and 4 goes in the "Unknown year" band without crashing.
3. Deleting a person who has links, albums or photos asks what to do and never leaves orphan rows or files.
4. A corrupt image, or a non-image renamed `.jpg`, is rejected with a plain message and nothing is saved.
5. NAS folder missing or read-only during upload or backup: the app keeps working, shows a warning, and retries backups.

## File Structure

```
backend/app/config.py        Settings from environment (paths, secret key)
backend/app/db.py            connect(), init_db(), schema
backend/app/dates.py         partial date parse/compare
backend/app/security.py      password hashing, sessions, CSRF, rate limit
backend/app/auth.py          setup/login/logout/me + require() permission dependency
backend/app/users.py         admin user management
backend/app/audit.py         record(), list
backend/app/people.py        people and places-lived API
backend/app/links.py         relationship rules + links API
backend/app/tree.py          compute_generations() and /api/tree
backend/app/photos.py        albums, photos, image processing, NAS handling
backend/app/backup.py        backup, export, restore, scheduler, status
backend/app/settings_api.py  admin settings + dependency check
backend/app/main.py          create_app()
backend/tests/               pytest files named test_<module>.py
frontend/src/api.ts          typed API client
frontend/src/layout/layoutTree.ts   pure layout functions (+ .test.ts)
frontend/src/components/     Login, PeopleList, PersonCard, TreeView, LinkPopup, ProfilePage, AdminSettings
Dockerfile, docker-compose.yml, update.sh, README.md, requirements.txt, requirements-dev.txt
```

---

### Task 1: Skeleton, database schema and partial dates

**Files:**
- Create: `backend/app/{config,db,dates,main}.py`, `backend/tests/{conftest,test_dates,test_db}.py`, `requirements.txt`, `requirements-dev.txt`
- Create: `.gitignore` (venv, node_modules, data folders)

**Interfaces:**
- Produces: `Settings` dataclass (`data_dir, photos_dir, backups_dir, secret_key`), `load_settings() -> Settings`; `connect(path: str) -> sqlite3.Connection` (row factory, foreign keys on, WAL); `init_db(conn) -> None` creating all tables from spec section 3; `parse_date(s: str) -> PartialDate` (`year: int, month: int|None, day: int|None`), raises `ValueError`; `sort_key(s: str|None) -> tuple`; `create_app(settings: Settings | None = None) -> FastAPI`. `conftest.py` fixture `client` builds an app over a temp directory.

- [ ] **Step 1: Write failing tests**
  - `test_dates.py`: `parse_date("1950")` has `month is None`; `parse_date("1950-03-07").day == 7`; `parse_date("1950-13")`, `parse_date("19")`, `parse_date("1950-02-30")` raise `ValueError`; `sort_key("1950") < sort_key("1950-06") < sort_key("1951")`; `sort_key(None)` sorts after any date.
  - `test_db.py`: after `init_db`, tables Person, PlaceLived, ParentLink, Partnership, Album, Photo, User, Setting, UserPreference, AuditEntry exist; inserting a ParentLink for a missing person fails (foreign keys on); a person cannot be their own parent (CHECK constraint).
- [ ] **Step 2: Run** `cd backend && pytest -v` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the signatures above. Pin versions in `requirements.txt`; `GET /api/health` in `create_app` returns `{"status": "ok"}`.
- [ ] **Step 4: Run** `pytest -v` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: backend skeleton, schema and partial dates`.

---

### Task 2: Authentication, sessions and permissions

**Files:**
- Create: `backend/app/{security,auth,users,audit}.py`, `backend/tests/{test_auth,test_users}.py`
- Modify: `backend/app/main.py` (include routers)

**Interfaces:**
- Consumes: `connect`, `Settings`.
- Produces: `hash_password(p: str) -> str`, `verify_password(p: str, h: str) -> bool` (argon2id); `require(*perms: str)` FastAPI dependency (`perms` from `"read","add","edit","delete","admin"`) returning `CurrentUser(id, username, is_admin, can_read, can_add, can_edit, can_delete)`; mutating requests need an `X-CSRF-Token` header equal to the session's token; `audit.record(conn, user_id: int, action: str, record_type: str, record_id: int | None) -> None`.
- Endpoints: `POST /api/setup` (only while no users exist), `POST /api/login`, `POST /api/logout`, `GET /api/me` (includes `csrf_token`), `GET/POST/PATCH /api/users` (admin only), `GET /api/audit` (admin only).

- [ ] **Step 1: Write failing tests**
  - Setup works once, then returns 403; the setup user is admin with all four permissions.
  - Login with wrong password returns 401; 5 failures lock that username+IP (429) until 15 minutes pass (inject clock).
  - A mutating request without the CSRF header returns 403.
  - A user with only `can_read` gets 403 on a test route requiring `"edit"`; admin can create a user with chosen permissions; non-admin cannot list users; disabled user cannot log in; session older than the timeout is rejected.
  - Password stored is not the plain text and starts with `$argon2id$`.
- [ ] **Step 2: Run** `pytest backend/tests/test_auth.py backend/tests/test_users.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement.** Sessions stored in a table with random tokens; cookie `HttpOnly`, `SameSite=Strict`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: auth, sessions, permissions and user admin`.

---

### Task 3: People and places lived

**Files:**
- Create: `backend/app/people.py`, `backend/tests/test_people.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `require`, `parse_date`, `audit.record`.
- Produces: `GET /api/people` (id, display name, birth/death dates, profile photo id), `POST /api/people` (add), `GET /api/people/{id}` (full profile incl. places, parents, children, siblings, partnerships, albums — relations filled in by Task 4), `PATCH /api/people/{id}` (edit), `DELETE /api/people/{id}?links=refuse|remove` (delete; Task 4 supplies the link handling), `POST /api/people/{id}/places`, `DELETE /api/people/{id}/places/{place_id}`. `PUT /api/me/preferences` stores `{layout: 1-4, card_fields: [...]}`.

- [ ] **Step 1: Write failing tests**
  - Create with only a birth year `"1932"` succeeds; birth `"1932-02-30"` returns 422 with a plain message; death earlier than birth returns 422.
  - Names with apostrophes, accents and 200 characters round-trip unchanged; bio of 20,000 characters round-trips.
  - Read-only user gets 403 on POST/PATCH/DELETE; a user with `add` but not `edit` can create but not PATCH.
  - Each write adds an AuditEntry.
- [ ] **Step 2: Run** `pytest backend/tests/test_people.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** the endpoints; validate dates through `parse_date`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: people and places lived API`.

---

### Task 4: Relationships, link rules and generations

**Files:**
- Create: `backend/app/{links,tree}.py`, `backend/tests/{test_links,test_tree}.py`
- Modify: `backend/app/people.py` (profile relations, delete handling), `backend/app/main.py`

**Interfaces:**
- Consumes: Task 3 people endpoints.
- Produces: `POST /api/links` body `{a: int, b: int, relation: "parent"|"child"|"spouse"|"sibling", partnership_kind?: "married"|"de facto"|"partner"|"other", start_year?: int, parent_id?: int}` meaning "a is the `relation` of b"; returns the created link ids. `DELETE /api/links/{link_id}` (undo; ids are prefixed `p:` for parent links and `c:` for partnerships). `compute_generations(person_ids: list[int], parent_links: list[tuple[int,int]], partnerships: list[tuple[int,int]]) -> dict[int, int]` (0 = oldest). `GET /api/tree` returns `{people: [{id, name, birth_year|null, death_year|null, generation, photo_id|null}], parent_links, partnerships}`.
- Rules: a person's generation is the longest chain of parents above them; partners take the larger of the two generations and their ancestors are not moved. Sibling: if either has parents, link the other to the same parents; if neither has, return 409 with `needs_parent: true` unless `parent_id` given. Reject self-links, duplicates and parent loops (422, cannot be overridden). A parent born less than 12 years before the child returns 409 `warning: true`, accepted when resent with `?force=1`.

- [ ] **Step 1: Write failing tests**
  - `compute_generations`: grandparent→parent→child gives 0,1,2; a partner from a family with no known ancestors gets the same generation as their partner; person with two partnerships and children from each (half-siblings) get one generation, and the half-siblings are siblings of each other through the shared parent only.
  - Link rules: parent-of-self rejected; A parent of B then B parent of A rejected (loop); duplicate link rejected; sibling with no parents returns 409 `needs_parent`; sibling with parents links to the same parents; 11-year age gap returns warning and succeeds with `force=1`.
  - Delete a person with links and `links=refuse` returns 409 listing the links; with `links=remove` removes links, albums and photo rows in one transaction and leaves no orphan rows; undo a link restores the prior state.
  - Read-only user gets 403 on POST/DELETE links.
- [ ] **Step 2: Run** `pytest backend/tests/test_links.py backend/tests/test_tree.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement.** Loop check by walking ancestors of the proposed parent.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: relationships, link rules and generations`.

---

### Task 5: Albums and photos on the mounted folder

**Files:**
- Create: `backend/app/photos.py`, `backend/tests/test_photos.py`, `backend/tests/fixtures/` (small valid JPEG/PNG, a text file named `fake.jpg`, a truncated JPEG)
- Modify: `backend/app/main.py`, `backend/app/people.py` (delete removes files)

**Interfaces:**
- Consumes: `Settings.photos_dir`, `require`.
- Produces: `POST /api/people/{id}/albums` (add), `POST /api/albums/{id}/photos` (multipart, add; optional `caption`, `year`), `GET /api/photos/{id}/file` and `/thumb` (read), `DELETE /api/photos/{id}` (delete), `PUT /api/people/{id}/profile-photo/{photo_id}` (edit). `process_image(data: bytes) -> tuple[bytes, bytes]` returns (re-encoded full image, thumbnail 320 px wide), raises `ValueError` with a plain message. `nas_available() -> bool` (photos folder exists and is writable).

- [ ] **Step 1: Write failing tests**
  - Valid JPEG and PNG upload succeed; stored file name is random and not the original name; stored image has no EXIF; thumbnail width is 320.
  - `fake.jpg` (text) and the truncated JPEG return 422 with a plain message and create no row and no file; a 16 MB upload returns 413; a unicode file name uploads fine.
  - With the photos folder removed, upload returns 503 with "photo storage is offline", and `GET /api/people` still works; photo file requests return a placeholder image (200) while offline.
  - A read-only user can fetch a photo; an unauthenticated request gets 401; read-only user cannot upload or delete.
  - Deleting a photo removes the file; deleting a person removes their photo files.
- [ ] **Step 2: Run** `pytest backend/tests/test_photos.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** with Pillow (`Image.open`, verify, re-save without metadata).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: albums and photos with NAS-safe storage`.

---

### Task 6: Backups, restore and settings API

**Files:**
- Create: `backend/app/{backup,settings_api}.py`, `backend/tests/{test_backup,test_settings}.py`
- Modify: `backend/app/main.py` (start scheduler thread on startup)

**Interfaces:**
- Consumes: `Settings.backups_dir`, `connect`.
- Produces: `run_backup(settings, now: datetime) -> BackupResult(ok: bool, path: str|None, size: int, error: str|None)` (SQLite online backup into `/backups/family-tree-<timestamp>.db`, integrity check on the copy, JSON export `…-export.json` of people, relationships and bios, prune beyond retention); `restore_backup(settings, path: str) -> None`; `due_now(schedule: list[str], days: list[int]|None, last_run: datetime|None, now: datetime) -> bool`; `scheduler_loop(settings, clock)` checking every minute, retrying every 15 minutes after a failure.
- Endpoints (admin): `GET/PUT /api/settings/backup` (times `["02:00"]`, optional weekdays, retention, `session_timeout_hours`), `POST /api/backup/run`, `GET /api/backup/status` (last time, size, ok, error, NAS online), `GET /api/settings/dependency-check` (runs `pip-audit --format json`; returns vulnerabilities or `check_failed`).
- CLI: `python -m app.backup restore <file>` for the README restore procedure.

- [ ] **Step 1: Write failing tests**
  - `run_backup` creates a `.db` that opens, passes `PRAGMA integrity_check`, and contains the same people count; JSON export lists people and bios; with 16 backups and retention 14 only the newest 14 remain.
  - `due_now`: true at the scheduled minute once per day, false after it has run, false off weekdays.
  - `/backups` missing or read-only: `run_backup` returns `ok=False` with a plain error, the app still serves requests, status shows NAS offline, and the next scheduler tick after the folder returns succeeds.
  - Restore replaces the live database and the people count matches the backup.
  - Non-admin gets 403 on all settings and backup endpoints; invalid time `"25:99"` returns 422.
- [ ] **Step 2: Run** `pytest backend/tests/test_backup.py backend/tests/test_settings.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** using `sqlite3.Connection.backup`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: scheduled backups, restore and admin settings`.

---

### Task 7: Front end foundation, login, people and profile pages

**Files:**
- Create: `frontend/` (Vite React TypeScript app), `frontend/src/api.ts`, `frontend/src/components/{Login,PeopleList,ProfilePage,PersonForm}.tsx`, `frontend/public/manifest.webmanifest` and icons
- Modify: `backend/app/main.py` (serve `frontend/dist` and fall back to `index.html`)

**Interfaces:**
- Consumes: all `/api` endpoints from Tasks 2–5.
- Produces: `api` object in `api.ts` with typed functions (`login`, `me`, `listPeople`, `getPerson`, `savePerson`, `deletePerson`, `uploadPhoto`, `createLink`, `undoLink`, `getTree`, backup and settings calls) that attach the CSRF header; `useMe()` hook exposing `{user, can(perm)}`.

- [ ] **Step 1: Write failing tests** (vitest + testing-library): `Login` shows the server's plain-language error on 401; `ProfilePage` hides edit/delete controls when `can("edit")` and `can("delete")` are false and shows them otherwise; `PersonForm` accepts "1932" as a birth date and shows the server's message for an invalid date.
- [ ] **Step 2: Run** `cd frontend && npx vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** the components; profile page shows the fields listed in spec section 6; the first-run screen calls `/api/setup` when `/api/me` says no users exist.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat: front end login, people list and profile pages`.

---

### Task 8: Link popup, tree layouts and display options

**Files:**
- Create: `frontend/src/layout/layoutTree.ts`, `frontend/src/layout/layoutTree.test.ts`, `frontend/src/components/{TreeView,PersonCard,LinkPopup,DisplayMenu}.tsx`

**Interfaces:**
- Consumes: `api.getTree`, `api.createLink`, `api.undoLink`, `PUT /api/me/preferences`.
- Produces: `layoutTree(data: TreeData, layout: 1|2|3|4, bandYears?: number) -> {nodes: {id: number, x: number, y: number}[], bands: {label: string, start: number, size: number}[], width: number, height: number}`. Layouts 1 and 3 put generations/bands on rows, oldest first; layouts 2 and 4 put them on columns, youngest at the left. In layouts 3 and 4 people with no birth year go in a band labelled "Unknown year" placed after the dated bands. Partners sit next to each other; children are centred under their parents' partnership.

- [ ] **Step 1: Write failing tests** (`layoutTree.test.ts`): layout 1 gives larger `y` for later generations; layout 2 gives smaller `x` for younger generations; layout 3 places two cousins born 1971 and 1974 in the same band although one is a generation lower; person with no birth year is in the "Unknown year" band; person with two partnerships and children from each has no overlapping nodes (`no two nodes within one card size`); a tree of 300 people lays out in under 500 ms. Component tests: clicking card A then card B opens `LinkPopup` titled "How is A related to B?"; choosing a relation calls `createLink({a, b, relation})` only after Confirm; dropping card A on card B opens the same popup; a 409 `warning` response shows the warning and a "Link anyway" button that resends with force; the display menu hides the photo when its toggle is off and saves the choice.
- [ ] **Step 2: Run** `npx vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** `layoutTree` as a pure function; draw with SVG, pan and zoom by pointer events, tap-then-tap on touch, "focus person" re-centres the view.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: tree layouts, link popup and display options`.

---

### Task 9: Admin settings screen

**Files:**
- Create: `frontend/src/components/AdminSettings.tsx`, `frontend/src/components/AdminSettings.test.tsx`

**Interfaces:**
- Consumes: users, backup, settings and dependency-check endpoints.

- [ ] **Step 1: Write failing tests**: non-admin never sees the Settings link; admin can create a user with chosen permissions; saving backup times `["02:00","14:00"]` calls `PUT /api/settings/backup`; the page shows "NAS offline" and the last error when status says so; "Back up now" shows the result; dependency warnings are listed, and `check_failed` shows "Could not check for updates"; the recent activity list (from `GET /api/audit`) shows who changed what and when.
- [ ] **Step 2: Run** `npx vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** the screen.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin settings screen`.

---

### Task 10: Docker packaging, update script, README and full check

**Files:**
- Create: `Dockerfile` (multi-stage: Node builds the front end, Python image runs the app), `docker-compose.yml`, `update.sh`, `README.md`, `scripts/seed_sample_family.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `docker compose up -d` starts the app with `/data` as a named volume and `/photos`, `/backups` as bind mounts from `${NAS_MOUNT}` set in `.env`; `update.sh` takes a backup (`POST` via `python -m app.backup`), rebuilds with `--pull`, restarts and prints the app health; `seed_sample_family.py` loads a sample 4-generation family (with a remarriage and half-siblings) into a running instance.

- [ ] **Step 1: Write failing check:** `docker compose build` succeeds and `curl localhost:8000/api/health` returns `{"status":"ok"}` from the running container; `README.md` includes setup, mounting the NAS (NFS and SMB examples), first login, update, backup/restore, and Tailscale-only access.
- [ ] **Step 2: Run** `docker compose build && docker compose up -d` — Expected: FAIL until files exist.
- [ ] **Step 3: Implement** the files; container runs as a non-root user.
- [ ] **Step 4: Run the full check:** `cd backend && pytest -q`, `cd frontend && npx vitest run && npx tsc --noEmit`, then start the container, run the seed script, and by hand verify all four layouts, the click and drag link popup, a photo upload to the mounted folder, "Back up now", and a restore round trip. Expected: all automated tests pass; manual checks written up in the final message.
- [ ] **Step 5: Commit** `feat: Docker packaging, update script and README`.
