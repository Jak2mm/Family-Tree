import { describe, expect, it } from "vitest";
import { readRelation } from "./linkWords";

describe("readRelation", () => {
  it.each([
    ["father", "parent"], ["Mother", "parent"], ["mum", "parent"], ["dad", "parent"], ["parent", "parent"],
    ["son", "child"], ["daughter", "child"], ["child", "child"], ["kid", "child"],
    ["husband", "spouse"], ["wife", "spouse"], ["partner", "spouse"], ["spouse", "spouse"], ["de facto", "spouse"], ["married", "spouse"],
    ["brother", "sibling"], ["sister", "sibling"], ["sibling", "sibling"],
    ["is the father of", "parent"], ["  Wife ", "spouse"], ["daugh", "child"], ["bro", "sibling"],
  ])("reads %s as %s", (typed, relation) => {
    expect(readRelation(typed).relation).toBe(relation);
  });

  it("gives nothing for unknown or ambiguous text", () => {
    expect(readRelation("banana").relation).toBeUndefined();
    expect(readRelation("").relation).toBeUndefined();
    expect(readRelation("s").relation).toBeUndefined(); // son, sister, spouse...
  });

  it("reads the kind of a parent link or partnership from the words", () => {
    expect(readRelation("stepfather")).toEqual({ relation: "parent", parentKind: "step" });
    expect(readRelation("adoptive mum")).toEqual({ relation: "parent", parentKind: "adoptive" });
    expect(readRelation("foster son")).toEqual({ relation: "child", parentKind: "foster" });
    expect(readRelation("wife").partnershipKind).toBe("married");
    expect(readRelation("de facto").partnershipKind).toBe("de facto");
    expect(readRelation("partner").partnershipKind).toBeUndefined();
  });
});
