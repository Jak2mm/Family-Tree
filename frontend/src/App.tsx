import { useEffect, useState } from "react";
import { ApiError, api, messageOf } from "./api";
import { AdminSettings } from "./components/AdminSettings";
import { Login } from "./components/Login";
import { PeopleList } from "./components/PeopleList";
import { PersonForm } from "./components/PersonForm";
import { Placeholder } from "./components/Placeholder";
import { ProfilePage } from "./components/ProfilePage";
import { Setup } from "./components/Setup";
import { Shell } from "./components/Shell";
import { TreeView } from "./components/TreeView";
import { ErrorMessage } from "./components/ErrorMessage";
import { MeProvider } from "./me";
import { useRoute, type Route } from "./router";
import type { Me } from "./types";

type Session = { state: "loading" } | { state: "setup" } | { state: "login" } | { state: "in"; me: Me } | { state: "error"; message: string };

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "people":
      return <PeopleList />;
    case "person":
      return <ProfilePage key={route.id} id={route.id} />;
    case "personEdit":
      return <PersonForm key={`edit-${route.id}`} id={route.id} />;
    case "personNew":
      return <PersonForm key="new" />;
    case "tree":
      return <TreeView />;
    case "settings":
      return <AdminSettings />;
    default:
      return <Placeholder title="Page not found">That page does not exist. Use the links at the top to find your way.</Placeholder>;
  }
}

export function App() {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const route = useRoute();

  useEffect(() => {
    (async () => {
      try {
        setSession({ state: "in", me: await api.me() });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) return setSession({ state: "error", message: messageOf(e) });
        try {
          setSession({ state: (await api.setupStatus()).needed ? "setup" : "login" });
        } catch (e2) {
          setSession({ state: "error", message: messageOf(e2) });
        }
      }
    })();
  }, []);

  useEffect(() => {
    api.onUnauthorized(() => {
      api.setCsrfToken("");
      setSession((s) => (s.state === "in" ? { state: "login" } : s));
    });
    return () => api.onUnauthorized(() => {});
  }, []);

  const signedIn = (me: Me) => setSession({ state: "in", me });

  switch (session.state) {
    case "loading":
      return <p className="muted pad">Loading…</p>;
    case "error":
      return <main><ErrorMessage message={session.message} /></main>;
    case "setup":
      return <Setup onSignedIn={signedIn} />;
    case "login":
      return <Login onSignedIn={signedIn} />;
    case "in":
      return (
        <MeProvider user={session.me} onSignOut={() => setSession({ state: "login" })}>
          <Shell route={route}>
            {session.me.can_read ? <Page route={route} /> : <Placeholder title="No access yet">Your account cannot view the family yet. Please ask the administrator.</Placeholder>}
          </Shell>
        </MeProvider>
      );
  }
}
