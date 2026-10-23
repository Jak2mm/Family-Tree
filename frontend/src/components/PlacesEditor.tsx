import { useState } from "react";
import { ErrorMessage } from "./ErrorMessage";

export interface PlaceDraft {
  key: string;
  id?: number;
  place: string;
  from_year: number | null;
  to_year: number | null;
}

export function describePlace(p: PlaceDraft): string {
  const years = p.from_year && p.to_year ? ` from ${p.from_year} to ${p.to_year}` : p.from_year ? ` from ${p.from_year}` : p.to_year ? ` until ${p.to_year}` : "";
  return `${p.place}${years}`;
}

const YEAR_MESSAGE = "Please enter years as numbers with 1 to 4 digits, for example 1965, or leave them empty.";

/** Empty means unknown (null). Anything that is not 1 to 4 digits, or is 0, is refused rather than guessed at. */
function toYear(text: string): number | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  return /^\d{1,4}$/.test(t) && Number(t) >= 1 ? Number(t) : "bad";
}

export function PlacesEditor({ places, onAdd, onRemove }: { places: PlaceDraft[]; onAdd: (p: PlaceDraft) => void; onRemove: (p: PlaceDraft) => void }) {
  const [place, setPlace] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [error, setError] = useState("");

  const add = () => {
    if (!place.trim()) return;
    const from_year = toYear(from);
    const to_year = toYear(to);
    if (from_year === "bad" || to_year === "bad") return setError(YEAR_MESSAGE);
    if (from_year !== null && to_year !== null && from_year > to_year) {
      return setError("The 'from' year cannot be later than the 'to' year.");
    }
    setError("");
    onAdd({ key: `new-${Date.now()}-${Math.random()}`, place: place.trim(), from_year, to_year });
    setPlace("");
    setFrom("");
    setTo("");
  };

  return (
    <fieldset>
      <legend>Places lived</legend>
      <ul>
        {places.map((p) => (
          <li key={p.key}>
            {describePlace(p)}
            <button type="button" aria-label={`Remove place ${p.place}`} onClick={() => onRemove(p)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="inline-form">
        <label>
          Place
          <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} />
        </label>
        <label>
          From year
          <input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To year
          <input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" onClick={add}>
          Add place
        </button>
      </div>
      <ErrorMessage message={error} />
    </fieldset>
  );
}
