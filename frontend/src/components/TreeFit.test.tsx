import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { card, setup } from "./treeTestKit";

const size = (name: "clientWidth" | "clientHeight", value: number) =>
  vi.spyOn(HTMLElement.prototype, name, "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("tree-viewport") ? value : 0;
  });

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
  size("clientWidth", 2000);
  size("clientHeight", 1000);
});
afterEach(() => vi.restoreAllMocks());

describe("fitting the tree to the screen", () => {
  it("opens with the whole tree centred, not in a corner", async () => {
    setup(["read"]);
    await card(/Ann Adams/);
    // The test tree is 608 x 280 pixels in a 2000 x 1000 area: real size, centred.
    await waitFor(() => expect(screen.getByTestId("tree-stage").style.transform).toBe("translate(696px, 360px) scale(1)"));
  });

  it("has a Fit button that brings the tree back after moving around", async () => {
    const user = userEvent.setup();
    setup(["read"]);
    await card(/Ann Adams/);
    const stage = screen.getByTestId("tree-stage");
    const fitted = "translate(696px, 360px) scale(1)";
    await waitFor(() => expect(stage.style.transform).toBe(fitted));
    const viewport = screen.getByRole("group", { name: /Family tree/ });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 300, pointerId: 1 });
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(stage.style.transform).not.toBe(fitted);
    await user.click(screen.getByRole("button", { name: "Fit tree to screen" }));
    expect(stage.style.transform).toBe(fitted);
  });

  it("fits again when the layout changes", async () => {
    const user = userEvent.setup();
    setup(["read"]);
    await card(/Ann Adams/);
    const stage = screen.getByTestId("tree-stage");
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = stage.style.transform;
    await user.selectOptions(screen.getByLabelText("Layout"), "2");
    expect(stage.style.transform).not.toBe(zoomed);
    expect(stage.style.transform).toContain("scale(1)");
  });
});
