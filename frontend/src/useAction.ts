import { useCallback, useState } from "react";
import { messageOf } from "./api";

/** Runs a server action, remembers its plain-language error, and calls `after` (for example a reload) when it worked. */
export function useAction(after?: () => void | Promise<void>) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setError("");
      setBusy(true);
      try {
        await action();
        await after?.();
        return true;
      } catch (e) {
        setError(messageOf(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [after],
  );
  return { error, setError, busy, run };
}
