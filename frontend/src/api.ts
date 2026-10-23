import type { AppUser, AuditRow, BackupResult, BackupSettings, BackupStatus, DependencyCheck, LinkInfo, Me, NewLink, PersonInput, PersonSummary, PlaceLived, Preferences, Profile, TreeData } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
  }
  get links(): LinkInfo[] {
    return Array.isArray(this.data.links) ? (this.data.links as LinkInfo[]) : [];
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

let csrfToken = "";
let unauthorized: () => void = () => {};

/** Requests that may legitimately get 401 without meaning "your session ended". */
const SIGNED_OUT_OK = new Set(["/api/login", "/api/me", "/api/setup", "/api/setup/status"]);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // the browser sets the multipart boundary itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Could not reach the server. Please check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* an empty or non-JSON body falls through to the generic message below */
  }
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.";
    if (res.status === 401 && !SIGNED_OUT_OK.has(path)) unauthorized();
    throw new ApiError(res.status, detail, data);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  setCsrfToken(token: string) {
    csrfToken = token;
  },
  /** Called when a request made while signed in is refused with 401 (the session ended). */
  onUnauthorized(callback: () => void) {
    unauthorized = callback;
  },
  setupStatus: () => request<{ needed: boolean }>("GET", "/api/setup/status"),
  setup: (username: string, password: string) => request<AppUser>("POST", "/api/setup", { username, password }),
  async login(username: string, password: string): Promise<Me> {
    const me = await request<Me>("POST", "/api/login", { username, password });
    csrfToken = me.csrf_token;
    return me;
  },
  logout: () => request<{ ok: boolean }>("POST", "/api/logout"),
  async me(): Promise<Me> {
    const me = await request<Me>("GET", "/api/me");
    csrfToken = me.csrf_token;
    return me;
  },
  getPreferences: () => request<Preferences>("GET", "/api/me/preferences"),
  savePreferences: (changes: Partial<Preferences>) => request<Preferences>("PUT", "/api/me/preferences", changes),

  listPeople: () => request<PersonSummary[]>("GET", "/api/people"),
  getPerson: (id: number) => request<Profile>("GET", `/api/people/${id}`),
  savePerson: (id: number | null, data: PersonInput) =>
    id === null ? request<Profile>("POST", "/api/people", data) : request<Profile>("PATCH", `/api/people/${id}`, data),
  deletePerson: (id: number, links: "refuse" | "remove") => request<void>("DELETE", `/api/people/${id}?links=${links}`),
  addPlace: (id: number, place: Omit<PlaceLived, "id">) => request<PlaceLived>("POST", `/api/people/${id}/places`, place),
  removePlace: (id: number, placeId: number) => request<void>("DELETE", `/api/people/${id}/places/${placeId}`),

  addAlbum: (id: number, title: string) => request<{ id: number }>("POST", `/api/people/${id}/albums`, { title }),
  deleteAlbum: (albumId: number) => request<void>("DELETE", `/api/albums/${albumId}`),
  uploadPhoto(albumId: number, file: File, caption: string, year: string) {
    const form = new FormData();
    form.append("file", file);
    if (caption.trim()) form.append("caption", caption.trim());
    if (year.trim()) form.append("year", year.trim());
    return request<{ id: number }>("POST", `/api/albums/${albumId}/photos`, form);
  },
  deletePhoto: (photoId: number) => request<void>("DELETE", `/api/photos/${photoId}`),
  setProfilePhoto: (personId: number, photoId: number) => request<Profile>("PUT", `/api/people/${personId}/profile-photo/${photoId}`),

  createLink: (link: NewLink, force = false) => request<{ ids: string[] }>("POST", `/api/links${force ? "?force=1" : ""}`, link),
  undoLink: (linkId: string) => request<void>("DELETE", `/api/links/${enc(linkId)}`),
  getTree: () => request<TreeData>("GET", "/api/tree"),

  getBackupSettings: () => request<BackupSettings>("GET", "/api/settings/backup"),
  saveBackupSettings: (settings: Record<string, unknown>) => request<BackupSettings>("PUT", "/api/settings/backup", settings),
  backupStatus: () => request<BackupStatus>("GET", "/api/backup/status"),
  runBackup: () => request<BackupResult>("POST", "/api/backup/run"),
  getDependencyCheck: () => request<DependencyCheck>("GET", "/api/settings/dependency-check"),
  runDependencyCheck: () => request<DependencyCheck>("POST", "/api/settings/dependency-check"),
  listAudit: () => request<AuditRow[]>("GET", "/api/audit?limit=50"),
  listUsers: () => request<AppUser[]>("GET", "/api/users"),
  createUser: (user: Record<string, unknown>) => request<AppUser>("POST", "/api/users", user),
  updateUser: (id: number, changes: Record<string, unknown>) => request<AppUser>("PATCH", `/api/users/${id}`, changes),
};

export const thumbUrl = (photoId: number) => `/api/photos/${photoId}/thumb`;
export const photoUrl = (photoId: number) => `/api/photos/${photoId}/file`;
