import { useRef, type ReactNode } from "react";
import { useMe } from "../me";
import type { Route } from "../router";
import { UserMenu } from "./UserMenu";

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { can } = useMe();
  const main = useRef<HTMLElement>(null);
  const here = (name: Route["name"]) => (route.name === name ? "page" : undefined);
  return (
    <>
      <button type="button" className="skip" onClick={() => main.current?.focus()}>
        Skip to content
      </button>
      <header className="topbar">
        <a className="brand" href="#/people">
          Family Tree
        </a>
        <nav aria-label="Main">
          <a href="#/people" aria-current={here("people")}>
            People
          </a>
          <a href="#/tree" aria-current={here("tree")}>
            Family tree
          </a>
          {can("admin") && (
            <a href="#/admin" aria-current={here("admin")}>
              Admin
            </a>
          )}
        </nav>
        <UserMenu />
      </header>
      <main id="main" ref={main} tabIndex={-1} className="content">
        {children}
      </main>
    </>
  );
}
