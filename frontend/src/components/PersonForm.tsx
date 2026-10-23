import { useEffect, useState, type FormEvent } from "react";
import { api, messageOf } from "../api";
import { formatDate, parseDateInput } from "../dates";
import { useMe } from "../me";
import { navigate } from "../router";
import type { PersonInput } from "../types";
import { useAction } from "../useAction";
import { ErrorMessage } from "./ErrorMessage";
import { PlacesEditor, type PlaceDraft } from "./PlacesEditor";

const BLANK = { given: "", family: "", birth: "", birthPlace: "", death: "", occupation: "", bio: "" };

export function PersonForm({ id }: { id?: number }) {
  const { dateFormat, ready, can } = useMe();
  const allowed = id === undefined ? can("add") : can("edit");
  const [fields, setFields] = useState(BLANK);
  const [places, setPlaces] = useState<PlaceDraft[]>([]);
  const [removed, setRemoved] = useState<PlaceDraft[]>([]);
  const [savedId, setSavedId] = useState<number | null>(id ?? null);
  const [loaded, setLoaded] = useState(id === undefined);
  const { error, setError, busy, run } = useAction();

  useEffect(() => {
    if (id === undefined || !ready || !allowed) return;
    api.getPerson(id).then(
      (p) => {
        setFields({
          given: p.given_names, family: p.family_name,
          birth: p.birth_date ? formatDate(p.birth_date, dateFormat) : "", birthPlace: p.birth_place ?? "",
          death: p.death_date ? formatDate(p.death_date, dateFormat) : "", occupation: p.occupation ?? "", bio: p.bio,
        });
        setPlaces(p.places_lived.map((x) => ({ ...x, key: `saved-${x.id}` })));
        setLoaded(true);
      },
      (e) => setError(messageOf(e)),
    );
    // dateFormat is read once, when the person arrives; changing it later must not wipe typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ready, allowed]);

  const set = (name: keyof typeof BLANK) => (e: { target: { value: string } }) => setFields({ ...fields, [name]: e.target.value });

  const dateOrNull = (text: string, label: string): string | null => {
    if (!text.trim()) return null;
    try {
      return parseDateInput(text, dateFormat);
    } catch (e) {
      throw new Error(`Please check the ${label}. ${messageOf(e)}`);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const input: PersonInput = {
        given_names: fields.given.trim(),
        family_name: fields.family.trim(),
        birth_date: dateOrNull(fields.birth, "birth date"),
        birth_place: fields.birthPlace.trim() || null,
        death_date: dateOrNull(fields.death, "death date"),
        occupation: fields.occupation.trim() || null,
        bio: fields.bio,
      };
      const person = await api.savePerson(savedId, input);
      setSavedId(person.id);
      try {
        for (const gone of removed) {
          await api.removePlace(person.id, gone.id!);
          setRemoved((r) => r.filter((x) => x !== gone));
        }
        for (const p of places.filter((x) => x.id === undefined)) {
          const made = await api.addPlace(person.id, { place: p.place, from_year: p.from_year, to_year: p.to_year });
          setPlaces((all) => all.map((x) => (x.key === p.key ? { ...x, id: made.id } : x)));
        }
      } catch (err) {
        throw new Error(`The person was saved, but their places lived were not: ${messageOf(err)}`);
      }
      navigate(`#/person/${person.id}`);
    });
  };

  if (!allowed) {
    return (
      <div>
        <h1>{id === undefined ? "Add person" : "Edit person"}</h1>
        <p className="error">You do not have permission to do that.</p>
        <p>
          <a href="#/people">Back to people</a>
        </p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div>
        <ErrorMessage message={error} />
        {!error && <p className="muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div>
      <h1>{id === undefined ? "Add person" : "Edit person"}</h1>
      <form onSubmit={submit} className="card">
        <label>
          Given names
          <input value={fields.given} onChange={set("given")} maxLength={200} required />
        </label>
        <label>
          Family name
          <input value={fields.family} onChange={set("family")} maxLength={200} />
        </label>
        <label>
          Birth date ({dateFormat}, or just the year)
          <input value={fields.birth} onChange={set("birth")} inputMode="numeric" />
        </label>
        <label>
          Birth place
          <input value={fields.birthPlace} onChange={set("birthPlace")} maxLength={200} />
        </label>
        <label>
          Death date ({dateFormat}, or just the year)
          <input value={fields.death} onChange={set("death")} inputMode="numeric" />
        </label>
        <label>
          Occupation
          <input value={fields.occupation} onChange={set("occupation")} maxLength={200} />
        </label>
        {can("edit") ? (
          <PlacesEditor
            places={places}
            onAdd={(p) => setPlaces([...places, p])}
            onRemove={(p) => {
              setPlaces(places.filter((x) => x !== p));
              if (p.id !== undefined) setRemoved([...removed, p]);
            }}
          />
        ) : (
          <p className="muted">Places lived can be added after saving, by someone who is allowed to edit.</p>
        )}
        <label>
          Biography
          <textarea value={fields.bio} onChange={set("bio")} rows={6} maxLength={20000} />
        </label>
        <ErrorMessage message={error} />
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy}>
            Save person
          </button>
          <a className="button" href={savedId === null ? "#/people" : `#/person/${savedId}`}>
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
