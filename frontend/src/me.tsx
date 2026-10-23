import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { DateFormat } from "./dates";
import type { Me } from "./types";

export type Permission = "read" | "add" | "edit" | "delete" | "admin";

interface MeValue {
  user: Me;
  can: (permission: Permission) => boolean;
  dateFormat: DateFormat;
  /** False until the saved date format has been fetched, so forms do not show dates in the wrong style. */
  ready: boolean;
  /** Switches the display at once, then saves it. Resolves with an error message, or "" when saved. */
  setDateFormat: (format: DateFormat) => Promise<string>;
  signOut: () => void;
}

type PermissionFlags = Pick<Me, "is_admin" | "can_read" | "can_add" | "can_edit" | "can_delete">;

/** An administrator always holds every permission; everyone else has what their boxes say. */
export function hasPermission(user: PermissionFlags, p: Permission): boolean {
  if (user.is_admin) return true;
  return p === "read" ? user.can_read : p === "add" ? user.can_add : p === "edit" ? user.can_edit : p === "delete" ? user.can_delete : false;
}

const MeContext = createContext<MeValue | null>(null);

export function MeProvider({ user, onSignOut, children }: { user: Me; onSignOut: () => void; children: ReactNode }) {
  const [dateFormat, setFormat] = useState<DateFormat>("DD-MM-YYYY");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    api.getPreferences().then(
      (p) => live && (setFormat(p.date_format), setReady(true)),
      () => live && setReady(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const setDateFormat = useCallback(async (format: DateFormat) => {
    let previous: DateFormat = "DD-MM-YYYY";
    setFormat((current) => ((previous = current), format));
    try {
      await api.savePreferences({ date_format: format });
      return "";
    } catch (e) {
      setFormat(previous);
      return e instanceof Error ? e.message : "Could not save your choice.";
    }
  }, []);

  const value = useMemo<MeValue>(
    () => ({
      user,
      can: (p) => hasPermission(user, p),
      dateFormat,
      ready,
      setDateFormat,
      signOut: onSignOut,
    }),
    [user, dateFormat, ready, setDateFormat, onSignOut],
  );
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeValue {
  const value = useContext(MeContext);
  if (!value) throw new Error("useMe must be used inside MeProvider");
  return value;
}
