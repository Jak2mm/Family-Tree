import { useCallback, useEffect, useRef, useState } from "react";
import { api, messageOf, thumbUrl } from "../api";
import { formatDate } from "../dates";
import { useMe } from "../me";
import type { Profile } from "../types";
import { AlbumsSection } from "./AlbumsSection";
import { DeletePerson } from "./DeletePerson";
import { ErrorMessage } from "./ErrorMessage";
import { RelationList } from "./RelationList";

function yearsText(from: number | null | undefined, to: number | null | undefined): string {
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  return to ? `until ${to}` : "";
}

export function ProfilePage({ id }: { id: number }) {
  const { can, dateFormat } = useMe();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const loaded = await api.getPerson(id);
      if (mine !== latest.current) return; // a newer request (or another person) has taken over
      setProfile(loaded);
      setError("");
    } catch (e) {
      if (mine === latest.current) setError(messageOf(e));
    }
  }, [id]);

  useEffect(() => {
    setProfile(null);
    setError("");
    load();
    return () => {
      latest.current++;
    };
  }, [load]);

  if (!profile) {
    return (
      <div>
        <ErrorMessage message={error} />
        {!error && <p className="muted">Loading…</p>}
        <p>
          <a href="#/people">Back to people</a>
        </p>
      </div>
    );
  }

  const show = (d: string | null) => (d ? formatDate(d, dateFormat) : "");
  const facts: [string, string][] = [
    ["Born", show(profile.birth_date)],
    ["Birth place", profile.birth_place ?? ""],
    ["Died", show(profile.death_date)],
    ["Occupation", profile.occupation ?? ""],
  ];

  return (
    <div className="profile">
      <p>
        <a href="#/people">Back to people</a>
      </p>
      <ErrorMessage message={error} />
      <header className="profile-head">
        {profile.profile_photo_id ? (
          <img className="portrait" src={thumbUrl(profile.profile_photo_id)} alt={`Photo of ${profile.name}`} />
        ) : (
          <div className="portrait placeholder" role="img" aria-label="No profile photo yet" />
        )}
        <div>
          <h1>{profile.name}</h1>
          {can("edit") && (
            <a className="button" href={`#/person/${id}/edit`}>
              Edit
            </a>
          )}
        </div>
      </header>

      <section>
        <h2>Details</h2>
        <dl className="facts">
          {facts
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
        {facts.every(([, v]) => !v) && <p className="muted">No details recorded yet.</p>}
      </section>

      <RelationList
        title="Partners"
        people={profile.partnerships}
        onChanged={load}
        detail={(r) => [r.kind, yearsText(r.start_year, r.end_year)].filter(Boolean).join(" ")}
      />
      <RelationList title="Parents" people={profile.parents} onChanged={load} />
      <RelationList title="Children" people={profile.children} onChanged={load} />
      <RelationList title="Siblings" people={profile.siblings} onChanged={load} />

      {profile.places_lived.length > 0 && (
        <section>
          <h2>Places lived</h2>
          <ul>
            {profile.places_lived.map((p) => (
              <li key={p.id}>
                {p.place}
                {yearsText(p.from_year, p.to_year) && <span className="muted"> ({yearsText(p.from_year, p.to_year)})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.bio && (
        <section>
          <h2>Biography</h2>
          <p className="bio">{profile.bio}</p>
        </section>
      )}

      <AlbumsSection key={`albums-${id}`} personId={id} albums={profile.albums} profilePhotoId={profile.profile_photo_id} onChanged={load} />

      {can("delete") && <DeletePerson key={`delete-${id}`} id={id} name={profile.name} />}
    </div>
  );
}
