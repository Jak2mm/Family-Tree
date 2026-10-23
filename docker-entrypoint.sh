#!/bin/sh
# Starts whatever command it is given (the app, a backup, a restore) after one safety check.
#
# The NAS share is mounted read-only at /nas just so this script can look for the marker file
# ".family-tree-nas-ok". If the share is not really mounted (the marker is missing), the photos
# and backups folders could be empty folders on the VM's own disk. Writing there would look like
# it worked and then vanish when the NAS comes back. So in that case we point the app at folders
# that do not exist: the app then shows its normal "NAS offline" warning, refuses uploads and
# retries backups, and nothing is written to the wrong place.
set -eu

if [ ! -f /nas/.family-tree-nas-ok ]; then
    echo "WARNING: /nas/.family-tree-nas-ok was not found. The NAS share is probably not mounted." >&2
    echo "WARNING: Photos and backups are switched off until the NAS is back. Then run: docker compose restart" >&2
    export FAMILY_TREE_PHOTOS_DIR=/nas-offline/photos
    export FAMILY_TREE_BACKUPS_DIR=/nas-offline/backups
fi

exec "$@"
