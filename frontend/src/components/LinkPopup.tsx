import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useMe } from "../me";
import { useAction } from "../useAction";
import type { NewLink } from "../types";
import { ErrorMessage } from "./ErrorMessage";

type Relation = NewLink["relation"];
type Kind = NonNullable<NewLink["partnership_kind"]>;
type Stage = { name: "choose" } | { name: "warning"; message: string } | { name: "parent" } | { name: "done"; ids: string[] } | { name: "undone" };
export interface Named {
  id: number;
  name: string;
}

const WORDS: [Relation, string][] = [
  ["parent", "parent"],
  ["child", "child"],
  ["spouse", "spouse/partner"],
  ["sibling", "sibling"],
];
const KINDS: Kind[] = ["married", "de facto", "partner", "other"];
const YEAR = /^\d{1,4}$/;

/** The one option the typed text means: an exact match, or text that only one option contains. */
function match(typed: string, options: { relation: Relation; text: string }[]) {
  const t = typed.trim().toLowerCase();
  if (!t) return undefined;
  const exact = options.find((o) => o.text.toLowerCase() === t);
  if (exact) return exact;
  const some = options.filter((o) => o.text.toLowerCase().includes(t));
  return some.length === 1 ? some[0] : undefined;
}

/** Asks how two people are related, and saves only when the person confirms. */
export function LinkPopup({ a, b, people, onClose, onChanged }: { a: Named; b: Named; people: Named[]; onClose: () => void; onChanged: () => void }) {
  const { can } = useMe();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const listId = useId();
  const [typed, setTyped] = useState("");
  const [kind, setKind] = useState<Kind>("partner");
  const [start, setStart] = useState("");
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const { error, busy, run } = useAction();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const options = WORDS.map(([relation, word]) => ({ relation, text: `${a.name} is the ${word} of ${b.name}` }));
  const chosen = match(typed, options)?.relation;
  const yearOk = start === "" || (YEAR.test(start) && Number(start) >= 1);
  const ready = chosen !== undefined && (chosen !== "spouse" || yearOk);

  const send = (force: boolean) =>
    run(async () => {
      const body: NewLink = { a: a.id, b: b.id, relation: chosen! };
      if (chosen === "spouse") {
        body.partnership_kind = kind;
        if (start) body.start_year = Number(start);
      }
      if (parentId !== null) body.parent_id = parentId;
      try {
        const { ids } = await api.createLink(body, force);
        setStage({ name: "done", ids });
        onChanged();
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409) throw e;
        if (e.data.warning) setStage({ name: "warning", message: e.message });
        else if (e.data.needs_parent) setStage({ name: "parent" });
        else throw e;
      }
    });

  const undo = (ids: string[]) =>
    run(async () => {
      let left = ids;
      try {
        for (const id of ids) {
          await api.undoLink(id);
          left = left.filter((x) => x !== id);
        }
        setStage({ name: "undone" });
      } finally {
        if (left.length > 0) setStage({ name: "done", ids: left }); // a failure keeps Undo for what is still linked
        onChanged();
      }
    });

  const candidates = people.filter((p) => p.id !== a.id && p.id !== b.id && p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const cancel = <button type="button" onClick={onClose}>Cancel</button>;

  return (
    <dialog
      ref={ref}
      className="confirm link-popup"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>How is {a.name} related to {b.name}?</h2>
      <div className="confirm-body">
        {stage.name === "choose" && (
          <>
            <label>
              Relationship
              <input list={listId} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Start typing, or pick from the list" autoComplete="off" autoFocus />
            </label>
            <datalist id={listId}>
              {options.map((o) => <option key={o.relation} value={o.text} />)}
            </datalist>
            {typed.trim() !== "" && !chosen && <p className="hint">That does not match one of the options. Please pick one from the list.</p>}
            {chosen === "spouse" && (
              <>
                <label>
                  Kind of partnership
                  <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <label>
                  Year it started (optional)
                  <input inputMode="numeric" maxLength={4} value={start} onChange={(e) => setStart(e.target.value.trim())} aria-invalid={!yearOk} />
                </label>
                {!yearOk && <p className="hint">Please enter a year of 1 to 4 digits, or leave it empty.</p>}
              </>
            )}
          </>
        )}
        {stage.name === "warning" && <p>{stage.message}</p>}
        {stage.name === "parent" && (
          <>
            <h3>Who is their parent?</h3>
            <label>
              Search people
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label>
              Parent
              <select size={5} value={parentId ?? ""} onChange={(e) => setParentId(Number(e.target.value))}>
                {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </>
        )}
        {stage.name === "done" && <p role="status">Linked</p>}
        {stage.name === "undone" && <p role="status">Link undone</p>}
        <ErrorMessage message={error} />
      </div>
      <div className="button-row">
        {stage.name === "choose" && (<>{cancel}<button type="button" className="primary" disabled={busy || !ready} onClick={() => send(false)}>Confirm</button></>)}
        {stage.name === "warning" && (<>{cancel}<button type="button" className="primary" disabled={busy} onClick={() => send(true)}>Link anyway</button></>)}
        {stage.name === "parent" && (<>{cancel}<button type="button" className="primary" disabled={busy || parentId === null} onClick={() => send(false)}>Confirm parent</button></>)}
        {stage.name === "done" && (<>{can("edit") && <button type="button" disabled={busy} onClick={() => undo(stage.ids)}>Undo</button>}<button type="button" className="primary" onClick={onClose}>Close</button></>)}
        {stage.name === "undone" && <button type="button" className="primary" onClick={onClose}>Close</button>}
      </div>
    </dialog>
  );
}
