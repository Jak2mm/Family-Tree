import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, messageOf } from "../api";
import { useMe } from "../me";
import type { AppUser } from "../types";
import { useAction } from "../useAction";
import { ConfirmButton } from "./ConfirmButton";
import { ErrorMessage } from "./ErrorMessage";

const PERMS = [
  ["read", "Read"],
  ["add", "Add"],
  ["edit", "Edit"],
  ["delete", "Delete"],
] as const;
type Perm = (typeof PERMS)[number][0];

function NewUserForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState<Record<Perm, boolean>>({ read: true, add: false, edit: false, delete: false });
  const { error, busy, run } = useAction(onCreated);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      username: username.trim(), password,
      can_read: perms.read, can_add: perms.add, can_edit: perms.edit, can_delete: perms.delete,
    };
    setPassword(""); // the password is never kept on screen once it has been sent
    if (await run(() => api.createUser(body))) setUsername("");
  };

  return (
    <form aria-label="New user" onSubmit={submit}>
      <h3>Add a user</h3>
      <div className="inline-form">
        <label>
          Username
          <input value={username} maxLength={50} autoComplete="off" onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
      </div>
      <p className="hint">The password needs at least 8 characters.</p>
      <fieldset>
        <legend>What this person may do</legend>
        <div className="button-row">
          {PERMS.map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" checked={perms[key]} onChange={(e) => setPerms({ ...perms, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorMessage message={error} />
      <button type="submit" className="primary" disabled={busy}>
        Create user
      </button>
    </form>
  );
}

function UserRow({ user, isSelf, reload }: { user: AppUser; isSelf: boolean; reload: () => Promise<void> }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [changed, setChanged] = useState(false);
  const { error, busy, run } = useAction(reload); // each row has its own, so one row never blocks or hides another
  const change = (changes: Record<string, unknown>) => {
    setChanged(false);
    return run(() => api.updateUser(user.id, changes));
  };
  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    const typed = password;
    setPassword(""); // never kept on screen once sent
    if (await change({ password: typed })) {
      setResetting(false);
      setChanged(true);
    }
  };
  return (
    <li className={user.active ? "user-row" : "user-row off"}>
      <div className="user-head">
        <strong>{user.username}</strong>
        {user.is_admin && <span className="badge">Administrator</span>}
        {!user.active && <span className="badge">Disabled</span>}
        {isSelf && <span className="muted">(you)</span>}
      </div>
      <div className="button-row">
        {user.is_admin && (
          <label className="check">
            <input type="checkbox" checked disabled aria-label={`Administrator (${user.username})`} />
            Administrator
          </label>
        )}
        {PERMS.map(([key, label]) => (
          <label key={key} className="check" title={user.is_admin ? "An administrator always has every permission." : undefined}>
            <input
              type="checkbox"
              aria-label={`${label} (${user.username})`}
              checked={user.is_admin || user[`can_${key}`]}
              disabled={busy || user.is_admin}
              onChange={(e) => !user.is_admin && change({ [`can_${key}`]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="button-row">
        <button type="button" aria-label={`Reset password for ${user.username}`} onClick={() => setResetting(!resetting)}>
          Reset password
        </button>
        {!isSelf &&
          (user.active ? (
            <ConfirmButton
              label="Disable"
              ariaLabel={`Disable ${user.username}`}
              title={`Disable ${user.username}?`}
              confirmLabel="Disable account"
              className="danger"
              disabled={busy}
              onConfirm={() => change({ active: false })}
            >
              {`${user.username} will be signed out and will not be able to sign in until you enable the account again.`}
            </ConfirmButton>
          ) : (
            <button type="button" aria-label={`Enable ${user.username}`} disabled={busy} onClick={() => change({ active: true })}>
              Enable
            </button>
          ))}
      </div>
      {resetting && (
        <form className="inline-form" onSubmit={savePassword}>
          <label>
            {`New password for ${user.username}`}
            <input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Save new password
          </button>
          {isSelf && <p className="hint">You will need to sign in again.</p>}
        </form>
      )}
      <ErrorMessage message={error} />
      {changed && <p role="status">Password changed.</p>}
    </li>
  );
}

export function UsersSection() {
  const { user: me } = useMe();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await api.listUsers());
      setLoadError("");
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);


  return (
    <section aria-labelledby="users-h">
      <h2 id="users-h">Users</h2>
      <ErrorMessage message={loadError} />
      {users === null && !loadError && <p className="muted">Loading…</p>}
      <ul className="users">
        {users?.map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === me.id} reload={load} />
        ))}
      </ul>
      <NewUserForm onCreated={load} />
    </section>
  );
}
