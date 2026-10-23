export function Placeholder({ title, children }: { title: string; children: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <p className="muted">{children}</p>
    </div>
  );
}
