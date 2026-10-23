import { useEffect, useState } from "react";
import { api, messageOf } from "../api";
import { useMe } from "../me";
import type { DependencyCheck } from "../types";
import { useAction } from "../useAction";
import { when } from "./adminFormat";
import { ErrorMessage } from "./ErrorMessage";

export function UpdatesSection() {
  const { dateFormat } = useMe();
  const [check, setCheck] = useState<DependencyCheck | null>(null);
  const [loadError, setLoadError] = useState("");
  const { error, busy, run } = useAction();

  useEffect(() => {
    api.getDependencyCheck().then(setCheck, (e) => setLoadError(messageOf(e)));
  }, []);

  return (
    <section aria-labelledby="updates-h">
      <h2 id="updates-h">Updates and security</h2>
      <ErrorMessage message={loadError} />
      {check && (
        <div>
          {check.check_failed && <p className="error">Could not check for updates</p>}
          <p>{check.message}</p>
          {check.checked_at && <p className="hint">Last checked: {when(check.checked_at, dateFormat)}</p>}
          {check.vulnerabilities.length > 0 && (
            <ul className="warnings">
              {check.vulnerabilities.map((v) => (
                <li key={`${v.package}-${v.id}`}>
                  <strong>{v.package}</strong> {v.version} ({v.id}){v.description && `: ${v.description}`}
                  {v.fix_versions.length > 0 && ` Fixed in ${v.fix_versions.join(", ")}.`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ErrorMessage message={error} />
      <button type="button" disabled={busy} onClick={() => run(async () => setCheck(await api.runDependencyCheck()))}>
        Check now
      </button>
    </section>
  );
}
