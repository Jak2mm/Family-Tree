import { formatDate, type DateFormat } from "../dates";
import type { AuditRow } from "../types";

const two = (n: number) => String(n).padStart(2, "0");

/** A server timestamp shown in the person's date style and local 24-hour time, like "20-10-2026 14:30". */
export function when(iso: string, format: DateFormat): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return `${formatDate(day, format)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "unknown size";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const VERBS: Record<string, string> = { create: "added", update: "changed", delete: "deleted", run: "ran", setup: "set up" };
const NOUNS: Record<string, string> = {
  person: "person", user: "user account", settings: "the settings", backup: "a backup", dependency_check: "the update check",
  preferences: "their preferences", parent_link: "parent link", partnership: "partnership", album: "album", photo: "photo", place: "place lived",
};

export function describeAudit(entry: AuditRow): { who: string; what: string } {
  const verb = VERBS[entry.action] ?? entry.action;
  const noun = NOUNS[entry.record_type] ?? entry.record_type;
  const about = entry.subject ? `: ${entry.subject}` : entry.record_id === null ? "" : ` ${entry.record_id}`;
  return { who: entry.username ?? "A removed user", what: `${verb} ${noun}${about}` };
}
