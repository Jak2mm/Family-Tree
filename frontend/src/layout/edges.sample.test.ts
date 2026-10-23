import { describe, expect, it } from "vitest";
import { edgesFor } from "./edges";
import { CARD_H, CARD_W, PAD, layoutTree } from "./layoutTree";
import { SAMPLE_IDS, sampleFamily } from "./sampleFamily";

type Pt = [number, number];
type Nodes = ReturnType<typeof layoutTree>["nodes"];
const centre = (nodes: Nodes, id: number): Pt => {
  const n = nodes.find((x) => x.id === id)!;
  return [n.x + CARD_W / 2, n.y + CARD_H / 2];
};
function crossed(points: Pt[], nodes: Nodes, except: number[]): number[] {
  const overlap = (a: number, b: number, lo: number, hi: number) => {
    const [from, to] = a <= b ? [a, b] : [b, a];
    return from === to ? from > lo && from < hi : Math.max(from, lo) < Math.min(to, hi);
  };
  const hit = new Set<number>();
  for (let i = 1; i < points.length; i++) {
    for (const n of nodes) {
      if (!except.includes(n.id) && overlap(points[i - 1][0], points[i][0], n.x, n.x + CARD_W) && overlap(points[i - 1][1], points[i][1], n.y, n.y + CARD_H)) hit.add(n.id);
    }
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
