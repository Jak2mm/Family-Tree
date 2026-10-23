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
interface Seg { p: Pt; q: Pt; owner: string }

const LANE_START = 8; // distance of the first lane from the card edge
const LANE_STEP = 8;
const LANES = 4; // the gap between bands is GAP wide, so lanes repeat after this many
/** Where a family's bar may sit, measured back from the start of the children's band (the middle first). */
const BAR_OFFSETS = [GAP / 2, GAP / 2 - 8, GAP / 2 + 8, 8, GAP - 8, 16, GAP - 16, 4, GAP - 4];
/** Sideways shifts tried for the point where a partner line leaves or enters a card. */
const PORT_SHIFTS = [0, -16, 16, -32, 32];

function overlap(a: number, b: number, lo: number, hi: number) {
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return from === to ? from > lo && from < hi : Math.max(from, lo) < Math.min(to, hi);
}
function touches(p: Pt, q: Pt, box: Box): boolean {
  return overlap(p[0], q[0], box.u0, box.u1) && overlap(p[1], q[1], box.v0, box.v1);
}
/** True when two straight segments lie on the same line and share a stretch longer than a point. */
function sharedRun(a: Seg, p: Pt, q: Pt): boolean {
  const run = (x1: number, x2: number, y1: number, y2: number) => Math.min(Math.max(x1, x2), Math.max(y1, y2)) - Math.max(Math.min(x1, x2), Math.min(y1, y2));
  if (a.p[1] === a.q[1] && p[1] === q[1] && a.p[1] === p[1]) return run(a.p[0], a.q[0], p[0], q[0]) > 0;
  if (a.p[0] === a.q[0] && p[0] === q[0] && a.p[0] === p[0]) return run(a.p[1], a.q[1], p[1], q[1]) > 0;
  return false;
}
const tidy = (line: Pt[]) => line.filter((p, i) => i === 0 || p[0] !== line[i - 1][0] || p[1] !== line[i - 1][1]);

/**
 * Lines to draw, from card positions alone: a connector per partnership, and one line per child that starts
 * on the connector of its two parents (or at the edge of a lone parent's card).
 * Partners side by side get a straight line. Any other couple is joined by a route through the empty gap just
 * after the earlier partner's band, so it never crosses a card and the children's lines run on from it.
 * Each family (a couple, or a lone parent) gets its own bar above its children, and no line is laid on top of
 * another family's line, so it is always clear whose children are whose.
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

  const drawn: Seg[] = [];
  const clash = (p: Pt, q: Pt, owner: string) => drawn.some((s) => s.owner !== owner && sharedRun(s, p, q));
  // Where each couple's children's lines start: no other family's line may pass through such a point.
  const sources: { at: Pt; owner: string }[] = [];
  const onSegment = (r: Pt, p: Pt, q: Pt) =>
    (p[0] === q[0] && r[0] === p[0] && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1])) ||
    (p[1] === q[1] && r[1] === p[1] && r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]));
  const clear = (line: Pt[], owner: string, except: number[]) => {
    for (let i = 1; i < line.length; i++) {
      const [p, q] = [line[i - 1], line[i]];
      if (p[0] === q[0] && p[1] === q[1]) continue;
      if (blocked(p, q, except) || clash(p, q, owner)) return false;
      if (sources.some((s) => s.owner !== owner && onSegment(s.at, p, q))) return false;
    }
    return true;
  };
  const record = (line: Pt[], owner: string) => line.forEach((q, i) => i > 0 && drawn.push({ p: line[i - 1], q, owner }));

  // Channels run between cards across a band; never outside the outermost cards, where they would hug the
  // edge of the drawing and the band labels.
  const all = [...boxes.values()];
  const [uLo, uHi] = [Math.min(...all.map((b) => b.u0)), Math.max(...all.map((b) => b.u1))];
  const channelSet = new Set<number>();
  for (const box of all) for (const u of [box.u0 - GAP / 2, box.u1 + GAP / 2]) if (u > uLo && u < uHi) channelSet.add(u);
  const channels = (near: number) => [...channelSet].sort((x, y) => Math.abs(x - near) - Math.abs(y - near) || x - y);

  const lanesUsed = new Map<number, number>();
  const joinPartners = (idA: number, idB: number, owner: string): { points: Pt[]; mid: Pt; lane: number } => {
    const [first, second] = [idA, idB].sort((x, y) => boxes.get(x)!.v0 - boxes.get(y)!.v0 || boxes.get(x)!.u0 - boxes.get(y)!.u0 || x - y);
    const a = boxes.get(first)!;
    const b = boxes.get(second)!;
    const [ca, cb] = [middle(a), middle(b)];
    const sameBand = a.v0 === b.v0;
    const ends = [first, second];
    if (sameBand && clear([ca, cb], owner, ends)) {
      return { points: [ca, cb], mid: [(ca[0] + cb[0]) / 2, ca[1]], lane: a.v1 + GAP / 2 };
    }
    const used = lanesUsed.get(a.v1) ?? 0;
    lanesUsed.set(a.v1, used + 1);
    const entry = (u: number) => (u < cb[0] ? b.u0 : b.u1);
    const attempt = (shift: number, k: number) => {
      const lane = a.v1 + LANE_START + LANE_STEP * ((used + k) % LANES);
      const out: Pt = [ca[0] + shift, a.v1];
      if (sameBand) {
        const into = cb[0] + shift;
        return { points: [out, [out[0], lane], [into, lane], [into, b.v1]] as Pt[], mid: [(out[0] + into) / 2, lane] as Pt, lane };
      }
      // Different bands: along the lane, then down a free channel beside the later partner's card, then in from the side.
      const others = [...boxes].filter(([id]) => id !== first && id !== second).map(([, box]) => box);
      const free = (p: Pt, q: Pt) => !others.some((box) => touches(p, q, box)) && !clash(p, q, owner);
      const into = cb[1] + shift / 2;
      const ranked = channels(cb[0]).filter((u) => u <= b.u0 || u >= b.u1);
      const channel = ranked.find((u) => free([u, lane], [u, into]) && free([u, into], [entry(u), into]) && free([out[0], lane], [u, lane])) ?? ranked[0] ?? b.u0 - GAP / 2;
      const points: Pt[] = [out, [out[0], lane], [channel, lane], [channel, into], [entry(channel), into]];
      return { points, mid: [(out[0] + channel) / 2, lane] as Pt, lane };
    };
    for (const shift of PORT_SHIFTS) {
      for (let k = 0; k < LANES; k++) {
        const route = attempt(shift, k);
        if (clear(route.points, owner, ends)) return route;
      }
    }
    return attempt(0, 0);
  };

  /**
   * From one family's source down to its children in one band: a bar in the gap just before the children's band,
   * at a height no other family's line uses. If a card or another family's line is in the way of the first drop,
   * go sideways along the free gap after the parents and drop in a channel between cards instead.
   */
  const familyLines = (owner: string, source: Pt, lane: number, targets: { id: number; at: Pt }[]): Pt[][] => {
    const bandStart = targets[0].at[1];
    const bars = [...new Set(BAR_OFFSETS.map((off) => bandStart - off).filter((v) => v >= source[1]))];
    if (bars.length === 0) bars.push(source[1]);
    const build = (bar: number, strict: boolean): Pt[][] | null => {
      let down: Pt[] = [source, [source[0], bar]];
      if (!clear(down, owner, [])) {
        const ranked = channels(source[0]);
        const via = ranked.find((u) => clear([source, [source[0], lane], [u, lane], [u, bar]], owner, []));
        if (via === undefined && strict) return null;
        const u = via ?? ranked[0] ?? source[0];
        down = [source, [source[0], lane], [u, lane], [u, bar]];
      }
      const lines = targets.map((t) => tidy([...down, [t.at[0], bar], t.at]));
      if (strict && !lines.every((line, i) => clear(line, owner, [targets[i].id]))) return null;
      return lines;
    };
    for (const bar of bars) {
      const lines = build(bar, true);
      if (lines) return lines;
    }
    return build(bars[0], false)!;
  };

  const edges: Edge[] = [];
  const mids = new Map<string, { mid: Pt; lane: number }>();
  const keyOf = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  for (const [a, b] of data.partnerships) {
    if (a === b || !boxes.has(a) || !boxes.has(b) || mids.has(keyOf(a, b))) continue;
    const owner = `c${keyOf(a, b)}`;
    const route = joinPartners(a, b, owner);
    route.points = tidy(route.points);
    record(route.points, owner);
    sources.push({ at: route.mid, owner });
    mids.set(keyOf(a, b), { mid: route.mid, lane: route.lane });
    edges.push({ kind: "partner", points: route.points.map(real) });
  }

  const parentsOf = new Map<number, number[]>();
  for (const [p, c] of data.parent_links) {
    if (boxes.has(p) && boxes.has(c) && p !== c) parentsOf.set(c, [...(parentsOf.get(c) ?? []), p]);
  }
  // Gather children into families: the same source (couple or lone parent) and the same band.
  interface Family { owner: string; source: Pt; lane: number; targets: { id: number; at: Pt; order: number }[] }
  const families = new Map<string, Family>();
  let order = 0;
  for (const [childId, list] of [...parentsOf].sort((x, y) => x[0] - y[0])) {
    const child = boxes.get(childId)!;
    const at: Pt = [middle(child)[0], child.v0];
    const done = new Set<number>();
    for (const parentId of [...new Set(list)].sort((x, y) => x - y)) {
      if (done.has(parentId)) continue;
      done.add(parentId);
      const mate = list.find((q) => !done.has(q) && mids.has(keyOf(parentId, q)));
      let owner: string, source: Pt, lane: number; // lane: a free gap just after the parents, for sideways moves
      if (mate !== undefined) {
        done.add(mate);
        owner = `c${keyOf(parentId, mate)}`;
        ({ mid: source, lane } = mids.get(keyOf(parentId, mate))!);
      } else {
        const parent = boxes.get(parentId)!;
        owner = `p${parentId}`;
        source = [middle(parent)[0], parent.v1];
        lane = parent.v1 + GAP / 2;
      }
      const key = `${owner}@${at[1]}`;
      const family = families.get(key) ?? { owner, source, lane, targets: [] };
      family.targets.push({ id: childId, at, order: order++ });
      families.set(key, family);
    }
  }
  const lines: { order: number; points: Pt[] }[] = [];
  for (const family of families.values()) {
    const routed = familyLines(family.owner, family.source, family.lane, family.targets);
    routed.forEach((points, i) => {
      record(points, family.owner);
      lines.push({ order: family.targets[i].order, points });
    });
  }
  lines.sort((x, y) => x.order - y.order).forEach((l) => edges.push({ kind: "parent", points: l.points.map(real) }));
  return edges;
}
