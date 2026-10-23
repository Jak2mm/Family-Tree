import { useState, type FormEvent } from "react";
import { api, photoUrl, thumbUrl } from "../api";
import { useMe } from "../me";
import type { Album, Photo } from "../types";
import { useAction } from "../useAction";
import { ConfirmButton } from "./ConfirmButton";
import { ErrorMessage } from "./ErrorMessage";

interface Props {
  personId: number;
  albums: Album[];
  profilePhotoId: number | null;
  onChanged: () => void | Promise<void>;
}

export function AlbumsSection({ personId, albums, profilePhotoId, onChanged }: Props) {
  const { can } = useMe();
  const { error, busy, run } = useAction(onChanged);
  const [title, setTitle] = useState("");

  const addAlbum = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.addAlbum(personId, title);
      setTitle("");
    });
  };

  return (
    <section>
      <h2>Albums</h2>
      <ErrorMessage message={error} />
      {albums.length === 0 && <p className="muted">No albums yet.</p>}
      {albums.map((album) => (
        <article key={album.id} className="album">
          <div className="album-head">
            <h3>{album.title}</h3>
            {can("delete") && (
              <ConfirmButton
                label="Delete album"
                disabled={busy}
                ariaLabel={`Delete album ${album.title}`}
                className="danger"
                title={`Delete the album "${album.title}"?`}
                confirmLabel="Delete album"
                onConfirm={() => run(() => api.deleteAlbum(album.id))}
              >
                <p>All {album.photos.length} photos in it will be removed for good.</p>
              </ConfirmButton>
            )}
          </div>
          {album.photos.length === 0 && <p className="muted">No photos in this album yet.</p>}
          <ul className="photos">
            {album.photos.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} personId={personId} isProfile={photo.id === profilePhotoId} run={run} busy={busy} />
            ))}
          </ul>
          {can("add") && <UploadForm albumId={album.id} title={album.title} onChanged={onChanged} />}
        </article>
      ))}
      {can("add") && (
        <form onSubmit={addAlbum} className="inline-form">
          <label>
            Album title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
          </label>
          <button type="submit" disabled={busy}>
            Add album
          </button>
        </form>
      )}
    </section>
  );
}

function PhotoCard({ photo, personId, isProfile, run, busy }: { photo: Photo; personId: number; isProfile: boolean; busy: boolean; run: (a: () => Promise<unknown>) => Promise<boolean> }) {
  const { can } = useMe();
  const label = [photo.caption, photo.year].filter(Boolean).join(", ");
  return (
    <li>
      <a href={photoUrl(photo.id)} target="_blank" rel="noreferrer">
        <img src={thumbUrl(photo.id)} alt={photo.caption || "Photo"} loading="lazy" />
      </a>
      {label && <p className="caption">{label}</p>}
      {isProfile && <p className="muted">Profile photo</p>}
      <div className="button-row">
        {can("edit") && !isProfile && (
          <button type="button" disabled={busy} aria-label={`Make profile photo${photo.caption ? `: ${photo.caption}` : ""}`} onClick={() => run(() => api.setProfilePhoto(personId, photo.id))}>
            Make profile photo
          </button>
        )}
        {can("delete") && (
          <ConfirmButton
            label="Delete photo"
            disabled={busy}
            ariaLabel={`Delete photo${photo.caption ? `: ${photo.caption}` : ""}`}
            className="danger"
            title="Delete this photo?"
            confirmLabel="Delete photo"
            onConfirm={() => run(() => api.deletePhoto(photo.id))}
          >
            <p>The photo will be removed for good.</p>
          </ConfirmButton>
        )}
      </div>
    </li>
  );
}

function UploadForm({ albumId, title, onChanged }: { albumId: number; title: string; onChanged: () => void | Promise<void> }) {
  const { error, busy, run } = useAction(onChanged);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [year, setYear] = useState("");
  const [inputKey, setInputKey] = useState(0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    run(async () => {
      await api.uploadPhoto(albumId, file, caption, year);
      setFile(null);
      setCaption("");
      setYear("");
      setInputKey((k) => k + 1);
    });
  };

  return (
    <form onSubmit={submit} className="upload">
      <label>
        Choose a photo for {title}
        <input key={inputKey} type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label>
        Caption (optional)
        <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} />
      </label>
      <label>
        Year (optional)
        <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} pattern="[0-9]{4}" maxLength={4} />
      </label>
      <ErrorMessage message={error} />
      <button type="submit" disabled={busy || !file}>
        Upload photo
      </button>
    </form>
  );
}
