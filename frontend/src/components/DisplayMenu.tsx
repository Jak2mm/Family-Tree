import { useState } from "react";

export const CARD_FIELDS = [
  { key: "name", label: "Name" },
  { key: "photo", label: "Photo" },
  { key: "dates", label: "Dates" },
  { key: "age", label: "Age" },
  { key: "occupation", label: "Occupation" },
] as const;

/** Which details appear on each card. */
export function DisplayMenu({ fields, onChange }: { fields: string[]; onChange: (fields: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (key: string) => {
    const next = fields.includes(key) ? fields.filter((f) => f !== key) : [...fields, key];
    onChange(CARD_FIELDS.map((f) => f.key).filter((k) => next.includes(k))); // keep a steady order
  };
  return (
    <div className="usermenu">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Show on cards
      </button>
      {open && (
        <fieldset className="usermenu-panel">
          <legend>Show on each card</legend>
          {CARD_FIELDS.map((f) => (
            <label key={f.key} className="check">
              <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} />
              {f.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
