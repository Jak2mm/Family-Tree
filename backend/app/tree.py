import sqlite3

from fastapi import APIRouter, Depends

from app.security import CurrentUser, get_conn, require

router = APIRouter(prefix="/api")


def compute_generations(
    person_ids: list[int],
    parent_links: list[tuple[int, int]],
    partnerships: list[tuple[int, int]],
) -> dict[int, int]:
    """Generation number for each person, 0 = oldest.

    A person sits at least one generation below each parent. Partners share the larger of
    their two generations; raising a partner never moves that partner's own ancestors.
    """
    gen = {pid: 0 for pid in person_ids}
    # Every pass that changes anything raises some generation, and a generation cannot exceed the
    # number of people, so this bound is never reached for real data. It only stops a cycle.
    for _ in range(2 * len(gen) + 2):
        changed = False
        for parent, child in parent_links:
            if gen[child] < gen[parent] + 1:
                gen[child] = gen[parent] + 1
                changed = True
        for a, b in partnerships:
            top = max(gen[a], gen[b])
            if gen[a] != top or gen[b] != top:
                gen[a] = gen[b] = top
                changed = True
        if not changed:
            break
    return gen


def year_of(date: str | None) -> int | None:
    return int(date[:4]) if date else None


@router.get("/tree")
def read_tree(_: CurrentUser = Depends(require("read")), conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute(
        "SELECT id, given_names, family_name, birth_date, death_date, profile_photo_id FROM Person ORDER BY id"
    ).fetchall()
    parent_links = [(r["parent_id"], r["child_id"]) for r in conn.execute("SELECT parent_id, child_id FROM ParentLink ORDER BY rowid")]
    partnerships = [(r["person_a_id"], r["person_b_id"]) for r in conn.execute("SELECT person_a_id, person_b_id FROM Partnership ORDER BY id")]
    gen = compute_generations([r["id"] for r in rows], parent_links, partnerships)
    return {
        "people": [
            {
                "id": r["id"],
                "name": f"{r['given_names']} {r['family_name']}".strip(),
                "birth_year": year_of(r["birth_date"]),
                "death_year": year_of(r["death_date"]),
                "generation": gen[r["id"]],
                "photo_id": r["profile_photo_id"],
            }
            for r in rows
        ],
        "parent_links": [list(p) for p in parent_links],
        "partnerships": [list(p) for p in partnerships],
    }
