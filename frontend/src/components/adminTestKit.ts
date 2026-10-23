import { PREFS, type Handler } from "../test-utils";

export const SETTINGS = { times: ["02:00"], days: null, retention: 14, session_timeout_hours: 8, backup_folder: "/backups" };
export const STATUS_OK = {
  last_run: "2026-10-20T12:00:00+00:00", ok: true, size: 2048, error: null, nas_available: true, warning: null, next_run: null,
  retry: { retrying: false, next_retry_at: null },
};
export const CHECK = { checked_at: "2026-10-20T12:00:00+00:00", vulnerabilities: [], check_failed: false, message: "No known vulnerabilities were found." };
export const ADMIN = { id: 1, username: "sam", is_admin: true, can_read: true, can_add: true, can_edit: true, can_delete: true, active: true };
export const BOB = { id: 2, username: "bob", is_admin: false, can_read: true, can_add: false, can_edit: false, can_delete: false, active: true };

export function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/me/preferences": { body: PREFS },
    "GET /api/users": { body: [ADMIN, BOB] },
    "GET /api/settings/backup": { body: SETTINGS },
    "GET /api/backup/status": { body: STATUS_OK },
    "GET /api/settings/dependency-check": { body: CHECK },
    "GET /api/audit?limit=50": { body: [] },
    ...extra,
  };
}
