import calendar
import re
from dataclasses import dataclass

_PATTERN = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")


@dataclass(frozen=True)
class PartialDate:
    year: int
    month: int | None = None
    day: int | None = None


def parse_date(s: str) -> PartialDate:
    """Parse YYYY, YYYY-MM or YYYY-MM-DD. Raises ValueError if invalid."""
    m = _PATTERN.match(s) if isinstance(s, str) else None
    if not m:
        raise ValueError(f"Invalid date: {s!r}. Use YYYY, YYYY-MM or YYYY-MM-DD.")
    year = int(m.group(1))
    month = int(m.group(2)) if m.group(2) else None
    day = int(m.group(3)) if m.group(3) else None
    if year < 1:
        raise ValueError(f"Invalid year in {s!r}")
    if month is not None and not 1 <= month <= 12:
        raise ValueError(f"Invalid month in {s!r}")
    if day is not None and not 1 <= day <= calendar.monthrange(year, month)[1]:
        raise ValueError(f"Invalid day in {s!r}")
    return PartialDate(year, month, day)


def sort_key(s: str | None) -> tuple:
    """Sort key: earlier dates first, less precise before more precise on
    the same year/month, and missing dates last."""
    if s is None:
        return (1, 0, 0, 0)
    d = parse_date(s)
    return (0, d.year, d.month or 0, d.day or 0)


def _bounds(s: str) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Earliest and latest possible day of a partial date, as (year, month, day)."""
    d = parse_date(s)
    first = (d.year, d.month or 1, d.day or 1)
    last_month = d.month or 12
    last = (d.year, last_month, d.day or calendar.monthrange(d.year, last_month)[1])
    return first, last


def provably_before(a: str, b: str) -> bool:
    """True only if the latest possible moment of `a` is strictly earlier than
    the earliest possible moment of `b`. A partial date means the whole year or month."""
    return _bounds(a)[1] < _bounds(b)[0]


def add_years(s: str, years: int) -> str:
    """Shift a partial date by whole years, keeping its precision (29 Feb becomes 28 Feb in a non-leap year)."""
    d = parse_date(s)
    year = min(d.year + years, 9999)
    if d.month is None:
        return f"{year:04d}"
    if d.day is None:
        return f"{year:04d}-{d.month:02d}"
    day = min(d.day, calendar.monthrange(year, d.month)[1])
    return f"{year:04d}-{d.month:02d}-{day:02d}"
