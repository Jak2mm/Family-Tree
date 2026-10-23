import { useEffect, useState } from "react";
import { api, messageOf, thumbUrl } from "../api";
import { formatDate } from "../dates";
import { useMe } from "../me";
import type { PersonSummary } from "../types";
import { ErrorMessage } from "./ErrorMessage";

export function PeopleList() {
  const { can, dateFormat } = useMe();
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listPeople().then(setPeople, (e) => setError(messageOf(e)));
  }, []);

  const needle = search.trim().toLowerCase();
  const shown = people?.filter((p) => p.name.toLowerCase().includes(needle)) ?? [];

  const years = (p: PersonSummary) => {
    const born = p.birth_date ? formatDate(p.birth_date, dateFormat) : "";
    const died = p.death_date ? formatDate(p.death_date, dateFormat) : "";
    if (born && died) return `${born} to ${died}`;
    if (born) return `Born ${born}`;
    return died ? `Died ${died}` : "";
  };

  return (
    <main>
      <div className="page-head">
        <h1>People</h1>
        {can("add") && (
          <a className="button primary" href="#/person/new">
            Add person
          </a>
        )}
      </div>
      <label className="search">
        Search by name
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <ErrorMessage message={error} />
      {people === null && !error && <p className="muted">Loading…</p>}
      {people && people.length === 0 && <p className="muted">No one has been added yet.</p>}
      {people && people.length > 0 && shown.length === 0 && <p className="muted">No one matches that search.</p>}
      <ul className="people">
        {shown.map((p) => (
          <li key={p.id}>
            <a href={`#/person/${p.id}`}>
              {p.profile_photo_id ? <img src={thumbUrl(p.profile_photo_id)} alt="" className="avatar" /> : <span className="avatar placeholder" aria-hidden="true" />}
              <span>
                <strong>{p.name}</strong>
                <span className="muted block">{years(p)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
