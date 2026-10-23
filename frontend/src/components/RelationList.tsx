import { api } from "../api";
import { useMe } from "../me";
import type { Relative } from "../types";
import { useAction } from "../useAction";
import { ConfirmButton } from "./ConfirmButton";
import { ErrorMessage } from "./ErrorMessage";

const KIND_WORDS: Record<string, string> = { biological: "", adoptive: "adoptive", step: "step", foster: "foster" };

interface Props {
  title: string;
  people: Relative[];
  onChanged: () => void | Promise<void>;
  detail?: (r: Relative) => string;
}

export function RelationList({ title, people, onChanged, detail }: Props) {
  const { can } = useMe();
  const { error, busy, run } = useAction(onChanged);
  if (people.length === 0) return null;

  return (
    <section>
      <h2>{title}</h2>
      <ErrorMessage message={error} />
      <ul className="relations">
        {people.map((r) => {
          const extra = [detail?.(r), r.kind && KIND_WORDS[r.kind]].filter(Boolean).join(", ");
          return (
            <li key={`${r.id}-${r.link_id ?? ""}`}>
              <a href={`#/person/${r.id}`}>{r.name}</a>
              {r.half && <span className="muted"> (half)</span>}
              {extra && <span className="muted"> ({extra})</span>}
              {r.link_id && can("edit") && (
                <ConfirmButton
                  label="Undo link"
                  disabled={busy}
                  ariaLabel={`Undo link with ${r.name}`}
                  title={`Undo the link with ${r.name}?`}
                  confirmLabel="Undo link"
                  onConfirm={() => run(() => api.undoLink(r.link_id!))}
                >
                  <p>This removes the relationship only. Neither person is deleted.</p>
                </ConfirmButton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
