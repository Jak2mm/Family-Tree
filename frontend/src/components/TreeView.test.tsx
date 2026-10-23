import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../test-utils";
import { LINKED, choose, card, openPopup, posts, setup, startLinking } from "./treeTestKit";

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("TreeView link popup", () => {
  it("opens 'How is A related to B?' after tapping one card then another in link mode", async () => {
    const user = userEvent.setup();
    setup();
    await startLinking(user);
    await user.click(await card(/Ann Adams/));
    expect(await card(/Ann Adams/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(await card(/Bob Brown/));
    expect(await screen.findByRole("heading", { name: "How is Ann Adams related to Bob Brown?" })).toBeInTheDocument();
    expect(window.location.hash).toBe(""); // link mode never opens a profile
  });

  it("saves only after Confirm, with the chosen relation", async () => {
    const user = userEvent.setup();
    const net = setup(["read", "add", "edit"], { "POST /api/links": LINKED });
    const dialog = await openPopup(user);
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    await choose(user, dialog, "Ann Adams is the parent of Bob Brown");
    expect(posts(net)).toHaveLength(0);
    await user.click(confirm);
    expect(await within(dialog).findByText("Linked")).toBeInTheDocument();
    expect(posts(net)).toEqual([{ method: "POST", path: "/api/links", body: { a: 1, b: 2, relation: "parent", parent_kind: "biological" } }]);
  });

  it("matches a short typed word to its only option and explains text that matches nothing", async () => {
    const user = userEvent.setup();
    const net = setup(["read", "add", "edit"], { "POST /api/links": LINKED });
    const dialog = await openPopup(user);
    await choose(user, dialog, "banana");
    expect(within(dialog).getByText(/not one we know/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.clear(within(dialog).getByRole("textbox", { name: /type the relationship/i }));
    await choose(user, dialog, "sibling");
    expect(within(dialog).queryByText(/not one we know/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await within(dialog).findByText("Linked");
    expect(posts(net)[0].body).toEqual({ a: 1, b: 2, relation: "sibling" });
  });

  it("asks for the kind and start year of a partnership and validates the year", async () => {
    const user = userEvent.setup();
    const net = setup(["read", "add", "edit"], { "POST /api/links": LINKED });
    const dialog = await openPopup(user);
    await choose(user, dialog, "Ann Adams is the spouse or partner of Bob Brown");
    await user.selectOptions(within(dialog).getByLabelText("Kind of partnership"), "de facto");
    await user.type(within(dialog).getByLabelText("Year it started (optional)"), "19x");
    expect(within(dialog).getByText(/1 to 4 digits/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("Year it started (optional)"));
    await user.type(within(dialog).getByLabelText("Year it started (optional)"), "1972");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await within(dialog).findByText("Linked");
    expect(posts(net)[0].body).toEqual({ a: 1, b: 2, relation: "spouse", partnership_kind: "de facto", start_year: 1972 });
  });

  it("disables Confirm while the request is in flight, so it cannot be sent twice", async () => {
    const user = userEvent.setup();
    const hold = deferred();
    const net = setup(["read", "add", "edit"], {
      "POST /api/links": async () => {
        await hold.promise;
        return LINKED;
      },
    });
    const dialog = await openPopup(user);
    await choose(user, dialog, "Ann Adams is the child of Bob Brown");
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    fireEvent.click(confirm);
    hold.resolve();
    await within(dialog).findByText("Linked");
    expect(posts(net)).toHaveLength(1);
  });

  it("opens the same popup when one card is dropped on another, outside link mode", async () => {
    setup();
    const a = await card(/Ann Adams/), b = await card(/Bob Brown/);
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40, pointerId: 1 });
    expect(await screen.findByTestId("drag-ghost")).toHaveTextContent("Ann Adams");
    fireEvent.pointerUp(b, { clientX: 60, clientY: 40, pointerId: 1 });
    expect(await screen.findByRole("heading", { name: "How is Ann Adams related to Bob Brown?" })).toBeInTheDocument();
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("does nothing when a card is dropped on empty space", async () => {
    setup();
    const a = await card(/Ann Adams/);
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(document.body, { clientX: 90, clientY: 90, pointerId: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("treats a drag of only a pixel or two as a click that opens the profile", async () => {
    setup();
    const a = await card(/Ann Adams/);
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerUp(a, { clientX: 12, clientY: 11, pointerId: 1 });
    fireEvent.click(a);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#/person/1");
  });

  it("does not start a drag from a touch while in link mode", async () => {
    const user = userEvent.setup();
    setup();
    await startLinking(user);
    const a = await card(/Ann Adams/), b = await card(/Bob Brown/);
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 90, pointerId: 1 });
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    fireEvent.pointerUp(b, { clientX: 90, clientY: 90, pointerId: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server's warning and links anyway with force", async () => {
    const user = userEvent.setup();
    const net = setup(["read", "add", "edit"], {
      "POST /api/links": { status: 409, body: { detail: "Bob Brown was born less than 12 years after Ann Adams. Link them anyway?", warning: true } },
      "POST /api/links?force=1": LINKED,
    });
    const dialog = await openPopup(user);
    await choose(user, dialog, "Ann Adams is the parent of Bob Brown");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByText(/born less than 12 years after Ann Adams/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Link anyway" }));
    expect(await within(dialog).findByText("Linked")).toBeInTheDocument();
    expect(posts(net).map((c) => c.path)).toEqual(["/api/links", "/api/links?force=1"]);
    expect(posts(net)[1].body).toEqual({ a: 1, b: 2, relation: "parent", parent_kind: "biological" });
  });

  it("asks who the parent is when siblings have none, then resends with parent_id", async () => {
    const user = userEvent.setup();
    const net = setup(["read", "add", "edit"], {
      "POST /api/links": (req) =>
        (req.body as { parent_id?: number }).parent_id
          ? { status: 201, body: { ids: ["p:3-1", "p:3-2"] } }
          : { status: 409, body: { detail: "Neither person has a parent yet. Pick or add a parent first.", needs_parent: true } },
    });
    const dialog = await openPopup(user);
    await choose(user, dialog, "Ann Adams is the sibling of Bob Brown");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByText("Who is their parent?")).toBeInTheDocument();
    const select = within(dialog).getByLabelText("Parent");
    expect(within(select).queryByRole("option", { name: "Ann Adams" })).not.toBeInTheDocument(); // not one of the two siblings
    await user.type(within(dialog).getByLabelText("Search people"), "cy");
    await user.selectOptions(select, "Cy Adams");
    await user.click(within(dialog).getByRole("button", { name: "Confirm parent" }));
    expect(await within(dialog).findByText("Linked")).toBeInTheDocument();
    expect(posts(net)[1].body).toEqual({ a: 1, b: 2, relation: "sibling", parent_id: 3 });
  });

  it("undoes every link that was created, then refreshes the tree", async () => {
    const user = userEvent.setup();
    const net = setup(["read", "add", "edit"], {
      "POST /api/links": { status: 201, body: { ids: ["p:3-1", "p:3-2"] } },
      "DELETE /api/links/p:3-1": { status: 204 },
      "DELETE /api/links/p:3-2": { status: 204 },
    });
    const dialog = await openPopup(user);
    await choose(user, dialog, "Ann Adams is the sibling of Bob Brown");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await within(dialog).findByText("Linked");
    const loads = net.count("GET /api/tree");
    await user.click(within(dialog).getByRole("button", { name: "Undo" }));
    expect(await within(dialog).findByText("Link undone")).toBeInTheDocument();
    expect(net.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/api/links/p:3-1", "/api/links/p:3-2"]);
    expect(net.count("GET /api/tree")).toBeGreaterThan(loads);
  });

  it("hides Undo from people who may add but not edit", async () => {
    const user = userEvent.setup();
    setup(["read", "add"], { "POST /api/links": LINKED });
    const dialog = await openPopup(user);
    await choose(user, dialog, "Ann Adams is the parent of Bob Brown");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await within(dialog).findByText("Linked");
    expect(within(dialog).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("shows other errors plainly in an alert", async () => {
    const user = userEvent.setup();
    setup(["read", "add"], { "POST /api/links": { status: 422, body: { detail: "A person cannot be linked to themselves." } } });
    const dialog = await openPopup(user);
    await choose(user, dialog, "Ann Adams is the parent of Bob Brown");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A person cannot be linked to themselves.");
  });

  it("clears the selection when the popup is cancelled, and when link mode ends or Escape is pressed", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openPopup(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await card(/Ann Adams/)).toHaveAttribute("aria-pressed", "false");
    await user.click(await card(/Ann Adams/));
    expect(await card(/Ann Adams/)).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    expect(await card(/Ann Adams/)).toHaveAttribute("aria-pressed", "false");
    await user.click(await card(/Ann Adams/));
    await user.click(screen.getByRole("button", { name: "Link people" }));
    expect(await card(/Ann Adams/)).not.toHaveAttribute("aria-pressed");
  });

  it("offers no linking at all without the add permission", async () => {
    const user = userEvent.setup();
    setup(["read"]);
    const a = await card(/Ann Adams/), b = await card(/Bob Brown/);
    expect(screen.queryByRole("button", { name: "Link people" })).not.toBeInTheDocument();
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40, pointerId: 1 });
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    fireEvent.pointerUp(b, { clientX: 60, clientY: 40, pointerId: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(b);
    expect(window.location.hash).toBe("#/person/2");
  });
});
