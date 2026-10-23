import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { PartnershipChanges, Relative } from "../types";
import { useAction } from "../useAction";
import { ErrorMessage } from "./ErrorMessage";

const KINDS: PartnershipChanges["kind"][] = ["married", "de facto", "partner", "other"];
const YEAR = /^\d{1,4}$/;
const yearOf = (text: string) => (text === "" ? null : Number(text));
const valid = (text: string) => text === "" || (YEAR.test(text) && Number(text) >= 1);

/** Change the kind of a partnership and the years it started and ended. */
export function PartnershipForm({ partner, onCancel, onSaved }: { partner: Relative; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<PartnershipChanges["kind"]>((partner.kind as PartnershipChanges["kind"]) ?? "partner");
  const [start, setStart] = useState(partner.start_year?.toString() ?? "");
  const [end, setEnd] = useState(partner.end_year?.toString() ?? "");
  const { error, busy, run } = useAction(onSaved);

  const yearsOk = valid(start) && valid(end);
  const orderOk = !yearsOk || start === "" || end === "" || Number(end) >= Number(start);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (yearsOk && orderOk) run(() => api.editPartnership(partner.link_id!, { kind, start_year: yearOf(start), end_year: yearOf(end) }));
  };

  return (
    <form className="inline-form" aria-label={`Partnership with ${partner.name}`} onSubmit={save}>
      <label>
        Kind of partnership
        <select value={kind} onChange={(e) => setKind(e.target.value as PartnershipChanges["kind"])}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label>
        Year it started
        <input inputMode="numeric" maxLength={4} value={start} onChange={(e) => setStart(e.target.value.trim())} aria-invalid={!valid(start)} />
      </label>
      <label>
        Year it ended
        <input inputMode="numeric" maxLength={4} value={end} onChange={(e) => setEnd(e.target.value.trim())} aria-invalid={!valid(end)} />
      </label>
      {!yearsOk && <p className="hint">Please enter years of 1 to 4 digits, or leave them empty.</p>}
      {!orderOk && <p className="hint">The year it ended cannot be earlier than the year it started.</p>}
      <ErrorMessage message={error} />
      <div className="button-row">
        <button type="submit" className="primary" disabled={busy || !yearsOk || !orderOk}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
