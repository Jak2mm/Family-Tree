import type { NewLink } from "../types";

export type Relation = NewLink["relation"];
export type ParentKind = NonNullable<NewLink["parent_kind"]>;
export type PartnershipKind = NonNullable<NewLink["partnership_kind"]>;

const WORDS: [Relation, string[]][] = [
  ["parent", ["father", "mother", "mum", "mom", "dad", "parent"]],
  ["child", ["son", "daughter", "child", "kid"]],
  ["spouse", ["husband", "wife", "partner", "spouse", "de facto", "married"]],
  ["sibling", ["brother", "sister", "sibling"]],
];
const KIND_PREFIX = /^(step|foster|adoptive|adopted)[\s-]*/;

/**
 * What the typed words mean, read from the typed text alone (never from people's names):
 * the relationship when only one fits, and a kind when the words name one (stepdad, foster son, wife).
 */
export function readRelation(typed: string): { relation?: Relation; parentKind?: ParentKind; partnershipKind?: PartnershipKind } {
  let t = typed.trim().toLowerCase().replace(/\s+/g, " ");
  const prefix = KIND_PREFIX.exec(t)?.[1];
  const parentKind: ParentKind | undefined = prefix === "step" ? "step" : prefix === "foster" ? "foster" : prefix ? "adoptive" : undefined;
  t = t.replace(KIND_PREFIX, "");
  if (!t) return {};
  const words = t.split(/[\s/,]+/);
  const hits = new Set<Relation>();
  for (const [relation, synonyms] of WORDS) {
    for (const s of synonyms) {
      const said = s.includes(" ") ? t.includes(s) : words.includes(s);
      if (said || (t.length >= 2 && s.startsWith(t))) hits.add(relation);
    }
  }
  if (hits.size !== 1) return {};
  const [relation] = hits;
  const out: ReturnType<typeof readRelation> = { relation };
  if (parentKind && (relation === "parent" || relation === "child")) out.parentKind = parentKind;
  if (relation === "spouse") {
    if (t.includes("de facto")) out.partnershipKind = "de facto";
    else if (["husband", "wife", "married"].some((w) => words.includes(w))) out.partnershipKind = "married";
  }
  return out;
}
