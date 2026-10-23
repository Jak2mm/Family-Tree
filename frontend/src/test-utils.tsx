import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { MeProvider } from "./me";
import type { Me } from "./types";

export interface Req {
  method: string;
  path: string;
  body: unknown;
}
export type Handler = { status?: number; body?: unknown } | ((req: Req) => { status?: number; body?: unknown });

/** Replace fetch with a table of "METHOD /path?query" -> response. An unlisted request fails the test loudly. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Req[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = decodeURIComponent(url.pathname) + url.search;
    let body: unknown = init?.body ?? undefined;
    if (typeof body === "string") body = JSON.parse(body);
    const req = { method, path, body };
    calls.push(req);
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`Unexpected request: ${method} ${path}`);
    const out = typeof handler === "function" ? handler(req) : handler;
    const status = out.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(out.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key).length };
}

export function meWith(perms: string[]): Me {
  return {
    id: 1,
    username: "sam",
    is_admin: perms.includes("admin"),
    can_read: perms.includes("read"),
    can_add: perms.includes("add"),
    can_edit: perms.includes("edit"),
    can_delete: perms.includes("delete"),
    csrf_token: "tok",
  };
}

export const PREFS = { layout: 1, card_fields: ["name", "photo", "dates"], date_format: "DD-MM-YYYY" };

export function renderAs(perms: string[], ui: ReactElement) {
  return render(<MeProvider user={meWith(perms)} onSignOut={() => {}}>{ui}</MeProvider>);
}
