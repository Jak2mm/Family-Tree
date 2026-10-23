import { useState } from "react";
import { api } from "../api";
import type { DateFormat } from "../dates";
import { useMe } from "../me";
import { ErrorMessage } from "./ErrorMessage";

export function UserMenu() {
  const { user, dateFormat, setDateFormat, signOut } = useMe();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const choose = async (format: DateFormat) => setError(await setDateFormat(format));
  const leave = async () => {
    try {
      await api.logout();
    } catch {
      /* the session may already be over; either way the person leaves */
    }
    signOut();
  };

  return (
    <div className="usermenu">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {user.username}
      </button>
      {open && (
        <div className="usermenu-panel">
          <label>
            Date format
            <select value={dateFormat} onChange={(e) => choose(e.target.value as DateFormat)}>
              <option value="DD-MM-YYYY">DD-MM-YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </label>
          <ErrorMessage message={error} />
          <button type="button" onClick={leave}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
