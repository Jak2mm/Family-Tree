import type { DateFormat } from "./dates";

export interface Me {
  id: number;
  username: string;
  is_admin: boolean;
  can_read: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
  csrf_token: string;
}

export interface Preferences {
  layout: number;
  card_fields: string[];
  date_format: DateFormat;
}

export interface PersonSummary {
  id: number;
  name: string;
  birth_date: string | null;
  death_date: string | null;
  profile_photo_id: number | null;
}

export interface Relative {
  id: number;
  name: string;
  link_id?: string;
  kind?: string;
  half?: boolean;
  start_year?: number | null;
  end_year?: number | null;
}

export interface PlaceLived {
  id: number;
  place: string;
  from_year: number | null;
  to_year: number | null;
}

export interface Photo {
  id: number;
  caption: string | null;
  year: number | null;
}

export interface Album {
  id: number;
  title: string;
  photos: Photo[];
}

export interface Profile {
  id: number;
  name: string;
  given_names: string;
  family_name: string;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  occupation: string | null;
  bio: string;
  profile_photo_id: number | null;
  places_lived: PlaceLived[];
  parents: Relative[];
  children: Relative[];
  siblings: Relative[];
  partnerships: Relative[];
  albums: Album[];
}

export interface PersonInput {
  given_names: string;
  family_name: string;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  occupation: string | null;
  bio: string;
}

export interface LinkInfo {
  kind: "parent" | "child" | "partner";
  id: number;
  name: string;
  link_id: string;
}

export interface NewLink {
  a: number;
  b: number;
  relation: "parent" | "child" | "spouse" | "sibling";
  parent_kind?: "biological" | "adoptive" | "step" | "foster";
  partnership_kind?: "married" | "de facto" | "partner" | "other";
  start_year?: number | null;
  parent_id?: number | null;
}

export interface PartnershipChanges {
  kind: NonNullable<NewLink["partnership_kind"]>;
  start_year: number | null;
  end_year: number | null;
}

export interface TreePerson {
  id: number;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  generation: number;
  photo_id: number | null;
  occupation: string | null;
  birth_date: string | null;
  death_date: string | null;
}

export interface TreeData {
  people: TreePerson[];
  parent_links: [number, number][];
  partnerships: [number, number][];
}

export interface AppUser {
  id: number;
  username: string;
  is_admin: boolean;
  can_read: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
  active: boolean;
}

export interface BackupSettings {
  times: string[];
  days: number[] | null;
  retention: number;
  session_timeout_hours: number;
  backup_folder: string;
  /** The zone the backup times are read in. */
  timezone?: string;
}

export interface BackupStatus {
  last_run: string | null;
  ok: boolean | null;
  size: number | null;
  error: string | null;
  nas_available: boolean;
  warning: string | null;
  next_run: string | null;
  retry: { retrying: boolean; next_retry_at: string | null };
}

export interface BackupResult {
  ok: boolean;
  path: string | null;
  size: number | null;
  error: string | null;
}

export interface Vulnerability {
  package: string;
  version: string | null;
  id: string;
  fix_versions: string[];
  description: string;
}

export interface DependencyCheck {
  checked_at: string | null;
  vulnerabilities: Vulnerability[];
  check_failed: boolean;
  message: string;
}

export interface AuditRow {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  record_type: string;
  record_id: number | null;
  created_at: string;
}
