import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderAs, mockFetch, PREFS } from "../test-utils";
import { LinkPopup } from "./LinkPopup";
import { LINKED } from "./treeTestKit";

beforeEach(() => vi.unstubAllGlobals());

const typeBox = (dialog: HTMLElement) => within(dialog).getByRole("textbox", { name: /type the relationship/i });

function open(a = { id: 1, name: "Ann Adams" }, b = { id: 2, name: "Bob Brown" }) {
  const net = mockFetch({ "GET /api/me/preferences": { body: PREFS }, "POST /api/links": LINKED });
  renderAs(["read", "add", "edit"], <LinkPopup a={a} b={b} people={[a, b]} onClose={() => {}} onChanged={() => {}} />);
  return { net, dialog: screen.getByRole("dialog") };
}

describe("LinkPopup", () => {
  it("shows every option as a visible choice, not a hidden list", () => {
    const { dialog } = open();
    for (const text of ["Ann Adams is the parent of Bob Brown", "Ann Adams is the child of Bob Brown", "Ann Adams is the spouse or partner of Bob Brown", "Ann Adams is the sibling of Bob Brown"]) {
      expect(within(dialog).getByRole("radio", { name: text })).toBeInTheDocument();
    }
    expect(dialog.querySelector("datalist")).toBeNull();
  });

  it.each([
    ["husband", "Ann Adams is the spouse or partner of Bob Brown"],
    ["wife", "Ann Adams is the spouse or partner of Bob Brown"],
    ["father", "Ann Adams is the parent of Bob Brown"],
    ["mother", "Ann Adams is the parent of Bob Brown"],
    ["son", "Ann Adams is the child of Bob Brown"],
    ["brother", "Ann Adams is the sibling of Bob Brown"],
  ])("typing %s picks the matching option and lets you confirm", async (word, option) => {
    const user = userEvent.setup();
    const { dialog } = open();
    await user.type(typeBox(dialog), word);
    expect(within(dialog).getByRole("radio", { name: option })).toBeChecked();
    expect(within(dialog).queryByText(/not one we know/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("is not confused by a name that contains a relationship word", async () => {
    const user = userEvent.setup();
    const { dialog } = open({ id: 1, name: "Ann Childers" }, { id: 2, name: "Bob Parenti" });
    await user.type(typeBox(dialog), "child");
    expect(within(dialog).getByRole("radio", { name: "Ann Childers is the child of Bob Parenti" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("sends the chosen kind of parent link", async () => {
    const user = userEvent.setup();
    const { net, dialog } = open();
    await user.click(within(dialog).getByRole("radio", { name: "Ann Adams is the child of Bob Brown" }));
    await user.selectOptions(within(dialog).getByLabelText("Kind"), "adoptive");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await within(dialog).findByText("Linked");
    expect(net.calls.find((c) => c.method === "POST")!.body).toEqual({ a: 1, b: 2, relation: "child", parent_kind: "adoptive" });
  });

  it("picks the kind from words like stepdad, and the partnership kind from wife", async () => {
    const user = userEvent.setup();
    const { dialog } = open();
    await user.type(typeBox(dialog), "stepdad");
    expect(within(dialog).getByLabelText("Kind")).toHaveValue("step");
    await user.clear(typeBox(dialog));
    await user.type(typeBox(dialog), "wife");
    expect(within(dialog).getByLabelText("Kind of partnership")).toHaveValue("married");
    expect(within(dialog).queryByLabelText("Kind")).not.toBeInTheDocument();
  });

  it("only asks for a kind for parent and child links", async () => {
    const user = userEvent.setup();
    const { dialog } = open();
    await user.click(within(dialog).getByRole("radio", { name: "Ann Adams is the sibling of Bob Brown" }));
    expect(within(dialog).queryByLabelText("Kind")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "Ann Adams is the parent of Bob Brown" }));
    expect(within(dialog).getByLabelText("Kind")).toHaveValue("biological");
  });
});
