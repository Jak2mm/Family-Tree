import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { card, setup } from "./treeTestKit";

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const touch = (id: number, x: number, y: number) => ({ button: 0, clientX: x, clientY: y, pointerId: id, pointerType: "touch", isPrimary: id === 1 });
const scale = () => Number(/scale\(([\d.]+)\)/.exec(screen.getByTestId("tree-stage").style.transform)![1]);
const offset = () => screen.getByTestId("tree-stage").style.transform.replace(/ scale.*/, "");

describe("touch on the tree", () => {
  it("a swipe that starts on a card moves the tree and does not open the profile or start a drag", async () => {
    setup(["read", "add", "edit"]);
    const ann = await card(/Ann Adams/);
    const before = offset();
    fireEvent.pointerDown(ann, touch(1, 10, 10));
    fireEvent.pointerMove(window, touch(1, 60, 40));
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    fireEvent.pointerUp(window, touch(1, 60, 40));
    fireEvent.click(ann);
    expect(offset()).not.toBe(before);
    expect(window.location.hash).toBe("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a tap on a card still opens the profile", async () => {
    setup(["read", "add", "edit"]);
    const ann = await card(/Ann Adams/);
    fireEvent.pointerDown(ann, touch(1, 10, 10));
    fireEvent.pointerMove(window, touch(1, 12, 11));
    fireEvent.pointerUp(window, touch(1, 12, 11));
    fireEvent.click(ann);
    expect(window.location.hash).toBe("#/person/1");
  });

  it("pinching two fingers apart zooms in, and together zooms out, within the limits", async () => {
    setup(["read"]);
    await card(/Ann Adams/);
    const viewport = screen.getByRole("group", { name: /Family tree/ });
    const start = scale();
    fireEvent.pointerDown(viewport, touch(1, 100, 100));
    fireEvent.pointerDown(viewport, touch(2, 200, 100));
    fireEvent.pointerMove(window, touch(2, 300, 100)); // fingers 100 -> 200 apart
    expect(scale()).toBeCloseTo(Math.min(2, start * 2), 2);
    fireEvent.pointerMove(window, touch(2, 120, 100)); // 200 -> 20 apart
    expect(scale()).toBe(0.3);
    fireEvent.pointerUp(window, touch(2, 120, 100));
    fireEvent.pointerUp(window, touch(1, 100, 100));
  });

  it("a mouse press on a card still starts drag-to-link, not panning", async () => {
    setup(["read", "add"]);
    const ann = await card(/Ann Adams/);
    const before = offset();
    fireEvent.pointerDown(ann, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40, pointerId: 1, pointerType: "mouse" });
    expect(await screen.findByTestId("drag-ghost")).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 60, clientY: 40, pointerId: 1, pointerType: "mouse" });
    expect(offset()).toBe(before);
  });
});

describe("pinchStep", () => {
  it("gives the zoom factor and the midpoints before and after", async () => {
    const { pinchStep } = await import("./usePanZoom");
    expect(pinchStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 200 })).toEqual({ factor: 2, from: { x: 50, y: 0 }, to: { x: 0, y: 100 } });
    expect(pinchStep({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });
});
