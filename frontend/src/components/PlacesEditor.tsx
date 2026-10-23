import { useState } from "react";

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

const toYear = (text: string) => (text.trim() ? Number(text) : null);

export function PlacesEditor({ places, onAdd, onRemove }: { places: PlaceDraft[]; onAdd: (p: PlaceDraft) => void; onRemove: (p: PlaceDraft) => void }) {
  const [place, setPlace] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const add = () => {
    if (!place.trim()) return;
    onAdd({ key: `new-${Date.now()}-${Math.random()}`, place: place.trim(), from_year: toYear(from), to_year: toYear(to) });
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
          <input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} maxLength={4} />
        </label>
        <label>
          To year
          <input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} maxLength={4} />
        </label>
        <button type="button" onClick={add}>
          Add place
        </button>
      </div>
    </fieldset>
  );
}
