export type DateFormat = "DD-MM-YYYY" | "YYYY-MM-DD";

const STORED = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** Show a stored date (YYYY, YYYY-MM or YYYY-MM-DD) in the user's chosen style. Anything unrecognised is shown as it is. */
export function formatDate(iso: string, fmt: DateFormat): string {
  const m = STORED.exec(iso);
  if (!m || fmt === "YYYY-MM-DD") return iso;
  const [, year, month, day] = m;
  if (day) return `${day}-${month}-${year}`;
  if (month) return `${month}-${year}`;
  return year;
}

const EXAMPLES: Record<DateFormat, string> = {
  "DD-MM-YYYY": "07-03-1950, 03-1950 or 1950",
  "YYYY-MM-DD": "1950-03-07, 1950-03 or 1950",
};

function pad(n: string): string {
  return n.padStart(2, "0");
}

/** Turn what a person typed into the stored year-first text. Throws an Error with a plain message when it is not a real date. */
export function parseDateInput(text: string, fmt: DateFormat): string {
  const fail = () => new Error(`That does not look like a date that exists. Please use ${EXAMPLES[fmt]}.`);
  const parts = text.trim().replace(/[/.]/g, "-").split("-");
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) throw fail();

  let year: string, month: string | undefined, day: string | undefined;
  if (parts[0].length === 4) {
    [year, month, day] = parts; // a leading four-digit year is always year first
  } else if (fmt === "DD-MM-YYYY" && parts.length > 1 && parts[parts.length - 1].length === 4) {
    parts.reverse();
    [year, month, day] = parts;
  } else {
    throw fail();
  }
  if ((month !== undefined && month.length > 2) || (day !== undefined && day.length > 2)) throw fail();

  const y = Number(year);
  const m = month === undefined ? undefined : Number(month);
  const d = day === undefined ? undefined : Number(day);
  if (y < 1) throw fail();
  if (m !== undefined && (m < 1 || m > 12)) throw fail();
  if (m !== undefined && d !== undefined) {
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d < 1 || d > daysInMonth) throw fail();
  }
  return [year, month && pad(month), day && pad(day)].filter(Boolean).join("-");
}
