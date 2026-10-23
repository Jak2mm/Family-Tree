import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREFS, deferred, mockFetch, renderAs } from "../test-utils";
import { ProfilePage } from "./ProfilePage";

const profile = {
  id: 1, name: "Mary Smith", given_names: "Mary", family_name: "Smith",
  birth_date: null, birth_place: null, death_date: null, occupation: null, bio: "", profile_photo_id: null,
  places_lived: [], parents: [{ id: 2, name: "John Smith", link_id: "p:2-1", kind: "biological" }], children: [], siblings: [],
  partnerships: [{ id: 5, name: "Bob Jones", link_id: "c:7", kind: "married", start_year: 1972, end_year: null }],
  albums: [],
};
const routes = (extra = {}) => ({ "GET /api/people/1": { body: profile }, "GET /api/me/preferences": { body: PREFS }, ...extra });

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "#/person/1";
});

describe("editing a partnership on the profile", () => {
  it("is offered only to people who may edit, and only for partners", async () => {
    mockFetch(routes());
    const view = renderAs(["read", "add", "delete"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /edit partnership/i })).not.toBeInTheDocument();
    view.unmount();
    renderAs(["read", "edit"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByRole("button", { name: /edit partnership/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Edit partnership with Bob Jones" })).toBeInTheDocument();
  });

  it("saves the kind, start and end year through the partnership link, then reloads", async () => {
    const user = userEvent.setup();
    const net = mockFetch(routes({ "PATCH /api/links/c:7": { body: { id: "c:7", kind: "de facto", start_year: 1970, end_year: 1990 } } }));
    renderAs(["read", "edit"], <ProfilePage id={1} />);
    await user.click(await screen.findByRole("button", { name: "Edit partnership with Bob Jones" }));
    const form = screen.getByRole("form", { name: "Partnership with Bob Jones" });
    expect(within(form).getByLabelText("Kind of partnership")).toHaveValue("married");
    expect(within(form).getByLabelText("Year it started")).toHaveValue("1972");
    await user.selectOptions(within(form).getByLabelText("Kind of partnership"), "de facto");
    await user.clear(within(form).getByLabelText("Year it started"));
    await user.type(within(form).getByLabelText("Year it started"), "1970");
    await user.type(within(form).getByLabelText("Year it ended"), "1990");
    const loads = net.count("GET /api/people/1");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(net.count("GET /api/people/1")).toBeGreaterThan(loads));
    expect(net.calls.find((c) => c.method === "PATCH")!.body).toEqual({ kind: "de facto", start_year: 1970, end_year: 1990 });
    expect(screen.queryByRole("form", { name: "Partnership with Bob Jones" })).not.toBeInTheDocument();
  });

  it("sends an empty year as cleared, and checks the years before sending", async () => {
    const user = userEvent.setup();
    const net = mockFetch(routes({ "PATCH /api/links/c:7": { body: {} } }));
    renderAs(["read", "edit"], <ProfilePage id={1} />);
    await user.click(await screen.findByRole("button", { name: "Edit partnership with Bob Jones" }));
    const form = screen.getByRole("form", { name: "Partnership with Bob Jones" });
    await user.type(within(form).getByLabelText("Year it ended"), "1960");
    expect(within(form).getByText(/cannot be earlier/)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(within(form).getByLabelText("Year it ended"));
    await user.clear(within(form).getByLabelText("Year it started"));
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(net.count("PATCH /api/links/c:7")).toBe(1));
    expect(net.calls.find((c) => c.method === "PATCH")!.body).toEqual({ kind: "married", start_year: null, end_year: null });
  });

  it("shows the server's message and keeps the form open when saving fails, and sends once for a double press", async () => {
    const user = userEvent.setup();
    const hold = deferred<{ status: number; body: unknown }>();
    const net = mockFetch(routes({ "PATCH /api/links/c:7": () => hold.promise }));
    renderAs(["read", "edit"], <ProfilePage id={1} />);
    await user.click(await screen.findByRole("button", { name: "Edit partnership with Bob Jones" }));
    const form = screen.getByRole("form", { name: "Partnership with Bob Jones" });
    const save = within(form).getByRole("button", { name: "Save" });
    await user.click(save);
    await user.click(save);
    hold.resolve({ status: 404, body: { detail: "That relationship could not be found." } });
    expect(await within(form).findByRole("alert")).toHaveTextContent("That relationship could not be found.");
    expect(net.count("PATCH /api/links/c:7")).toBe(1);
  });
});
