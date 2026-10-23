# Family Tree App: Design Spec

Date: 2026-10-23
Status: Draft for review

## 1. Purpose

A self-hosted family tree (genealogy) app for the owner's family, run on the owner's home lab and reached only over Tailscale. The owner has no coding background, so the app must be easy to update, back up and keep safe. Gramps Web was the visual inspiration but this is a from-scratch build.

### Success criteria
- Family members can add people, link them, attach photos and view the tree on Windows, Apple and Android through a browser (installable to a phone home screen).
- Photos live on the NAS. The live database lives on the VM. Backups to the NAS run on a schedule the admin can set.
- Security updates are one command, and the app warns when a dependency has a known vulnerability.

### Assumptions to confirm
- "Write" permission means adding new people and photos, "edit" means changing existing records, "delete" means removing them.
- Layouts 3 and 4 position people by birth year instead of by generation (see section 5).
- Users are family members: a handful of accounts and a few thousand photos at most.

### Non-goals (YAGNI)
- Native Windows, iOS or Android apps.
- Public internet access, public sign-up, social sign-in.
- Multiple separate family trees. There is one tree.

### Planned for later (not in the first build)
The owner wants these added in later phases. They are out of scope for the first build, but the design should not block them:
- GEDCOM import and export.
- DNA features.
- Maps (places shown on a map).
- Source citations (attaching sources to facts).

Room left for them: places are stored as text now and can later be linked to map coordinates; facts such as birth and death are separate fields so citations can later attach to them; the readable JSON export in section 9 can serve as a starting point for GEDCOM export.

## 2. Architecture

- One Docker container runs a Python (FastAPI) backend and serves the web front end.
- Front end: React with TypeScript, built at image build time into static files. The running container does not need Node. Tree layout and drawing are written in the project (SVG/HTML), not taken from a large graph library, to keep dependencies few.
- Database: SQLite file on the VM's local disk (Docker volume `/data`).
- Photos: stored on the NAS. The VM mounts a NAS share (NFS preferred, SMB acceptable) on the host, for example `/mnt/nas/family-tree`, and docker-compose bind-mounts it into the container at `/photos` (photos) and `/backups` (backups).
- Access: the container listens on the VM only. Reached via Tailscale. No port forwarding.
- Packaging: `docker-compose.yml`, pinned dependency lists, an `update.sh` script and a README written for a non-programmer.

## 3. Data model

All dates are stored as text with explicit precision (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`) so a person can have just a birth year. Each user chooses how dates are shown and typed: `DD-MM-YYYY` (the default, as used in Australia) or `YYYY-MM-DD`. Partial dates display as `MM-YYYY` or `YYYY`. Only the front end converts; stored data and the API always use the year-first form.

- **Person**: id, given names, family name, birth date, birth place, death date, occupation, bio (text), profile photo id (nullable), created/updated timestamps.
- **PlaceLived**: id, person id, place, from year (optional), to year (optional).
- **ParentLink**: parent person id, child person id, kind (biological, adoptive, step, foster).
- **Partnership**: id, two person ids, kind (married, de facto, partner, other), start year, end year (optional).
- **Album**: id, person id, title.
- **Photo**: id, album id, file name on the NAS (random), caption (optional), year (optional), uploaded by, uploaded at.
- **User**: id, username, password hash (argon2id), is_admin, can_read, can_add, can_edit, can_delete, active.
- **Setting**: key/value, used for backup schedule, retention and display defaults.
- **UserPreference**: user id, display options for the tree (which fields show on cards), last layout used.
- **AuditEntry** (simple): user, action, record type and id, timestamp. Shown to the admin.

Siblings are derived from shared parents and are not stored.

## 4. Relationships and the link popup

The user clicks person A then person B, or drags A onto B. A popup asks "How is A related to B?" with a dropdown (parent, child, spouse/partner with kind, sibling) or typed text matched to the options. The user confirms before saving. Every link can be undone from the person's profile.

Rules for mapping the choice to stored records:
- Parent / child choices create a ParentLink.
- Spouse / partner choices create a Partnership.
- Sibling: if either person already has parents, the other person is linked to the same parents. If neither has parents, the app asks the user to pick or create a parent first.
- Duplicate or impossible links (self-link, parent who is younger than child by a clear margin, parent loops) are rejected with a plain-language message. Date-based warnings can be overridden by the user, loops cannot.

On touch screens, tap-then-tap is the main flow. Drag works as well.

## 5. Tree layouts

All four layouts share the same data and card design.

1. **Generations, top-down**: each generation is a row, oldest at top.
2. **Generations, columns**: each generation is a column, youngest on the left, oldest on the right.
3. **Birth year, top-down**: like layout 1, but vertical position is by birth year in bands (for example by decade) so people born around the same time line up across branches.
4. **Birth year, columns**: like layout 2, with columns by birth year bands.

Details:
- Generation is computed from ParentLink. Partners are drawn in the same generation as each other.
- People with no known birth year are placed using their generation neighbours and shown in an "Unknown year" band in layouts 3 and 4.
- A display menu toggles which fields appear on a card: name, photo, birth/death dates, age, occupation. Choices are saved per user.
- The tree can be panned and zoomed. A person can be set as the "focus" person to centre the view.
- Clicking a card opens that person's profile page.

## 6. Profile page

Shows profile photo, name, birth date and place, death date, occupation, partnerships with years, places lived, parents, children, siblings, bio, and albums with photos. Edit controls appear only for users with the edit permission.

## 7. Users and permissions

- The first run creates the admin account. After that only the admin creates, disables or changes users. There is no public sign-up.
- Permissions: read, add, edit, delete. Every API call checks them on the server.
- Sessions use HttpOnly cookies, CSRF protection, login rate limiting and a session timeout that the admin can set.

## 8. Photos and the NAS

- Uploads accept common image types only (checked by content, not just file extension), have a size cap, and are re-encoded to strip embedded metadata and produce thumbnails.
- Files are stored on the NAS with random names and are served only to logged-in users with read permission.
- If the NAS is unavailable: the tree, profiles and text data keep working, photos show a placeholder, uploads fail with a clear message, and the admin page shows a warning.

## 9. Backups

- The admin settings page sets the backup times (one or more times of day, optional days of week), retention (how many copies to keep) and shows the NAS backup folder in use.
- Each backup uses SQLite's online backup mechanism for a consistent copy, writes it to `/backups`, verifies it, and also writes a readable export (people, relationships and bios as JSON).
- A "Back up now" button and a "last backup" status (time, size, success or failure) are on the settings page.
- If the NAS is offline, the backup retries and shows a warning until it succeeds.
- The README includes a restore procedure and the app includes a restore command.

## 10. Updates and security maintenance

- `update.sh`: pulls the latest pinned dependencies, rebuilds the container and restarts it, after taking a backup first.
- A scheduled dependency check warns the admin on the settings page when a library has a known vulnerability.
- Dependencies are kept to a short list of widely used libraries.

## 11. Error handling

- Deleting a person or photo requires confirmation. Deleting a person who has links asks what should happen to those links.
- All user-facing errors are plain-language messages. Details go to the container log.
- Failed saves never leave half-written relationships (changes are in database transactions).

## 12. Testing

- Automated tests: permissions on every endpoint, relationship rules (including sibling and loop rules), partial date handling, layout generation computation, backup and restore.
- Manual check before handover: run the app with a sample family, review all four layouts, the profile pages, the link popup (click and drag), photo upload against a mounted folder, and a backup and restore round trip.

## 13. Build order

1. Backend: database, auth and permissions, people and relationships API.
2. Photos, albums and storage on the mounted NAS folder.
3. Front end: login, people list, profile page, link popup.
4. Tree layouts and display options.
5. Admin settings: users, backup schedule, status.
6. Docker packaging, update script and README.
