import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREFS } from "../test-utils";
import { THIS_YEAR, card, setup } from "./treeTestKit";

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("TreeView cards, layout and display menu", () => {
  it("shows photo, name, dates in the user's format, age and occupation according to the toggles", async () => {
    const user = userEvent.setup();
    const net = setup(["read"], { "PUT /api/me/preferences": { body: { ...PREFS, card_fields: ["name", "photo", "dates", "age", "occupation"] } } });
    const ann = await card(/Ann Adams/);
    expect(ann.querySelector("img")).toHaveAttribute("src", "/api/photos/9/thumb");
    expect(ann).toHaveTextContent("07-03-1950");
    expect(ann).not.toHaveTextContent("Teacher");
    await user.click(screen.getByRole("button", { name: "Show on cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Age" }));
    await user.click(screen.getByRole("checkbox", { name: "Occupation" }));
    expect(ann).toHaveTextContent(`age ${THIS_YEAR - 1950}`);
    expect(ann).toHaveTextContent("Teacher");
    expect(await card(/Bob Brown/)).toHaveTextContent("died aged 80");
    expect(await card(/Cy Adams/)).not.toHaveTextContent("age 0");
    expect(net.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ card_fields: ["name", "photo", "dates", "age", "occupation"] });
  });

  it("hides the photo when its toggle is off and saves the choice", async () => {
    const user = userEvent.setup();
    const net = setup(["read"]);
    const ann = await card(/Ann Adams/);
    expect(ann.querySelector("img")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Show on cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Photo" }));
    expect(ann.querySelector("img")).toBeNull();
    expect(ann.querySelector(".card-photo")).toBeNull();
    expect(net.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ card_fields: ["name", "dates"] });
  });

  it("keeps the name available to screen readers when the name toggle is off", async () => {
    const user = userEvent.setup();
    setup(["read"]);
    await card(/Ann Adams/);
    await user.click(screen.getByRole("button", { name: "Show on cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Name" }));
    const ann = await card(/Ann Adams/);
    expect(ann.querySelector(".sr-only")).toHaveTextContent("Ann Adams");
  });

  it("restores the saved layout and card fields", async () => {
    setup(["read"], { "GET /api/me/preferences": { body: { ...PREFS, layout: 3, card_fields: ["name"] } } });
    expect(await screen.findByLabelText("Layout")).toHaveValue("3");
    const ann = await card(/Ann Adams/);
    await waitFor(() => expect(ann.querySelector("img")).toBeNull());
  });

  it("saves the layout when another is chosen and redraws the cards", async () => {
    const user = userEvent.setup();
    const net = setup(["read"]);
    const select = await screen.findByLabelText("Layout");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "By generation, top to bottom", "By generation, side to side", "By birth year, top to bottom", "By birth year, side to side",
    ]);
    const before = (await card(/Cy Adams/)).style.top;
    await user.selectOptions(select, "By generation, side to side");
    expect(net.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ layout: 2 });
    expect((await card(/Cy Adams/)).style.top).not.toBe(before);
  });

  it("rolls the layout back and says so when saving fails", async () => {
    const user = userEvent.setup();
    setup(["read"], { "PUT /api/me/preferences": { status: 500, body: { detail: "Could not save." } } });
    const select = await screen.findByLabelText("Layout");
    await user.selectOptions(select, "2");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save.");
    expect(select).toHaveValue("1");
  });

  it("highlights the person chosen in 'Focus on'", async () => {
    const user = userEvent.setup();
    setup(["read"]);
    await card(/Bob Brown/);
    await user.selectOptions(screen.getByLabelText("Focus on"), "Bob Brown");
    expect(await card(/Bob Brown/)).toHaveAttribute("data-focused", "true");
    expect(await card(/Ann Adams/)).not.toHaveAttribute("data-focused");
  });

  it("zooms with the buttons and keeps within 0.3 to 2", async () => {
    const user = userEvent.setup();
    setup(["read"]);
    await card(/Ann Adams/);
    const zoom = () => screen.getByTestId("tree-stage").style.transform;
    for (let i = 0; i < 30; i++) await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toContain("scale(2)");
    for (let i = 0; i < 60; i++) await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoom()).toContain("scale(0.3)");
  });

  it("pans when the background is dragged and with the arrow keys", async () => {
    const user = userEvent.setup();
    setup(["read"]);
    await card(/Ann Adams/);
    const viewport = screen.getByRole("group", { name: /Family tree/ });
    const stage = screen.getByTestId("tree-stage");
    const start = stage.style.transform;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 130, pointerId: 1 });
    const panned = stage.style.transform;
    expect(panned).not.toBe(start);
    viewport.focus();
    await user.keyboard("{ArrowRight}");
    expect(stage.style.transform).not.toBe(panned);
  });

  it("says plainly when the tree cannot be loaded", async () => {
    setup(["read"], { "GET /api/tree": { status: 500, body: { detail: "The tree is unavailable." } } });
    expect(await screen.findByRole("alert")).toHaveTextContent("The tree is unavailable.");
  });
});
