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
