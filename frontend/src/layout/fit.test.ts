import { describe, expect, it } from "vitest";
import { fitView } from "./fit";

describe("fitView", () => {
  it("shrinks a tree that is too big so all of it shows, centred", () => {
    const v = fitView(1000, 500, 2000, 500, [100, 50], 0.3)!;
    expect(v.k).toBe(0.5);
    expect(v.x).toBe(0); // 2000 * 0.5 = 1000 fills the width
    expect(v.y).toBe(125); // 500 * 0.5 = 250 tall, centred in 500
  });

  it("never enlarges a small tree beyond its real size, and centres it", () => {
    const v = fitView(1000, 800, 400, 200, [10, 10], 0.3);
    expect(v).toEqual({ k: 1, x: 300, y: 300 });
  });

  it("uses the smaller zoom limit and centres on the oldest person when even that is too big", () => {
    const v = fitView(390, 600, 4000, 600, [1000, 72], 0.3)!;
    expect(v.k).toBe(0.3);
    expect(v.x).toBe(195 - 1000 * 0.3);
    expect(v.y).toBe(300 - 72 * 0.3);
  });

  it("gives nothing when the screen area has no size yet", () => {
    expect(fitView(0, 0, 100, 100, null, 0.3)).toBeNull();
  });

  it("centres the tree when it is too big but nobody is known to anchor on", () => {
    const v = fitView(390, 600, 4000, 600, null, 0.3)!;
    expect(v).toEqual({ k: 0.3, x: (390 - 1200) / 2, y: (600 - 180) / 2 });
  });
});
