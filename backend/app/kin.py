"""Which parents count when deciding who is a sibling, and whether a sibling is full or half.

Biological and adoptive parents count. Step and foster parents are recorded and shown, but they do not
make anyone a sibling or a half-sibling, and a sibling link never copies them.
"""
import sqlite3

FAMILY_KINDS = ("biological", "adoptive")


def family_parents(conn: sqlite3.Connection, person_id: int) -> dict[int, str]:
    """Parent id -> link kind, for biological and adoptive parents only."""
    rows = conn.execute(
        "SELECT parent_id, kind FROM ParentLink WHERE child_id = ? AND kind IN (?, ?)", (person_id, *FAMILY_KINDS)
    )
    return {r[0]: r[1] for r in rows}
