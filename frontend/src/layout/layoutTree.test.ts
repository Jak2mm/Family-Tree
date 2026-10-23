import { describe, expect, it } from "vitest";
import type { TreeData, TreePerson } from "../types";
import { edgesFor } from "./edges";
import { CARD_H, CARD_W, GAP, layoutTree } from "./layoutTree";

type Spec = { id: number; name?: string; born?: number | null; gen?: number; date?: string | null };

function tree(people: Spec[], parents: [number, number][] = [], partners: [number, number][] = []): TreeData {
  return {
    people: people.map(
      (p): TreePerson => ({
        id: p.id,
        name: p.name ?? `P${p.id}`,
        birth_year: p.born !== undefined ? p.born : p.date ? Number(p.date.slice(0, 4)) : 1900 + (p.gen ?? 0) * 25,
        death_year: null,
        generation: p.gen ?? 0,
        photo_id: null,
        occupation: null,
        birth_date: p.date ?? null,
        death_date: null,
      }),
    ),
    parent_links: parents,
    partnerships: partners,
  };
}

const at = (out: ReturnType<typeof layoutTree>, id: number) => {
  const n = out.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
};
const bandOf = (out: ReturnType<typeof layoutTree>, id: number, layout: 1 | 2 | 3 | 4) => {
  const n = at(out, id);
  const pos = layout === 1 || layout === 3 ? n.y : n.x;
  return out.bands.find((b) => pos >= b.start && pos < b.start + b.size)?.label;
};
function overlaps(out: ReturnType<typeof layoutTree>) {
  const bad: [number, number][] = [];
  for (let i = 0; i < out.nodes.length; i++)
    for (let j = i + 1; j < out.nodes.length; j++) {
      const a = out.nodes[i], b = out.nodes[j];
      if (Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H) bad.push([a.id, b.id]);
    }
  return bad;
}

// Grandparents 1+2, their children 3 and 4, with 3's child 5 and 4's child 6.
const family = tree(
  [
    { id: 1, gen: 0 }, { id: 2, gen: 0 },
    { id: 3, gen: 1 }, { id: 4, gen: 1 },
    { id: 5, gen: 2 }, { id: 6, gen: 2 },
  ],
  [[1, 3], [2, 3], [1, 4], [2, 4], [3, 5], [4, 6]],
  [[1, 2]],
);

describe("layoutTree generations", () => {
  it("layout 1 gives larger y to later generations and one row per generation", () => {
    const out = layoutTree(family, 1);
    expect(at(out, 1).y).toBe(at(out, 2).y);
    expect(at(out, 3).y).toBeGreaterThan(at(out, 1).y);
    expect(at(out, 5).y).toBeGreaterThan(at(out, 3).y);
    expect(at(out, 3).y).toBe(at(out, 4).y);
    expect(out.bands.map((b) => b.label)).toEqual(["Generation 1", "Generation 2", "Generation 3"]);
  });

  it("layout 2 gives smaller x to younger generations (youngest on the left)", () => {
    const out = layoutTree(family, 2);
    expect(at(out, 5).x).toBeLessThan(at(out, 3).x);
    expect(at(out, 3).x).toBeLessThan(at(out, 1).x);
    expect(at(out, 3).x).toBe(at(out, 4).x);
  });

  it("centres the parents above their children and spaces cards by one card plus the gap", () => {
    const out = layoutTree(tree([{ id: 1 }, { id: 2 }, { id: 3, gen: 1, date: "1950" }, { id: 4, gen: 1, date: "1952" }], [[1, 3], [2, 3], [1, 4], [2, 4]], [[1, 2]]), 1);
    const step = CARD_W + GAP;
    expect(at(out, 4).x - at(out, 3).x).toBe(step);
    expect(at(out, 2).x - at(out, 1).x).toBe(step);
    expect(at(out, 1).x + at(out, 2).x).toBe(at(out, 3).x + at(out, 4).x);
    expect(out.width).toBeGreaterThanOrEqual(at(out, 4).x + CARD_W);
    expect(out.height).toBeGreaterThanOrEqual(at(out, 3).y + CARD_H);
  });

  it("puts partners side by side in rows and one above the other in columns", () => {
    const rows = layoutTree(family, 1);
    expect(at(rows, 1).y).toBe(at(rows, 2).y);
    expect(Math.abs(at(rows, 1).x - at(rows, 2).x)).toBe(CARD_W + GAP);
    const cols = layoutTree(family, 2);
    expect(at(cols, 1).x).toBe(at(cols, 2).x);
    expect(Math.abs(at(cols, 1).y - at(cols, 2).y)).toBe(CARD_H + GAP);
  });

  it("keeps siblings in birth-date then name order whatever order the data arrives in", () => {
    const people: Spec[] = [
      { id: 1 }, { id: 2, gen: 1, name: "Zed", date: "1950-01-02" }, { id: 3, gen: 1, name: "Amy", date: "1950-06-01" },
      { id: 4, gen: 1, name: "Bea", born: 1950 }, { id: 5, gen: 1, name: "Cal", born: 1950 }, { id: 6, gen: 1, name: "Unknown", born: null },
    ];
    const links: [number, number][] = [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6]];
    const order = (out: ReturnType<typeof layoutTree>) => [...out.nodes].filter((n) => n.id > 1).sort((a, b) => a.x - b.x).map((n) => n.id);
    // Same year first, then dated before undated; "1950" sorts before "1950-01-02", then by name.
    const expected = order(layoutTree(tree(people, links), 1));
    expect(expected).toEqual([4, 5, 2, 3, 6]);
    expect(order(layoutTree(tree([...people].reverse(), [...links].reverse()), 1))).toEqual(expected);
  });
});

describe("layoutTree birth year bands", () => {
  const cousins = tree(
    [
      { id: 1, born: 1920 }, { id: 2, gen: 1, born: 1945 }, { id: 3, gen: 1, born: 1948 },
      { id: 4, gen: 2, born: 1971 }, // a generation above 6
      { id: 5, gen: 2, born: 1950 }, { id: 6, gen: 3, born: 1974 },
    ],
    [[1, 2], [1, 3], [2, 4], [3, 5], [5, 6]],
  );

  it("layout 3 puts cousins born 1971 and 1974 in the same band although one is a generation lower", () => {
    const out = layoutTree(cousins, 3);
    expect(at(out, 4).y).toBe(at(out, 6).y);
    expect(bandOf(out, 4, 3)).toBe("1970s");
    expect(bandOf(out, 6, 3)).toBe("1970s");
    expect(out.bands.map((b) => b.label)).toEqual(["1920s", "1940s", "1950s", "1970s"]);
    expect(at(out, 1).y).toBeLessThan(at(out, 4).y);
  });

  it("layout 4 runs the same bands left to right with the oldest on the right", () => {
    const out = layoutTree(cousins, 4);
    expect(at(out, 4).x).toBe(at(out, 6).x);
    expect(at(out, 4).x).toBeLessThan(at(out, 1).x);
  });

  it("uses the band size it is given", () => {
    const out = layoutTree(cousins, 3, 25);
    expect(out.bands.map((b) => b.label)).toEqual(["1900–1924", "1925–1949", "1950–1974"]);
  });

  it.each([3, 4] as const)("layout %i puts a person with no birth year in a final Unknown year band", (layout) => {
    const data = tree([{ id: 1, born: 1950 }, { id: 2, born: null, gen: 1 }, { id: 3, born: 1980, gen: 2 }, { id: 4, born: null }], [[1, 2], [2, 3]], [[2, 4]]);
    const out = layoutTree(data, layout);
    expect(out.bands.map((b) => b.label)).toEqual(["1950s", "1980s", "Unknown year"]);
    expect(bandOf(out, 2, layout)).toBe("Unknown year");
    expect(bandOf(out, 4, layout)).toBe("Unknown year");
    const unknown = out.bands[2], last = out.bands[1];
    if (layout === 3) expect(unknown.start).toBeGreaterThan(last.start);
    else expect(unknown.start).toBeLessThan(last.start);
    expect(overlaps(out)).toEqual([]);
  });
});

describe("layoutTree shape rules", () => {
  // Person 1 has partners 2 and 3; children 4, 5 with 2 and 6, 7 with 3.
  const twoPartners = tree(
    [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, gen: 1, date: "1950" }, { id: 5, gen: 1, date: "1952" }, { id: 6, gen: 1, date: "1960" }, { id: 7, gen: 1, date: "1962" }],
    [[1, 4], [2, 4], [1, 5], [2, 5], [1, 6], [3, 6], [1, 7], [3, 7]],
    [[1, 2], [1, 3]],
  );

  it.each([1, 2, 3, 4] as const)("layout %i: a person with two partnerships and children from each has no overlapping nodes", (layout) => {
    const out = layoutTree(twoPartners, layout);
    expect(out.nodes).toHaveLength(7);
    expect(overlaps(out)).toEqual([]);
  });

  it("layout 1: one partner on each side, each partnership's children grouped beside it", () => {
    const out = layoutTree(twoPartners, 1);
    const [x1, x2, x3] = [1, 2, 3].map((id) => at(out, id).x);
    expect((x2 < x1 && x1 < x3) || (x3 < x1 && x1 < x2)).toBe(true);
    expect(Math.abs(x1 - x2)).toBe(CARD_W + GAP);
    expect(Math.abs(x1 - x3)).toBe(CARD_W + GAP);
    // Each group of children is nearer its own partnership than the other one. They cannot all be
    // exactly centred: two groups of two are wider than the three parents.
    const kids = (a: number, b: number) => (at(out, a).x + at(out, b).x) / 2;
    expect(Math.abs(kids(4, 5) - at(out, 2).x)).toBeLessThan(Math.abs(kids(4, 5) - at(out, 3).x));
    expect(Math.abs(kids(6, 7) - at(out, 3).x)).toBeLessThan(Math.abs(kids(6, 7) - at(out, 2).x));
    expect(Math.max(at(out, 4).x, at(out, 5).x) < Math.min(at(out, 6).x, at(out, 7).x)).toBe(at(out, 2).x < at(out, 3).x);
  });

  it("places people with no relationships after the connected families", () => {
    const data = tree([{ id: 1 }, { id: 2, gen: 1 }, { id: 8, name: "Loner B" }, { id: 9, name: "Loner A" }], [[1, 2]]);
    const rows = layoutTree(data, 1);
    const connected = Math.max(at(rows, 1).x, at(rows, 2).x) + CARD_W;
    expect(at(rows, 9).x).toBeGreaterThanOrEqual(connected);
    expect(at(rows, 8).x).toBeGreaterThan(at(rows, 9).x); // tidy and ordered by name
    expect(at(rows, 8).y).toBe(at(rows, 9).y);
    const cols = layoutTree(data, 2);
    expect(at(cols, 9).y).toBeGreaterThanOrEqual(Math.max(at(cols, 1).y, at(cols, 2).y) + CARD_H);
    expect(overlaps(rows)).toEqual([]);
    expect(overlaps(cols)).toEqual([]);
  });

  it("handles an empty tree", () => {
    for (const layout of [1, 2, 3, 4] as const) {
      const out = layoutTree(tree([]), layout);
      expect(out.nodes).toEqual([]);
      expect(out.bands).toEqual([]);
    }
  });

  it("is deterministic", () => {
    for (const layout of [1, 2, 3, 4] as const) {
      expect(layoutTree(twoPartners, layout)).toEqual(layoutTree(twoPartners, layout));
      expect(layoutTree(family, layout)).toEqual(layoutTree(JSON.parse(JSON.stringify(family)), layout));
    }
  });

  it("never overlaps cards, even for odd data: loops, shared children across families, parents and children in one band", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 25; round++) {
      const n = 40;
      const people: Spec[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, gen: Math.floor(rand() * 5), born: rand() < 0.2 ? null : 1900 + Math.floor(rand() * 40) }));
      const parents: [number, number][] = [];
      const partners: [number, number][] = [];
      for (let k = 0; k < 45; k++) {
        const a = 1 + Math.floor(rand() * n), b = 1 + Math.floor(rand() * n);
        if (a !== b) (rand() < 0.5 ? parents : partners).push([a, b]); // may include loops and duplicates
      }
      for (const layout of [1, 2, 3, 4] as const) {
        const out = layoutTree(tree(people, parents, partners), layout);
        expect(out.nodes).toHaveLength(n);
        expect(overlaps(out)).toEqual([]);
      }
    }
  });
});

function bigTree(count: number): TreeData {
  const people: Spec[] = [];
  const parents: [number, number][] = [];
  const partners: [number, number][] = [];
  let id = 1;
  const make = (gen: number) => people.push({ id: id++, gen, born: 1800 + gen * 25 + (id % 7) });
  // Families of two partners with three children each, three generations deep, many roots.
  const grow = (a: number, b: number, gen: number) => {
    if (gen >= 4) return;
    for (let c = 0; c < 3 && id <= count; c++) {
      make(gen + 1);
      const child = id - 1;
      parents.push([a, child], [b, child]);
      if (id <= count) {
        make(gen + 1);
        partners.push([child, id - 1]);
        grow(child, id - 1, gen + 1);
      }
    }
  };
  while (id <= count) {
    make(0);
    make(0);
    partners.push([id - 2, id - 1]);
    grow(id - 2, id - 1, 0);
  }
  return tree(people.slice(0, count), parents.filter(([a, b]) => a <= count && b <= count), partners.filter(([a, b]) => a <= count && b <= count));
}

describe("layoutTree performance", () => {
  it("lays out 300 people in under 500 ms in every layout", () => {
    const data = bigTree(300);
    expect(data.people).toHaveLength(300);
    for (const layout of [1, 2, 3, 4] as const) {
      const start = performance.now();
      const out = layoutTree(data, layout);
      expect(performance.now() - start).toBeLessThan(500);
      expect(out.nodes).toHaveLength(300);
      expect(overlaps(out)).toEqual([]);
    }
  });
});

describe("edgesFor", () => {
  it("joins partners and drops each child from the middle of its parents' partnership (rows)", () => {
    const data = tree([{ id: 1 }, { id: 2 }, { id: 3, gen: 1 }], [[1, 3], [2, 3]], [[1, 2]]);
    const nodes = layoutTree(data, 1).nodes;
    const edges = edgesFor(data, nodes, 1);
    const centre = (id: number) => ({ x: nodes.find((n) => n.id === id)!.x + CARD_W / 2, y: nodes.find((n) => n.id === id)!.y + CARD_H / 2 });
    const partner = edges.filter((e) => e.kind === "partner");
    expect(partner).toHaveLength(1);
    expect(partner[0].points).toEqual([[centre(1).x, centre(1).y], [centre(2).x, centre(2).y]]);
    const parent = edges.filter((e) => e.kind === "parent");
    expect(parent).toHaveLength(1); // one line for the pair, not one per parent
    const pts = parent[0].points;
    expect(pts[0]).toEqual([(centre(1).x + centre(2).x) / 2, centre(1).y]);
    expect(pts[pts.length - 1]).toEqual([centre(3).x, nodes.find((n) => n.id === 3)!.y]);
  });

  it("runs sideways in the column layouts, from the parent's left edge to the child's right edge", () => {
    const data = tree([{ id: 1 }, { id: 3, gen: 1 }], [[1, 3]]);
    const nodes = layoutTree(data, 2).nodes;
    const [edge] = edgesFor(data, nodes, 2);
    const p = nodes.find((n) => n.id === 1)!, c = nodes.find((n) => n.id === 3)!;
    expect(edge.points[0]).toEqual([p.x, p.y + CARD_H / 2]);
    expect(edge.points[edge.points.length - 1]).toEqual([c.x + CARD_W, c.y + CARD_H / 2]);
  });

  it("ignores links to people who are not in the tree", () => {
    const data = tree([{ id: 1 }], [[1, 99]], [[1, 98]]);
    expect(edgesFor(data, layoutTree(data, 1).nodes, 1)).toEqual([]);
  });
});
