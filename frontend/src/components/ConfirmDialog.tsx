import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** A small modal question built on the native <dialog> element. Render it only while the question is open. */
export function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Escape: let the parent decide, so the dialog is never left half-closed
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="confirm-body">{children}</div>
      <div className="button-row">
        <button type="button" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
