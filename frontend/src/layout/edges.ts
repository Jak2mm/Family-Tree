import type { TreeData } from "../types";
import { CARD_H, CARD_W, GAP, type LaidOutNode, type LayoutId } from "./layoutTree";

export interface Edge {
  kind: "parent" | "partner";
  points: [number, number][];
}

// The routing is done once, in "across, along" coordinates: u runs across a band, v runs along the
// direction of descent (towards younger people). For rows that is (x, y); for columns, where younger
// people are on the left, it is (y, -x). Points are turned back into x, y at the end.
type Pt = [number, number];
interface Box { u0: number; u1: number; v0: number; v1: number }

const LANE_START = 8; // distance of the first lane from the card edge
const LANE_STEP = 8;
const LANES = 4; // the gap between bands is GAP wide, so lanes repeat after this many

function touches(p: Pt, q: Pt, box: Box): boolean {
  const overlap = (a: number, b: number, lo: number, hi: number) => {
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    return from === to ? from > lo && from < hi : Math.max(from, lo) < Math.min(to, hi);
  };
  return overlap(p[0], q[0], box.u0, box.u1) && overlap(p[1], q[1], box.v0, box.v1);
}

/**
 * Lines to draw, from card positions alone: a connector per partnership, and one line per child that starts
 * on the connector of its two parents (or at the edge of a lone parent's card).
 * Partners side by side get a straight line. Any other couple is joined by a route through the empty gap just
 * after the earlier partner's band, so it never crosses a card and the children's lines run on from it.
 */
export function edgesFor(data: TreeData, nodes: LaidOutNode[], layout: LayoutId): Edge[] {
  const rows = layout === 1 || layout === 3;
  const boxes = new Map<number, Box>();
  for (const n of nodes) {
    boxes.set(n.id, rows ? { u0: n.x, u1: n.x + CARD_W, v0: n.y, v1: n.y + CARD_H } : { u0: n.y, u1: n.y + CARD_H, v0: -(n.x + CARD_W), v1: -n.x });
  }
  const real = (p: Pt): Pt => (rows ? [p[0], p[1]] : [-p[1], p[0]]);
  const middle = (b: Box): Pt => [(b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2];
  const blocked = (p: Pt, q: Pt, except: number[]) => [...boxes].some(([id, b]) => !except.includes(id) && touches(p, q, b));

  const lanesUsed = new Map<number, number>();
  const joinPartners = (idA: number, idB: number): { points: Pt[]; mid: Pt; lane: number } => {
    const [first, second] = [idA, idB].sort((x, y) => boxes.get(x)!.v0 - boxes.get(y)!.v0 || boxes.get(x)!.u0 - boxes.get(y)!.u0 || x - y);
    const a = boxes.get(first)!;
    const b = boxes.get(second)!;
    const [ca, cb] = [middle(a), middle(b)];
    const sameBand = a.v0 === b.v0;
    if (sameBand && !blocked(ca, cb, [first, second])) {
      return { points: [ca, cb], mid: [(ca[0] + cb[0]) / 2, ca[1]], lane: a.v1 + GAP / 2 };
    }
    const used = lanesUsed.get(a.v1) ?? 0;
    lanesUsed.set(a.v1, used + 1);
    const lane = a.v1 + LANE_START + LANE_STEP * (used % LANES);
    const out: Pt = [ca[0], a.v1];
    if (sameBand) {
      return { points: [out, [ca[0], lane], [cb[0], lane], [cb[0], b.v1]], mid: [(ca[0] + cb[0]) / 2, lane], lane };
    }
    // Different bands: along the lane, then down a free channel beside the later partner's card, then in from the side.
    const others = [...boxes].filter(([id]) => id !== first && id !== second).map(([, box]) => box);
    const free = (p: Pt, q: Pt) => !others.some((box) => touches(p, q, box));
    const candidates = new Set<number>();
    for (const box of boxes.values()) {
      candidates.add(box.u0 - GAP / 2);
      candidates.add(box.u1 + GAP / 2);
    }
    const ranked = [...candidates].filter((u) => u <= b.u0 || u >= b.u1).sort((x, y) => Math.abs(x - cb[0]) - Math.abs(y - cb[0]) || x - y);
    const entry = (u: number) => (u < cb[0] ? b.u0 : b.u1);
    const channel = ranked.find((u) => free([u, lane], [u, cb[1]]) && free([u, cb[1]], [entry(u), cb[1]])) ?? ranked[0];
    return { points: [out, [ca[0], lane], [channel, lane], [channel, cb[1]], [entry(channel), cb[1]]], mid: [(ca[0] + channel) / 2, lane], lane };
  };

  /**
   * From the parents down to the child, with the horizontal run in the gap just before the child's band, where no card is.
   * If a card in an intermediate band is in the way of the first drop, go sideways along the free gap after the parents
   * and drop in a channel between cards instead.
   */
  const childLine = (source: Pt, lane: number, target: Pt): Pt[] => {
    const bus = Math.max(target[1] - GAP / 2, source[1]);
    let down: Pt[] = [source, [source[0], bus]];
    if (blocked(source, [source[0], bus], [])) {
      const candidates = new Set<number>();
      for (const box of boxes.values()) {
        candidates.add(box.u0 - GAP / 2);
        candidates.add(box.u1 + GAP / 2);
      }
      const ranked = [...candidates].sort((x, y) => Math.abs(x - source[0]) - Math.abs(y - source[0]) || x - y);
      const channel = ranked.find((u) => !blocked([u, lane], [u, bus], [])) ?? ranked[0];
      down = [source, [source[0], lane], [channel, lane], [channel, bus]];
    }
    const line: Pt[] = [...down, [target[0], bus], target];
    return line.filter((p, i) => i === 0 || p[0] !== line[i - 1][0] || p[1] !== line[i - 1][1]);
  };

  const edges: Edge[] = [];
  const mids = new Map<string, { mid: Pt; lane: number }>();
  const keyOf = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  for (const [a, b] of data.partnerships) {
    if (a === b || !boxes.has(a) || !boxes.has(b) || mids.has(keyOf(a, b))) continue;
    const route = joinPartners(a, b);
    mids.set(keyOf(a, b), { mid: route.mid, lane: route.lane });
    edges.push({ kind: "partner", points: route.points.map(real) });
  }

  const parentsOf = new Map<number, number[]>();
  for (const [p, c] of data.parent_links) {
    if (boxes.has(p) && boxes.has(c) && p !== c) parentsOf.set(c, [...(parentsOf.get(c) ?? []), p]);
  }
  for (const [childId, list] of [...parentsOf].sort((x, y) => x[0] - y[0])) {
    const child = boxes.get(childId)!;
    const target: Pt = [middle(child)[0], child.v0];
    const done = new Set<number>();
    for (const parentId of [...new Set(list)].sort((x, y) => x - y)) {
      if (done.has(parentId)) continue;
      done.add(parentId);
      const mate = list.find((q) => !done.has(q) && mids.has(keyOf(parentId, q)));
      let source: Pt;
      let lane: number; // a free horizontal gap just after the parents, usable for sideways moves
      if (mate !== undefined) {
        done.add(mate);
        ({ mid: source, lane } = mids.get(keyOf(parentId, mate))!);
      } else {
        const parent = boxes.get(parentId)!;
        source = [middle(parent)[0], parent.v1];
        lane = parent.v1 + GAP / 2;
      }
      edges.push({ kind: "parent", points: childLine(source, lane, target).map(real) });
    }
  }
  return edges;
}
