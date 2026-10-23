import { useState } from "react";
import { ApiError, api } from "../api";
import { navigate } from "../router";
import type { LinkInfo } from "../types";
import { useAction } from "../useAction";
import { ConfirmDialog } from "./ConfirmDialog";
import { ErrorMessage } from "./ErrorMessage";

const WORDS = { parent: "parent", child: "child", partner: "partner" };

export function DeletePerson({ id, name }: { id: number; name: string }) {
  const [step, setStep] = useState<"idle" | "confirm" | "links">("idle");
  const [links, setLinks] = useState<LinkInfo[]>([]);
  const { error, busy, run } = useAction();

  const remove = async (mode: "refuse" | "remove") => {
    const ok = await run(async () => {
      try {
        await api.deletePerson(id, mode);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.links.length > 0) {
          setLinks(e.links);
          setStep("links");
          return;
        }
        throw e;
      }
      navigate("#/people");
    });
    if (!ok) setStep("idle");
  };

  return (
    <section className="danger-zone">
      <ErrorMessage message={error} />
      <button type="button" className="danger" disabled={busy} onClick={() => setStep("confirm")}>
        Delete person
      </button>
      {step === "confirm" && (
        <ConfirmDialog title={`Delete ${name}?`} confirmLabel="Delete" busy={busy}
          onCancel={() => setStep("idle")} onConfirm={() => remove("refuse")}>
          <p>Their details, albums and photos will be removed for good. This cannot be undone.</p>
        </ConfirmDialog>
      )}
      {step === "links" && (
        <ConfirmDialog
          title={`${name} still has relationships`}
          confirmLabel="Delete anyway (remove these links)"
          busy={busy}
          onCancel={() => setStep("idle")}
          onConfirm={() => remove("remove")}
        >
          <p>These links will be removed as well:</p>
          <ul>
            {links.map((l) => (
              <li key={l.link_id}>
                {l.name} ({WORDS[l.kind]})
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </section>
  );
}
