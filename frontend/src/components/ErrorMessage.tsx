export function ErrorMessage({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="error">
      {message}
    </p>
  );
}
