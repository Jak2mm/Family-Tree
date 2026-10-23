import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAction } from "../useAction";
import type { Me } from "../types";
import { ErrorMessage } from "./ErrorMessage";

export function Setup({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { error, setError, busy, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match. Please type them again.");
      return;
    }
    run(async () => {
      await api.setup(username, password);
      onSignedIn(await api.login(username, password));
    });
  };

  return (
    <main className="narrow card">
      <h1>Welcome to Family Tree</h1>
      <h2>Create the first account</h2>
      <p className="muted">This account is the administrator. It can add family members and choose what each of them may do.</p>
      <form onSubmit={submit}>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" maxLength={50} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="password-hint" />
        </label>
        <p id="password-hint" className="hint">
          Use at least 8 characters.
        </p>
        <label>
          Confirm password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        <ErrorMessage message={error} />
        <button type="submit" className="primary" disabled={busy}>
          Create account
        </button>
      </form>
    </main>
  );
}
