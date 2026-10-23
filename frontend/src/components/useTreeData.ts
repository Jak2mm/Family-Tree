import { useCallback, useEffect, useRef, useState } from "react";
import { api, messageOf } from "../api";
import type { Preferences, TreeData } from "../types";

/** Loads the whole tree, and loads it again on demand (after a link is made or undone). */
export function useTreeData() {
  const [data, setData] = useState<TreeData | null>(null);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    try {
      const next = await api.getTree();
      if (live.current) (setData(next), setError(""));
    } catch (e) {
      if (live.current) setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

export type TreePrefs = Pick<Preferences, "layout" | "card_fields">;
const DEFAULTS: TreePrefs = { layout: 1, card_fields: ["name", "photo", "dates"] };

/** The person's saved layout and card fields. A change shows at once and is saved; if saving fails it is undone and the error is kept. */
export function useTreePrefs() {
  const [prefs, setPrefs] = useState<TreePrefs>(DEFAULTS);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    api.getPreferences().then(
      (p) => live.current && setPrefs({ layout: p.layout, card_fields: p.card_fields }),
      (e) => live.current && setError(messageOf(e)),
    );
    return () => {
      live.current = false;
    };
  }, []);
  const save = useCallback(async (changes: Partial<TreePrefs>) => {
    let before = DEFAULTS;
    setPrefs((current) => ((before = current), { ...current, ...changes }));
    setError("");
    try {
      await api.savePreferences(changes);
    } catch (e) {
      if (live.current) (setPrefs(before), setError(messageOf(e)));
    }
  }, []);
  return { prefs, error, save };
}
