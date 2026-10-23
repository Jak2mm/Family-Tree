import { describe, expect, it } from "vitest";
import type { TreeData, TreePerson } from "../types";
import { edgesFor } from "./edges";
import { CARD_H, CARD_W, PAD, layoutTree, type LayoutId } from "./layoutTree";
import { SAMPLE_IDS, sampleFamily } from "./sampleFamily";

type Spec = { id: number; born?: number | null; gen?: number };
type Pt = [number, number];

function tree(people: Spec[], parents: [number, number][] = [], partners: [number, number][] = []): TreeData {
  return {
    people: people.map(
      (p): TreePerson => ({
        id: p.id, name: `P${p.id}`, birth_year: p.born === undefined ? 1900 : p.born, death_year: null,
        generation: p.gen ?? 0, photo_id: null, occupation: null, birth_date: null, death_date: null,
      }),
    ),
    parent_links: parents,
    partnerships: partners,
  };
}

type Nodes = ReturnType<typeof layoutTree>["nodes"];
const node = (nodes: Nodes, id: number) => nodes.find((n) => n.id === id)!;
const centre = (nodes: Nodes, id: number): Pt => [node(nodes, id).x + CARD_W / 2, node(nodes, id).y + CARD_H / 2];

/** True when the horizontal or vertical segment p-q passes through the inside of the card (touching its edge is fine). */
function segmentInsideCard(p: Pt, q: Pt, n: { x: number; y: number }): boolean {
  const overlap = (a: number, b: number, lo: number, hi: number) => {
    const [from, to] = a <= b ? [a, b] : [b, a];
    return from === to ? from > lo && from < hi : Math.max(from, lo) < Math.min(to, hi);
  };
  return overlap(p[0], q[0], n.x, n.x + CARD_W) && overlap(p[1], q[1], n.y, n.y + CARD_H);
}
/** Ids of the cards whose inside the polyline passes through, other than the listed ones. */
function crossed(points: Pt[], nodes: Nodes, except: number[]): number[] {
  const hit = new Set<number>();
  for (let i = 1; i < points.length; i++) {
    for (const n of nodes) if (!except.includes(n.id) && segmentInsideCard(points[i - 1], points[i], n)) hit.add(n.id);
  }
  return [...hit];
}
function onPolyline(p: Pt, points: Pt[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const within = (v: number, x: number, y: number) => v >= Math.min(x, y) && v <= Math.max(x, y);
    if (within(p[0], a[0], b[0]) && within(p[1], a[1], b[1])) return true;
  }
  return false;
}
const partnerEdges = (edges: ReturnType<typeof edgesFor>) => edges.filter((e) => e.kind === "partner");
const parentEdges = (edges: ReturnType<typeof edgesFor>) => edges.filter((e) => e.kind === "parent");

describe("edgesFor connectors", () => {
  it("draws a straight partner line and starts the child line at its midpoint for a couple side by side", () => {
    const data = tree([{ id: 1 }, { id: 2 }, { id: 3, gen: 1 }], [[1, 3], [2, 3]], [[1, 2]]);
    const { nodes } = layoutTree(data, 1);
    const edges = edgesFor(data, nodes, 1);
    const [partner] = partnerEdges(edges);
    expect(partner.points).toEqual([centre(nodes, 1), centre(nodes, 2)]);
    const [child] = parentEdges(edges);
    expect(child.points[0]).toEqual([(centre(nodes, 1)[0] + centre(nodes, 2)[0]) / 2, centre(nodes, 1)[1]]);
  });

  it("three partnerships: the child of the third partner starts on the 1-4 connector, which goes around the partners between", () => {
    const data = tree(
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 7, gen: 1 }],
      [[1, 7], [4, 7]],
      [[1, 2], [1, 3], [1, 4]],
    );
    const { nodes } = layoutTree(data, 1);
    const xs = [1, 2, 3, 4].map((id) => node(nodes, id).x);
    // Precondition: a card sits between 1 and 4, so a straight line would look like it belongs to that card.
    const between = [2, 3].filter((id) => node(nodes, id).x > Math.min(xs[0], xs[3]) && node(nodes, id).x < Math.max(xs[0], xs[3]));
    expect(between.length).toBeGreaterThan(0);

    const edges = edgesFor(data, nodes, 1);
    const [p12, p13, p14] = partnerEdges(edges);
    expect(p12.points).toHaveLength(2);
    expect(p13.points).toHaveLength(2);
    expect(crossed(p14.points, nodes, [1, 4])).toEqual([]);
    const [child] = parentEdges(edges);
    const start = child.points[0];
    expect(onPolyline(start, p14.points)).toBe(true);
    for (const id of between) {
      const c = centre(nodes, id);
      expect(start).not.toEqual(c);
      expect(onPolyline(c, p14.points)).toBe(false);
    }
    expect(crossed(child.points, nodes, [7])).toEqual([]);
    expect(child.points[child.points.length - 1]).toEqual([centre(nodes, 7)[0], node(nodes, 7).y]);
  });

  // Parent 1 (born 1950s) with partner 2 (no birth year, so in the Unknown year band) and children 3 and 4 (1980s).
  const crossBand = tree(
    [{ id: 1, born: 1950 }, { id: 2, born: null }, { id: 3, born: 1980, gen: 1 }, { id: 4, born: 1982, gen: 1 }],
    [[1, 3], [2, 3], [1, 4], [2, 4]],
    [[1, 2]],
  );

  it("layout 3: partners in different bands are joined around the children's row and the child lines start outside it", () => {
    const { nodes } = layoutTree(crossBand, 3);
    expect(node(nodes, 2).y).toBeGreaterThan(node(nodes, 3).y); // partner 2 is below the children
    const edges = edgesFor(crossBand, nodes, 3);
    const [partner] = partnerEdges(edges);
    expect(crossed(partner.points, nodes, [1, 2])).toEqual([]);
    const kids = parentEdges(edges);
    expect(kids).toHaveLength(2);
    for (const kid of kids) {
      expect(onPolyline(kid.points[0], partner.points)).toBe(true);
      expect(kid.points[0][1]).toBeLessThan(node(nodes, 3).y); // above the children's row
      expect(kid.points[0][1]).toBeGreaterThan(node(nodes, 1).y + CARD_H); // below the parent
    }
    expect(crossed(kids[0].points, nodes, [3])).toEqual([]);
    expect(crossed(kids[1].points, nodes, [4])).toEqual([]);
  });

  it("layout 4: the same couple is joined beside the children's column and the child lines start outside it", () => {
    const { nodes } = layoutTree(crossBand, 4);
    expect(node(nodes, 2).x).toBeLessThan(node(nodes, 3).x); // partner 2 is left of the children
    const edges = edgesFor(crossBand, nodes, 4);
    const [partner] = partnerEdges(edges);
    expect(crossed(partner.points, nodes, [1, 2])).toEqual([]);
    const kids = parentEdges(edges);
    for (const kid of kids) {
      expect(onPolyline(kid.points[0], partner.points)).toBe(true);
      expect(kid.points[0][0]).toBeGreaterThan(node(nodes, 3).x + CARD_W); // right of the children's column
      expect(kid.points[0][0]).toBeLessThan(node(nodes, 1).x); // left of the parent
    }
    expect(crossed(kids[0].points, nodes, [3])).toEqual([]);
    expect(crossed(kids[1].points, nodes, [4])).toEqual([]);
  });

  it("random odd data: every point is a real number and every edge ends on its own cards", () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const near = (p: Pt, id: number, nodes: Nodes) => {
      const n = node(nodes, id);
      return p[0] >= n.x - 1 && p[0] <= n.x + CARD_W + 1 && p[1] >= n.y - 1 && p[1] <= n.y + CARD_H + 1;
    };
    for (let round = 0; round < 15; round++) {
      const n = 30;
      const people: Spec[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, gen: Math.floor(rand() * 4), born: rand() < 0.2 ? null : 1900 + Math.floor(rand() * 40) }));
      const parents: [number, number][] = [];
      const partners: [number, number][] = [];
      for (let k = 0; k < 35; k++) {
        const a = 1 + Math.floor(rand() * n), b = 1 + Math.floor(rand() * n);
        if (a !== b) (rand() < 0.5 ? parents : partners).push([a, b]);
      }
      for (const layout of [1, 2, 3, 4] as LayoutId[]) {
        const data = tree(people, parents, partners);
        const { nodes } = layoutTree(data, layout);
        const edges = edgesFor(data, nodes, layout);
        for (const e of edges) for (const p of e.points) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
        const seen = new Set<string>();
        for (const [a, b] of partners) {
          if (seen.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) continue;
          seen.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
          const e = partnerEdges(edges).find((x) => (near(x.points[0], a, nodes) && near(x.points[x.points.length - 1], b, nodes)) || (near(x.points[0], b, nodes) && near(x.points[x.points.length - 1], a, nodes)));
          expect(e, `partner edge ${a}-${b}`).toBeDefined();
        }
        for (const e of parentEdges(edges)) {
          const last = e.points[e.points.length - 1];
          expect(nodes.some((nd) => near(last, nd.id, nodes))).toBe(true);
        }
      }
    }
  });
});

describe("edgesFor basics", () => {
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

// Parent 1 (1950s) and partner 5 (1970s) sit in different bands with 5 between 1 and the children (1980s).
describe("edgesFor child lines with a partner in a band between", () => {
  const nearCard = (p: Pt, nodes: Nodes) => nodes.find((n) => p[0] >= n.x - 1 && p[0] <= n.x + CARD_W + 1 && p[1] >= n.y - 1 && p[1] <= n.y + CARD_H + 1)!;
  function checkChildLines(data: TreeData, layout: LayoutId) {
    const { nodes } = layoutTree(data, layout);
    const edges = edgesFor(data, nodes, layout);
    const connectors = partnerEdges(edges);
    expect(connectors.length).toBeGreaterThan(0);
    for (const c of connectors) expect(crossed(c.points, nodes, data.partnerships.flat())).toEqual([]);
    const kids = parentEdges(edges);
    expect(kids.length).toBeGreaterThan(0);
    for (const kid of kids) {
      const child = nearCard(kid.points[kid.points.length - 1], nodes);
      expect(crossed(kid.points, nodes, [child.id]), `child ${child.id} layout ${layout} points ${JSON.stringify(kid.points)}`).toEqual([]);
      expect(connectors.some((c) => onPolyline(kid.points[0], c.points))).toBe(true);
    }
    return { nodes, kids };
  }
  const small = tree(
    [{ id: 1, born: 1950 }, { id: 5, born: 1972 }, { id: 4, born: 1982, gen: 1 }, { id: 6, born: 1984, gen: 1 }],
    [[1, 4], [5, 4], [1, 6], [5, 6]],
    [[1, 5]],
  );
  // Person 1 with four partners born in different decades and a child with each.
  const large = tree(
    [
      { id: 1, born: 1950 }, { id: 2, born: 1945 }, { id: 5, born: 1972 }, { id: 6, born: 1975 }, { id: 8, born: 1960 },
      { id: 3, born: 1980, gen: 1 }, { id: 4, born: 1982, gen: 1 }, { id: 7, born: 1985, gen: 1 }, { id: 10, born: 1990, gen: 1 },
    ],
    [[1, 3], [2, 3], [1, 4], [5, 4], [1, 7], [6, 7], [1, 10], [8, 10]],
    [[1, 2], [1, 5], [1, 6], [1, 8]],
  );

  it.each([3, 4] as const)("layout %i: a couple with a partner in between and two children has no line through a card", (layout) => {
    const { nodes } = checkChildLines(small, layout);
    // Precondition: partner 5's band really is between 1 and the children, or the test proves nothing.
    const along = (id: number) => (layout === 3 ? node(nodes, id).y : -node(nodes, id).x);
    expect(along(1)).toBeLessThan(along(5));
    expect(along(5)).toBeLessThan(along(4));
  });

  it.each([3, 4] as const)("layout %i: four partnerships with a child from each have no line through a card", (layout) => {
    const { nodes } = checkChildLines(large, layout);
    expect(new Set(nodes.map((n) => (layout === 3 ? n.y : n.x))).size).toBeGreaterThan(3);
  });

  it.each([1, 2] as const)("layout %i: the same families by generation also have clean child lines", (layout) => {
    checkChildLines(small, layout);
    checkChildLines(large, layout);
  });
});

// The seed family: George+Joan, Joan+Ray and George+Patricia each have children in the same row, and Susan
// is Mia's only recorded parent. Each family's lines must be told apart.
describe("edgesFor on the sample family", () => {
  type Seg = { p: Pt; q: Pt; owner: string };
  /** Who a line belongs to: a partner line and the child lines starting on it share one owner. */
  function owners(edges: ReturnType<typeof edgesFor>): Seg[] {
    const partners = partnerEdges(edges);
    const segs: Seg[] = [];
    edges.forEach((e, i) => {
      let owner = `e${i}`;
      if (e.kind === "partner") owner = `c${partners.indexOf(e)}`;
      else {
        const j = partners.findIndex((c) => onPolyline(e.points[0], c.points));
        owner = j >= 0 ? `c${j}` : `s${e.points[0].join(",")}`;
      }
      for (let k = 1; k < e.points.length; k++) segs.push({ p: e.points[k - 1], q: e.points[k], owner });
    });
    return segs;
  }
  function sharedRun(a: Seg, b: Seg): boolean {
    const run = (x1: number, x2: number, y1: number, y2: number) => Math.min(Math.max(x1, x2), Math.max(y1, y2)) - Math.max(Math.min(x1, x2), Math.min(y1, y2));
    if (a.p[1] === a.q[1] && b.p[1] === b.q[1] && a.p[1] === b.p[1]) return run(a.p[0], a.q[0], b.p[0], b.q[0]) > 0;
    if (a.p[0] === a.q[0] && b.p[0] === b.q[0] && a.p[0] === b.p[0]) return run(a.p[1], a.q[1], b.p[1], b.q[1]) > 0;
    return false;
  }
  const data = sampleFamily();

  it.each([1, 2, 3, 4] as const)("layout %i: no two families' lines run on top of each other", (layout) => {
    const { nodes } = layoutTree(data, layout);
    const segs = owners(edgesFor(data, nodes, layout));
    const clashes: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].owner !== segs[j].owner && sharedRun(segs[i], segs[j])) clashes.push(`${JSON.stringify(segs[i])} / ${JSON.stringify(segs[j])}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it.each([1, 2, 3, 4] as const)("layout %i: no line passes through a card other than its own ends", (layout) => {
    const { nodes } = layoutTree(data, layout);
    const edges = edgesFor(data, nodes, layout);
    const cardAt = (p: Pt) => nodes.find((n) => p[0] >= n.x && p[0] <= n.x + CARD_W && p[1] >= n.y && p[1] <= n.y + CARD_H)!.id;
    for (const e of partnerEdges(edges)) {
      const ends = [cardAt(e.points[0]), cardAt(e.points[e.points.length - 1])];
      expect(crossed(e.points, nodes, ends), `layout ${layout} partners ${ends}`).toEqual([]);
    }
    for (const e of parentEdges(edges)) {
      const child = cardAt(e.points[e.points.length - 1]);
      expect(crossed(e.points, nodes, [child]), `layout ${layout} child ${child}`).toEqual([]);
    }
  });

  it.each([1, 2, 3, 4] as const)("layout %i: lines keep clear of the edge of the drawing, where the band labels are", (layout) => {
    const { nodes, width, height } = layoutTree(data, layout);
    for (const e of edgesFor(data, nodes, layout)) {
      for (const [x, y] of e.points) {
        expect(x).toBeGreaterThanOrEqual(PAD);
        expect(x).toBeLessThanOrEqual(width - PAD);
        expect(y).toBeGreaterThanOrEqual(PAD);
        expect(y).toBeLessThanOrEqual(height - PAD);
      }
    }
  });

  it("layout 1: George and Joan's children and Joan and Ray's child hang from different bars", () => {
    const { nodes } = layoutTree(data, 1);
    const edges = parentEdges(edgesFor(data, nodes, 1));
    const endsAt = (id: number) => edges.find((e) => e.points[e.points.length - 1][0] === centre(nodes, id)[0])!;
    const bar = (id: number) => endsAt(id).points[endsAt(id).points.length - 2][1];
    expect(bar(SAMPLE_IDS.david)).toBe(bar(SAMPLE_IDS.susan));
    expect(bar(SAMPLE_IDS.adam)).not.toBe(bar(SAMPLE_IDS.david));
  });
});
