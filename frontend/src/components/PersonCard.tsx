import type { PointerEvent } from "react";
import { thumbUrl } from "../api";
import { formatDate, type DateFormat } from "../dates";
import { CARD_H, CARD_W } from "../layout/layoutTree";
import type { TreePerson } from "../types";

export function ageText(p: TreePerson, thisYear: number): string {
  if (p.birth_year === null) return "";
  const years = (p.death_year ?? thisYear) - p.birth_year;
  if (years < 0) return "";
  return p.death_year === null ? `age ${years}` : `died aged ${years}`;
}

export function datesText(p: TreePerson, fmt: DateFormat): string {
  const born = p.birth_date ? formatDate(p.birth_date, fmt) : p.birth_year === null ? "" : String(p.birth_year);
  const died = p.death_date ? formatDate(p.death_date, fmt) : p.death_year === null ? "" : String(p.death_year);
  if (born && died) return `${born} – ${died}`;
  return born ? `Born ${born}` : died ? `Died ${died}` : "";
}

interface Props {
  person: TreePerson;
  x: number;
  y: number;
  fields: string[];
  dateFormat: DateFormat;
  /** null outside link mode; otherwise whether this card is the one picked first. */
  picked: boolean | null;
  focused: boolean;
  onActivate: () => void;
  onPointerDown: (e: PointerEvent) => void;
}

export function PersonCard({ person, x, y, fields, dateFormat, picked, focused, onActivate, onPointerDown }: Props) {
  const shows = (f: string) => fields.includes(f);
  const lines = [shows("dates") && datesText(person, dateFormat), shows("age") && ageText(person, new Date().getFullYear())].filter(Boolean);
  return (
    <button
      type="button"
      className={`tree-card${picked ? " picked" : ""}${focused ? " focused" : ""}`}
      style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
      data-person-id={person.id}
      data-focused={focused || undefined}
      aria-pressed={picked === null ? undefined : picked}
      onClick={onActivate}
      onPointerDown={onPointerDown}
    >
      {shows("photo") &&
        (person.photo_id ? (
          <img src={thumbUrl(person.photo_id)} alt="" className="card-photo" draggable={false} />
        ) : (
          <span className="card-photo placeholder" aria-hidden="true">
            {person.name.trim().charAt(0).toUpperCase()}
          </span>
        ))}
      <span className="card-text">
        <strong className={shows("name") ? "card-name" : "sr-only"}>{person.name}</strong>
        {lines.map((line) => (
          <span key={String(line)} className="muted">{line}</span>
        ))}
        {shows("occupation") && person.occupation && <span className="muted">{person.occupation}</span>}
      </span>
    </button>
  );
}
