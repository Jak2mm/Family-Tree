import type { TreeData } from "../types";

// The sample family from scripts/seed_sample_family.py, with the ids the seed gives them (1..22 in PEOPLE order).
// Used only by tests, to check the tree drawing against the family the owner sees first.
const PEOPLE: [string, string | null, string | null][] = [
  ["Arthur Bennett", "1921-03-14", "1998-07-02"], ["Margaret Bennett", "1924", "2012-11-20"],
  ["George Bennett", "1947-05-09", null], ["Helen Murray", "1950-06", null], ["Frank Murray", "1948", "2019-02-11"],
  ["Joan Fisher", "1952-09-30", null], ["Ray Fisher", null, null], ["Patricia Bennett", "1955", null],
  ["David Bennett", "1974-01-22", null], ["Susan Bennett", "1977-08-05", null], ["Adam Fisher", "1982", null],
  ["Michael Bennett", "1987-04-18", null], ["Karen Reid", "1975", null], ["Peter Murray", "1979-12-01", null],
  ["Emma Bennett", "1976", null], ["Tom Reid", "1973-10-10", null], ["Anna Murray", "1981", null],
  ["Oliver Bennett", "2003-02-14", null], ["Ruby Bennett", "2006", null], ["Lily Reid", "2004-07-07", null],
  ["Mia Bennett", "2010-03-03", null], ["Jack Murray", "2012", null],
];
export const SAMPLE_IDS = {
  arthur: 1, margaret: 2, george: 3, helen: 4, frank: 5, joan: 6, ray: 7, patricia: 8, david: 9, susan: 10, adam: 11,
  michael: 12, karen: 13, peter: 14, emma: 15, tom: 16, anna: 17, oliver: 18, ruby: 19, lily: 20, mia: 21, jack: 22,
};
const PARENT_LINKS: [number, number][] = [
  [1, 3], [2, 3], [1, 4], [2, 4], [3, 9], [6, 9], [3, 10], [6, 10], [7, 11], [6, 11], [3, 12], [8, 12],
  [4, 13], [5, 13], [4, 14], [5, 14], [9, 18], [15, 18], [9, 19], [15, 19], [13, 20], [16, 20], [10, 21], [14, 22], [17, 22],
];
const PARTNERSHIPS: [number, number][] = [[1, 2], [4, 5], [3, 6], [3, 8], [6, 7], [9, 15], [13, 16], [14, 17]];

/** Same rule as the server (backend/app/tree.py compute_generations). */
function generations(n: number): number[] {
  const gen = new Array(n + 1).fill(0);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [p, c] of PARENT_LINKS) if (gen[c] < gen[p] + 1) ((gen[c] = gen[p] + 1), (changed = true));
    for (const [a, b] of PARTNERSHIPS) {
      const top = Math.max(gen[a], gen[b]);
      if (gen[a] !== top || gen[b] !== top) ((gen[a] = gen[b] = top), (changed = true));
    }
  }
  return gen;
}

export function sampleFamily(): TreeData {
  const gen = generations(PEOPLE.length);
  return {
    people: PEOPLE.map(([name, born, died], i) => ({
      id: i + 1, name, birth_date: born, death_date: died, birth_year: born ? Number(born.slice(0, 4)) : null,
      death_year: died ? Number(died.slice(0, 4)) : null, generation: gen[i + 1], photo_id: null, occupation: null,
    })),
    parent_links: PARENT_LINKS,
    partnerships: PARTNERSHIPS,
  };
}
