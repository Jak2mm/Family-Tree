import { describe, expect, it } from "vitest";
import type { TreeData, TreePerson } from "../types";
import { edgesFor } from "./edges";
import { CARD_H, CARD_W, layoutTree, type LayoutId } from "./layoutTree";

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
