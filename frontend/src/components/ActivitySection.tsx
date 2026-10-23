import { useEffect, useState } from "react";
import { api, messageOf } from "../api";
import { useMe } from "../me";
import type { AuditRow } from "../types";
import { describeAudit, when } from "./adminFormat";
import { ErrorMessage } from "./ErrorMessage";

export function ActivitySection() {
  const { dateFormat } = useMe();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listAudit().then(setRows, (e) => setError(messageOf(e)));
  }, []);

  return (
    <section aria-labelledby="activity-h">
      <h2 id="activity-h">Recent activity</h2>
      <ErrorMessage message={error} />
      {rows && rows.length === 0 && <p className="muted">Nothing has happened yet.</p>}
      <ul className="activity">
        {rows?.map((r) => {
          const { who, what } = describeAudit(r);
          return (
            <li key={r.id}>
              <span>{who} {what}</span> <span className="muted">{when(r.created_at, dateFormat)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
