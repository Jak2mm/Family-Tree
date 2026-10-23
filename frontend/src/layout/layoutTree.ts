import type { TreeData, TreePerson } from "../types";

/** Card size and the empty space kept between cards, in pixels. */
export const CARD_W = 200;
export const CARD_H = 96;
export const GAP = 40;
export const PAD = 24;
/** Extra room, in card slots, between families that are not related through the tree. */
const FAMILY_GAP = 1.5;

export type LayoutId = 1 | 2 | 3 | 4;
export interface LaidOutNode { id: number; x: number; y: number }
export interface Band { label: string; start: number; size: number }
export interface TreeLayout { nodes: LaidOutNode[]; bands: Band[]; width: number; height: number }

// ---------------------------------------------------------------------------------------------
// Work happens in "slots": the position across a band is a number where 1 is one card plus its gap.
// ---------------------------------------------------------------------------------------------

type Contour = Map<number, [number, number]>; // band index -> [leftmost slot, rightmost slot]

interface Cluster {
  members: number[]; // left to right
  kids: { cluster: Cluster; anchor: number; via: number[] }[]; // child clusters, the person who links them, and which of our members are that person's parents
}
interface Placed {
  members: { id: number; x: number }[];
  kids: { placed: Placed; dx: number }[];
  contour: Contour;
  anchorX: number; // where the person who links this cluster to its parents sits
}

const include = (c: Contour, level: number, x: number) => {
  const r = c.get(level);
  if (!r) c.set(level, [x, x]);
  else {
    r[0] = Math.min(r[0], x);
    r[1] = Math.max(r[1], x);
  }
};
const merge = (into: Contour, from: Contour, dx: number) => from.forEach(([lo, hi], level) => (include(into, level, lo + dx), include(into, level, hi + dx)));
/** Smallest shift of `from` that keeps one slot between it and `into` on every band they share. */
const clearance = (into: Contour, from: Contour) => {
  let need = -Infinity;
  from.forEach(([lo], level) => {
    const other = into.get(level);
    if (other) need = Math.max(need, other[1] + 1 - lo);
  });
  return need;
};
const extent = (c: Contour): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  c.forEach(([a, b]) => ((lo = Math.min(lo, a)), (hi = Math.max(hi, b))));
  return [lo, hi];
};

export function layoutTree(data: TreeData, layout: LayoutId, bandYears = 10): TreeLayout {
  const people = new Map<number, TreePerson>(data.people.map((p) => [p.id, p]));
  if (people.size === 0) return { nodes: [], bands: [], width: 0, height: 0 };

  // Sorting: birth date (or year), then name, then id. Unknown birth sorts last.
  const sortKey = new Map<number, string>();
  people.forEach((p, id) => sortKey.set(id, p.birth_date ?? (p.birth_year === null ? "￿" : String(p.birth_year).padStart(4, "0"))));
  const cmp = (a: number, b: number) => {
    const ka = sortKey.get(a)!, kb = sortKey.get(b)!;
    if (ka !== kb) return ka < kb ? -1 : 1;
    const na = people.get(a)!.name.toLowerCase(), nb = people.get(b)!.name.toLowerCase();
    if (na !== nb) return na < nb ? -1 : 1;
    return a - b;
  };

  // Relationships between people who are in the tree.
  const partners = new Map<number, number[]>();
  const parents = new Map<number, number[]>();
  const hasChildren = new Set<number>();
  const add = (m: Map<number, number[]>, k: number, v: number) => {
    const list = m.get(k) ?? [];
    if (!list.includes(v)) list.push(v);
    m.set(k, list);
  };
  for (const [a, b] of data.partnerships) if (a !== b && people.has(a) && people.has(b)) (add(partners, a, b), add(partners, b, a));
  for (const [p, c] of data.parent_links) if (p !== c && people.has(p) && people.has(c)) (add(parents, c, p), hasChildren.add(p));
  parents.forEach((list) => list.sort(cmp));

  // Bands: which row (or column) each person belongs to.
  const byYear = layout === 3 || layout === 4;
  const levelKey = (p: TreePerson) => (byYear ? (p.birth_year === null ? Infinity : Math.floor(p.birth_year / bandYears)) : p.generation);
  const keys = [...new Set([...people.values()].map(levelKey))].sort((a, b) => a - b);
  const levelOf = new Map<number, number>();
  people.forEach((p, id) => levelOf.set(id, keys.indexOf(levelKey(p))));
  const labelOf = (key: number) =>
    !byYear ? `Generation ${key + 1}` : key === Infinity ? "Unknown year" : bandYears === 10 ? `${key * 10}s` : `${key * bandYears}–${(key + 1) * bandYears - 1}`;

  // Clusters: people joined by partnerships sit together in one left-to-right chain.
  const clusterOf = new Map<number, Cluster>();
  const roster = [...people.keys()].sort(cmp);
  for (const id of roster) {
    if (clusterOf.has(id)) continue;
    const found = [id];
    clusterOf.set(id, { members: [], kids: [] });
    for (let i = 0; i < found.length; i++) {
      for (const q of partners.get(found[i]) ?? []) if (!clusterOf.has(q)) (clusterOf.set(q, clusterOf.get(id)!), found.push(q));
    }
    clusterOf.get(id)!.members = chain(found, partners, cmp);
  }

  // Each cluster hangs from one parent cluster: that of the first member (left to right) who has known parents.
  const hasLayoutParent = new Set<Cluster>();
  const isolated: number[] = [];
  const clusters = [...new Set(roster.map((id) => clusterOf.get(id)!))];
  for (const cluster of clusters) {
    const only = cluster.members.length === 1 ? cluster.members[0] : null;
    if (only !== null && !parents.has(only) && !hasChildren.has(only)) {
      isolated.push(only);
      continue;
    }
    for (const person of cluster.members) {
      const home = clusterOf.get(parents.get(person)?.[0] ?? -1);
      if (!home || home === cluster) continue;
      home.kids.push({ cluster, anchor: person, via: parents.get(person)!.filter((p) => clusterOf.get(p) === home) });
      hasLayoutParent.add(cluster);
      break;
    }
  }

  // A cluster's anchor is the member that links it to its parents; roots simply use their first member.
  const anchors = new Map<Cluster, number>();
  clusters.forEach((c) => c.kids.forEach((k) => anchors.set(k.cluster, k.anchor)));
  const seen = new Set<Cluster>();
  const place = (cluster: Cluster): Placed => {
    seen.add(cluster);
    const contour: Contour = new Map();
    const members = cluster.members.map((id, i) => (include(contour, levelOf.get(id)!, i), { id, x: i }));
    const slot = (id: number) => cluster.members.indexOf(id);
    // Children of the same parents form a group, which is centred under those parents.
    const groups = new Map<string, { at: number; kids: Cluster["kids"] }>();
    for (const kid of cluster.kids) {
      if (seen.has(kid.cluster)) continue;
      const key = kid.via.map(slot).sort((a, b) => a - b).join(",");
      const group = groups.get(key) ?? { at: kid.via.reduce((sum, id) => sum + slot(id), 0) / kid.via.length, kids: [] };
      group.kids.push(kid);
      groups.set(key, group);
    }
    const placedKids: Placed["kids"] = [];
    for (const group of [...groups.values()].sort((a, b) => a.at - b.at)) {
      group.kids.sort((a, b) => cmp(a.anchor, b.anchor));
      const row: Contour = new Map();
      const among: { placed: Placed; dx: number }[] = [];
      let previous = -Infinity;
      for (const kid of group.kids) {
        if (seen.has(kid.cluster)) continue;
        const placed = place(kid.cluster);
        const dx = among.length === 0 ? 0 : Math.max(clearance(row, placed.contour), previous + 1 - placed.anchorX);
        among.push({ placed, dx });
        merge(row, placed.contour, dx);
        previous = dx + placed.anchorX;
      }
      if (among.length === 0) continue;
      const middle = (among[0].dx + among[0].placed.anchorX + previous) / 2;
      const shift = Math.max(group.at - middle, clearance(contour, row));
      for (const kid of among) placedKids.push({ placed: kid.placed, dx: kid.dx + shift });
      merge(contour, row, shift);
    }
    return { members, kids: placedKids, contour, anchorX: slot(anchors.get(cluster) ?? cluster.members[0]) };
  };

  const roots = clusters.filter((c) => !hasLayoutParent.has(c) && !(c.members.length === 1 && isolated.includes(c.members[0])));
  const slots = new Map<number, number>();
  let cursor = 0;
  const finish = (placed: Placed, dx: number) => {
    placed.members.forEach((m) => slots.set(m.id, m.x + dx));
    placed.kids.forEach((k) => finish(k.placed, dx + k.dx));
  };
  const placeFamily = (cluster: Cluster) => {
    const placed = place(cluster);
    const [lo, hi] = extent(placed.contour);
    const dx = cursor - lo;
    finish(placed, dx);
    cursor = hi + dx + FAMILY_GAP;
  };
  roots.forEach(placeFamily);
  clusters.filter((c) => !seen.has(c) && !(c.members.length === 1 && isolated.includes(c.members[0]))).forEach((c) => !seen.has(c) && placeFamily(c));

  // People with no relationships: a tidy row per band after the connected families.
  const next = new Map<number, number>();
  for (const id of isolated.sort(cmp)) {
    const level = levelOf.get(id)!;
    const n = next.get(level) ?? cursor;
    slots.set(id, n);
    next.set(level, n + 1);
  }

  // Slots to pixels.
  const rows = layout === 1 || layout === 3;
  const crossStep = (rows ? CARD_W : CARD_H) + GAP;
  const levelStep = (rows ? CARD_H : CARD_W) + GAP;
  const origin = Math.min(...slots.values());
  const levelPos = (level: number) => PAD + (rows ? level : keys.length - 1 - level) * levelStep;
  const nodes = [...slots.keys()].sort((a, b) => a - b).map((id) => {
    const cross = PAD + (slots.get(id)! - origin) * crossStep, along = levelPos(levelOf.get(id)!);
    return rows ? { id, x: cross, y: along } : { id, x: along, y: cross };
  });
  const bands = keys.map((key, level) => ({ label: labelOf(key), start: levelPos(level) - GAP / 2, size: levelStep }));
  const crossEnd = Math.max(...nodes.map((n) => (rows ? n.x : n.y))) + (rows ? CARD_W : CARD_H) + PAD;
  const levelEnd = keys.length * levelStep - GAP + 2 * PAD;
  return { nodes, bands, width: rows ? crossEnd : levelEnd, height: rows ? levelEnd : crossEnd };
}

/** Order one cluster left to right: the person with most partners in the middle, partners alternating to each side. */
function chain(found: number[], partners: Map<number, number[]>, cmp: (a: number, b: number) => number): number[] {
  if (found.length === 1) return found;
  const root = [...found].sort((a, b) => (partners.get(b)?.length ?? 0) - (partners.get(a)?.length ?? 0) || cmp(a, b))[0];
  const used = new Set([root]);
  const sides: number[][] = [[], []];
  const grow = (person: number, side: number[]) => {
    for (const q of [...(partners.get(person) ?? [])].sort(cmp)) if (!used.has(q)) (used.add(q), side.push(q), grow(q, side));
  };
  [...(partners.get(root) ?? [])].sort(cmp).forEach((q, i) => {
    if (used.has(q)) return;
    used.add(q);
    sides[i % 2].push(q);
    grow(q, sides[i % 2]);
  });
  return [...sides[1].reverse(), root, ...sides[0]];
}
