import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, messageOf } from "../api";
import { useMe } from "../me";
import type { BackupResult, BackupSettings, BackupStatus } from "../types";
import { useAction } from "../useAction";
import { fileSize, when } from "./adminFormat";
import { ErrorMessage } from "./ErrorMessage";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function StatusPanel({ status, error }: { status: BackupStatus | null; error: string }) {
  const { dateFormat } = useMe();
  if (!status) return <ErrorMessage message={error} />;
  return (
    <div data-testid="backup-status" className="panel">
      <h3>Last backup</h3>
      {status.last_run ? (
        <p>
          {when(status.last_run, dateFormat)}
          {status.ok ? `, ${fileSize(status.size)}` : ""}. {status.ok ? "Succeeded" : "Failed"}.
        </p>
      ) : (
        <p className="muted">No backup has run yet.</p>
      )}
      {!status.nas_available && (
        <p className="error" role="status">
          NAS offline. The backups folder cannot be reached, so backups will fail until it is back.
        </p>
      )}
      {status.error && <p className="error">Last error: {status.error}</p>}
      {status.warning && status.nas_available && !(status.error && status.warning.includes(status.error)) && <p className="muted">{status.warning}</p>}
      {status.next_run && <p className="hint">Next backup: {when(status.next_run, dateFormat)}</p>}
    </div>
  );
}

function BackupNow({ onDone }: { onDone: () => Promise<void> }) {
  const [result, setResult] = useState<BackupResult | null>(null);
  const { error, busy, run } = useAction(onDone);
  return (
    <div>
      <button type="button" disabled={busy} onClick={() => run(async () => {
          setResult(null);
          setResult(await api.runBackup());
        })}>
        Back up now
      </button>
      <ErrorMessage message={error} />
      {result &&
        (result.ok ? (
          <p role="status">Backup finished: {fileSize(result.size)} saved to {result.path}.</p>
        ) : (
          <p role="alert" className="error">Backup failed: {result.error ?? "something went wrong."}</p>
        ))}
    </div>
  );
}

function SettingsForm({ initial, onSaved }: { initial: BackupSettings; onSaved: () => Promise<void> }) {
  const [times, setTimes] = useState(initial.times);
  const [days, setDays] = useState<number[]>(initial.days ?? []);
  const [retention, setRetention] = useState(String(initial.retention));
  const [hours, setHours] = useState(String(initial.session_timeout_hours));
  const [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction(onSaved);

  const edit = <T,>(set: (v: T) => void) => (v: T) => (setSaved(false), set(v));
  const num = (text: string) => (text.trim() === "" ? null : Number(text));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { times, days: days.length ? [...days].sort() : null, retention: num(retention), session_timeout_hours: num(hours) };
    setSaved(
      await run(async () => {
        const stored = await api.saveBackupSettings(body);
        // show what the server kept: it sorts the times and drops duplicates
        setTimes(stored.times);
        setDays(stored.days ?? []);
        setRetention(String(stored.retention));
        setHours(String(stored.session_timeout_hours));
      }),
    );
  };

  return (
    <form aria-label="Backup settings" onSubmit={submit}>
      <fieldset>
        <legend>When to back up</legend>
        {times.map((t, i) => (
          <div key={i} className="button-row">
            <label>
              {`Backup time ${i + 1}${initial.timezone ? ` (${initial.timezone} time)` : ""}`}
              <input type="time" value={t} required onChange={(e) => edit(setTimes)(times.map((x, j) => (j === i ? e.target.value : x)))} />
            </label>
            {times.length > 1 && (
              <button type="button" aria-label={`Remove backup time ${i + 1}`} onClick={() => edit(setTimes)(times.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div>
          <button type="button" onClick={() => edit(setTimes)([...times, "12:00"])}>
            Add another time
          </button>
        </div>
        <fieldset>
          <legend>Only on these days (leave all blank for every day)</legend>
          <div className="button-row">
            {DAYS.map((name, i) => (
              <label key={name} className="check">
                <input type="checkbox" checked={days.includes(i)} onChange={(e) => edit(setDays)(e.target.checked ? [...days, i] : days.filter((d) => d !== i))} />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      <div className="inline-form">
        <label>
          Backups to keep
          <input type="number" min={1} max={365} value={retention} onChange={(e) => edit(setRetention)(e.target.value)} />
        </label>
        <label>
          Sign-in timeout (hours)
          <input type="number" min={1} max={168} value={hours} onChange={(e) => edit(setHours)(e.target.value)} />
        </label>
      </div>
      <p>
        Backups folder in use: <code>{initial.backup_folder}</code>
      </p>
      <ErrorMessage message={error} />
      <div className="button-row">
        <button type="submit" className="primary" disabled={busy}>
          Save backup settings
        </button>
        {saved && !error && <span role="status">Saved.</span>}
      </div>
    </form>
  );
}

export function BackupSection() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadError, setLoadError] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.backupStatus());
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    loadStatus();
    api.getBackupSettings().then(setSettings, (e) => setLoadError(messageOf(e)));
  }, [loadStatus]);

  return (
    <section aria-labelledby="backups-h">
      <h2 id="backups-h">Backups</h2>
      <ErrorMessage message={loadError} />
      <StatusPanel status={status} error="" />
      <BackupNow onDone={loadStatus} />
      {settings && <SettingsForm initial={settings} onSaved={loadStatus} />}
    </section>
  );
}
