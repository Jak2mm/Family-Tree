#!/usr/bin/env bash
# Updates the Family Tree app: backs up first, rebuilds with the newest base images and the
# pinned libraries, restarts, and tells you whether it came up healthy.
# Run it from this folder:   ./update.sh
#
# This script does NOT download new versions of the app's own code. Put the new code in this
# folder first (however you got it). If this folder is a git checkout you can add the optional
# step by running:   ./update.sh --pull
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

PULL=0
case "${1:-}" in
    "") ;;
    --pull) PULL=1 ;;
    *) fail "I do not know what '$1' means. Use ./update.sh on its own, or ./update.sh --pull to fetch new code with git first." ;;
esac
[ "$#" -le 1 ] || fail "Too many options. Use ./update.sh on its own, or ./update.sh --pull."

[ -f .env ] || fail "There is no .env file here. Copy .env.example to .env and fill it in first (see README.md)."
docker compose version >/dev/null 2>&1 || fail "Docker Compose is not available. Is Docker installed and running?"

BACKUP_FAILED="The backup failed, so nothing was changed. Fix the problem (is the NAS switched on and mounted? see README.md, Troubleshooting) and run ./update.sh again."

say "Step 1 of 5: taking a backup first"
if [ -n "$(docker compose ps --status running --quiet app 2>/dev/null)" ]; then
    docker compose exec -T app python -m app.backup run || fail "$BACKUP_FAILED"
elif docker image inspect family-tree:latest >/dev/null 2>&1; then
    echo "The app is stopped, so the backup is taken with a one-off copy of it."
    docker compose run --rm --no-deps app python -m app.backup run || fail "$BACKUP_FAILED"
else
    echo "This looks like a first install (the app has never been built here), so there is nothing to back up yet. Carrying on."
fi

if [ "$PULL" -eq 1 ]; then
    say "Optional step: fetching the newest code with git"
    git pull --ff-only || fail "git could not update this folder cleanly. Nothing has been rebuilt yet; the app is still running the old version."
fi

say "Step 2 of 5: building the new version (this can take a few minutes)"
docker compose build --pull || fail "The build failed. The app is still running the old version. Check your internet connection and try again."

say "Step 3 of 5: starting the new version"
docker compose up -d || fail "Docker could not start the app. Run 'docker compose logs app' to see why."

say "Step 4 of 5: waiting for the app to wake up (up to 90 seconds)"
status=""
for _ in $(seq 1 45); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' family-tree 2>/dev/null || true)"
    [ "$status" = "healthy" ] && break
    sleep 2
done

say "Step 5 of 5: result"
echo "Health status: ${status:-unknown}"
if [ "$status" = "healthy" ]; then
    echo "All good. The app is running the new version."
    docker compose ps
else
    echo "The app did not report healthy in time. Recent log lines:" >&2
    docker compose logs --tail 20 app >&2 || true
    fail "Something is wrong. See README.md, Troubleshooting. Your data and the backup from step 1 are safe."
fi
