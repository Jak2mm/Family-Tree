import { useEffect, useState } from "react";

export type Route =
  | { name: "people" }
  | { name: "person"; id: number }
  | { name: "personEdit"; id: number }
  | { name: "personNew" }
  | { name: "tree" }
  | { name: "settings" }
  | { name: "notFound" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (path === "" || path === "people") return { name: "people" };
  if (path === "tree") return { name: "tree" };
  if (path === "settings") return { name: "settings" };
  if (path === "person/new") return { name: "personNew" };
  const m = /^person\/(\d+)(\/edit)?$/.exec(path);
  if (m) return m[2] ? { name: "personEdit", id: Number(m[1]) } : { name: "person", id: Number(m[1]) };
  return { name: "notFound" };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseHash(hash);
}
