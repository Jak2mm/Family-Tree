import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { within } from "@testing-library/react";
import { PREFS, mockFetch, renderAs, type Handler } from "../test-utils";
import { TreeView } from "./TreeView";

export const THIS_YEAR = new Date().getFullYear();
export const person = (id: number, name: string, extra = {}) => ({
  id, name, birth_year: null, death_year: null, generation: 0, photo_id: null, occupation: null, birth_date: null, death_date: null, ...extra,
});
export const TREE = {
  people: [
    person(1, "Ann Adams", { birth_year: 1950, birth_date: "1950-03-07", photo_id: 9, occupation: "Teacher" }),
    person(2, "Bob Brown", { birth_year: 1940, death_year: 2020, birth_date: "1940", death_date: "2020-01-02" }),
    person(3, "Cy Adams", { birth_year: 1975, generation: 1 }),
  ],
  parent_links: [[1, 3]],
  partnerships: [],
};
export const LINKED = { status: 201, body: { ids: ["p:1-2"] } };

export function setup(perms: string[] = ["read", "add", "edit"], routes: Record<string, Handler> = {}) {
  const net = mockFetch({
    "GET /api/tree": { body: TREE },
    "GET /api/me/preferences": { body: PREFS },
    "PUT /api/me/preferences": { body: PREFS },
    ...routes,
  });
  renderAs(perms, <TreeView />);
  return net;
}
export const card = (name: RegExp | string) => screen.findByRole("button", { name });
export const startLinking = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Link people" }));
};
export async function openPopup(user: ReturnType<typeof userEvent.setup>) {
  await startLinking(user);
  await user.click(await card(/Ann Adams/));
  await user.click(await card(/Bob Brown/));
  return screen.findByRole("dialog");
}
/** Pick an option by its full text, or type a word into the box above the options. */
export const choose = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, text: string) => {
  const option = within(dialog).queryByRole("radio", { name: text });
  if (option) await user.click(option);
  else await user.type(within(dialog).getByRole("textbox", { name: /type the relationship/i }), text);
};
export const posts = (net: ReturnType<typeof mockFetch>) => net.calls.filter((c) => c.method === "POST");
