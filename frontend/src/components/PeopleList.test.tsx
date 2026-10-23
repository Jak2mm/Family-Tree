import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleList } from "./PeopleList";
import { PREFS, mockFetch, renderAs } from "../test-utils";

const people = [
  { id: 1, name: "Ann Adams", birth_date: "1950-03-07", death_date: null, profile_photo_id: null },
  { id: 2, name: "Bob Brown", birth_date: "1948", death_date: "2010-01", profile_photo_id: 4 },
];

beforeEach(() => {
  vi.unstubAllGlobals();
  mockFetch({ "GET /api/people": { body: people }, "GET /api/me/preferences": { body: PREFS } });
});

describe("PeopleList", () => {
  it("lists people in the order given and filters by name as you type", async () => {
    renderAs(["read"], <PeopleList />);
    const links = await screen.findAllByRole("link", { name: /Adams|Brown/ });
    expect(links.map((l) => l.textContent)).toEqual([expect.stringContaining("Ann Adams"), expect.stringContaining("Bob Brown")]);
    expect(links[0]).toHaveAttribute("href", "#/person/1");
    await userEvent.type(screen.getByLabelText("Search by name"), "brow");
    expect(screen.queryByRole("link", { name: /Ann Adams/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bob Brown/ })).toBeInTheDocument();
  });

  it("says so when nobody matches", async () => {
    renderAs(["read"], <PeopleList />);
    await screen.findByText(/Ann Adams/);
    await userEvent.type(screen.getByLabelText("Search by name"), "zzz");
    expect(screen.getByText("No one matches that search.")).toBeInTheDocument();
  });

  it("shows Add person only to people who may add", async () => {
    const { unmount } = renderAs(["read"], <PeopleList />);
    await screen.findByText(/Ann Adams/);
    expect(screen.queryByRole("link", { name: "Add person" })).not.toBeInTheDocument();
    unmount();
    renderAs(["read", "add"], <PeopleList />);
    expect(await screen.findByRole("link", { name: "Add person" })).toHaveAttribute("href", "#/person/new");
  });
});
