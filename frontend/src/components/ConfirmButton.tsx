import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  label: string;
  ariaLabel?: string;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  children?: ReactNode;
  className?: string;
}

/** A button that never acts straight away: it asks first. */
export function ConfirmButton({ label, ariaLabel, title, confirmLabel, onConfirm, children, className }: Props) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-label={ariaLabel} onClick={() => setAsking(true)}>
        {label}
      </button>
      {asking && (
        <ConfirmDialog
          title={title}
          confirmLabel={confirmLabel}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {children}
        </ConfirmDialog>
      )}
    </>
  );
}
