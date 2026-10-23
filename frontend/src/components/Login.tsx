import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAction } from "../useAction";
import type { Me } from "../types";
import { ErrorMessage } from "./ErrorMessage";

export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { error, busy, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => onSignedIn(await api.login(username, password)));
  };

  return (
    <main className="narrow card">
      <h1>Family Tree</h1>
      <p className="muted">Sign in to see your family.</p>
      <form onSubmit={submit}>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <ErrorMessage message={error} />
        <button type="submit" className="primary" disabled={busy}>
          Sign in
        </button>
      </form>
    </main>
  );
}
