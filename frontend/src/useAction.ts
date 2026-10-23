import { useCallback, useRef, useState } from "react";
import { messageOf } from "./api";

/** Runs a server action, remembers its plain-language error, and calls `after` (for example a reload) when it worked. */
export function useAction(after?: () => void | Promise<void>) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (inFlight.current) return false; // a second press while the first request is running does nothing
      inFlight.current = true;
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
        inFlight.current = false;
        setBusy(false);
      }
    },
    [after],
  );
  return { error, setError, busy, run };
}
