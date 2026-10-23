import type { ReactNode } from "react";
import { useMe } from "../me";
import type { Route } from "../router";
import { UserMenu } from "./UserMenu";

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { can } = useMe();
  const here = (name: Route["name"]) => (route.name === name ? "page" : undefined);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
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
      <div id="main" className="content">
        {children}
      </div>
    </>
  );
}
