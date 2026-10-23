import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CARD_H, cardHeight, layoutTree } from "../layout/layoutTree";
import { edgesFor } from "../layout/edges";
import { sampleFamily } from "../layout/sampleFamily";
import { PersonCard, dateLines } from "./PersonCard";
import { person } from "./treeTestKit";

const ALL = ["name", "photo", "dates", "age", "occupation"];
const arthur = person(1, "Arthur Bennett", { birth_year: 1921, death_year: 1998, birth_date: "1921-03-14", death_date: "1998-07-02", occupation: "Carpenter" });

describe("dates on cards", () => {
  it("puts born and died on separate lines so neither is cut off", () => {
    expect(dateLines(arthur, "DD-MM-YYYY")).toEqual(["Born 14-03-1921", "Died 02-07-1998"]);
  });

  it("uses the short '1921 – 1998' form when only years are known", () => {
    expect(dateLines(person(2, "M", { birth_year: 1924, death_year: 2012, birth_date: "1924", death_date: "2012" }), "DD-MM-YYYY")).toEqual(["1924 – 2012"]);
    expect(dateLines(person(3, "B", { birth_year: 1950, birth_date: "1950-06" }), "DD-MM-YYYY")).toEqual(["Born 06-1950"]);
    expect(dateLines(person(4, "D", { death_year: 1990, death_date: "1990-01-02" }), "YYYY-MM-DD")).toEqual(["Died 1990-01-02"]);
    expect(dateLines(person(5, "N"), "DD-MM-YYYY")).toEqual([]);
  });

  it("shows each line as its own element on the card", () => {
    const { getByText } = render(
      <PersonCard person={arthur} x={0} y={0} height={CARD_H} fields={["name", "dates"]} dateFormat="DD-MM-YYYY" picked={null} focused={false} onActivate={() => {}} onPointerDown={() => {}} />,
    );
    expect(getByText("Born 14-03-1921")).toBeInTheDocument();
    expect(getByText("Died 02-07-1998")).toBeInTheDocument();
  });
});

describe("card height", () => {
  it("stays the usual size for the usual fields and grows when every field is shown", () => {
    expect(cardHeight(["name", "photo", "dates"])).toBe(CARD_H);
    // two lines of name, born, died, age and occupation, at 19 px a line, plus padding and border
    expect(cardHeight(ALL)).toBeGreaterThanOrEqual(6 * 19 + 18);
  });

  it("the card is drawn at the height the layout used", () => {
    const { getByRole } = render(
      <PersonCard person={arthur} x={0} y={0} height={cardHeight(ALL)} fields={ALL} dateFormat="DD-MM-YYYY" picked={null} focused={false} onActivate={() => {}} onPointerDown={() => {}} />,
    );
    expect(getByRole("button").style.height).toBe(`${cardHeight(ALL)}px`);
  });

  it.each([1, 2, 3, 4] as const)("layout %i spaces taller cards apart and the lines still avoid them", (layout) => {
    const data = sampleFamily();
    const h = cardHeight(ALL);
    const { nodes } = layoutTree(data, layout, 10, h);
    for (const a of nodes) for (const b of nodes) if (a.id < b.id) expect(Math.abs(a.x - b.x) >= 200 || Math.abs(a.y - b.y) >= h).toBe(true);
    for (const e of edgesFor(data, nodes, layout, h)) {
      for (let i = 1; i < e.points.length; i++) {
        const [p, q] = [e.points[i - 1], e.points[i]];
        const inside = nodes.filter((n) => Math.max(Math.min(p[0], q[0]), n.x) < Math.min(Math.max(p[0], q[0]), n.x + 200) - 0 && Math.max(Math.min(p[1], q[1]), n.y) < Math.min(Math.max(p[1], q[1]), n.y + h));
        expect(inside.length, JSON.stringify(e.points)).toBe(0);
      }
    }
  });
});
