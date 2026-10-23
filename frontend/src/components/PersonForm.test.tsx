import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonForm } from "./PersonForm";
import { PREFS, mockFetch, renderAs } from "../test-utils";

const saved = { id: 7, name: "Eve Hall", places_lived: [] };

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "#/person/new";
});

describe("PersonForm", () => {
  it("accepts a birth year on its own and opens the new profile", async () => {
    const net = mockFetch({ "GET /api/me/preferences": { body: PREFS }, "POST /api/people": { status: 201, body: saved } });
    renderAs(["read", "add"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Given names"), "Eve");
    await userEvent.type(screen.getByLabelText("Family name"), "Hall");
    await userEvent.type(screen.getByLabelText(/^Birth date/), "1932");
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    await vi.waitFor(() => expect(window.location.hash).toBe("#/person/7"));
    expect(net.calls.find((c) => c.method === "POST")!.body).toMatchObject({ given_names: "Eve", family_name: "Hall", birth_date: "1932", death_date: null });
  });

  it("turns a day-first date into the stored year-first text", async () => {
    const net = mockFetch({ "GET /api/me/preferences": { body: PREFS }, "POST /api/people": { status: 201, body: saved } });
    renderAs(["read", "add"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Given names"), "Eve");
    await userEvent.type(screen.getByLabelText(/^Birth date/), "07-03-1950");
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    await vi.waitFor(() => expect(net.calls.some((c) => c.method === "POST")).toBe(true));
    expect((net.calls.find((c) => c.method === "POST")!.body as { birth_date: string }).birth_date).toBe("1950-03-07");
  });

  it("explains a date that does not exist without calling the server", async () => {
    const net = mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read", "add"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Given names"), "Eve");
    await userEvent.type(screen.getByLabelText(/^Birth date/), "31-02-1950");
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/birth date/i);
    expect(net.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the server's message when it refuses the dates", async () => {
    mockFetch({
      "GET /api/me/preferences": { body: PREFS },
      "POST /api/people": { status: 422, body: { detail: "The death date cannot be earlier than the birth date." } },
    });
    renderAs(["read", "add"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Given names"), "Eve");
    await userEvent.type(screen.getByLabelText(/^Birth date/), "1950");
    await userEvent.type(screen.getByLabelText(/^Death date/), "1940");
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The death date cannot be earlier than the birth date.");
    expect(window.location.hash).toBe("#/person/new");
  });

  it("saves places lived after the person", async () => {
    const net = mockFetch({
      "GET /api/me/preferences": { body: PREFS },
      "POST /api/people": { status: 201, body: saved },
      "POST /api/people/7/places": { status: 201, body: { id: 1 } },
    });
    renderAs(["read", "add", "edit"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Given names"), "Eve");
    await userEvent.type(screen.getByLabelText("Place"), "Geelong");
    await userEvent.type(screen.getByLabelText("From year"), "1960");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    expect(screen.getByText("Geelong from 1960")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    await vi.waitFor(() => expect(window.location.hash).toBe("#/person/7"));
    expect(net.calls.find((c) => c.path === "/api/people/7/places")!.body).toEqual({ place: "Geelong", from_year: 1960, to_year: null });
  });

  it("loads an existing person in the user's date format and saves only through PATCH", async () => {
    const existing = {
      id: 3, given_names: "Mary", family_name: "Smith", birth_date: "1950-03-07", birth_place: null, death_date: null,
      occupation: null, bio: "", places_lived: [{ id: 5, place: "Geelong", from_year: 1960, to_year: null }],
    };
    const net = mockFetch({
      "GET /api/me/preferences": { body: PREFS },
      "GET /api/people/3": { body: existing },
      "PATCH /api/people/3": { body: existing },
      "DELETE /api/people/3/places/5": { status: 204 },
    });
    renderAs(["read", "edit"], <PersonForm id={3} />);
    expect(await screen.findByLabelText(/^Birth date/)).toHaveValue("07-03-1950");
    await userEvent.click(screen.getByRole("button", { name: /remove place geelong/i }));
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    await vi.waitFor(() => expect(window.location.hash).toBe("#/person/3"));
    expect(net.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ given_names: "Mary", birth_date: "1950-03-07" });
    expect(net.count("DELETE /api/people/3/places/5")).toBe(1);
  });

  it("shows no places editor to someone who can add but not edit, and still creates the person", async () => {
    const net = mockFetch({ "GET /api/me/preferences": { body: PREFS }, "POST /api/people": { status: 201, body: saved } });
    renderAs(["read", "add"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Given names"), "Eve");
    expect(screen.queryByLabelText("Place")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add place" })).not.toBeInTheDocument();
    expect(screen.getByText(/places lived can be added after saving, by someone who is allowed to edit/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    await vi.waitFor(() => expect(window.location.hash).toBe("#/person/7"));
    expect(net.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("shows the places editor and no note to someone who can add and edit", async () => {
    mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read", "add", "edit"], <PersonForm />);
    expect(await screen.findByLabelText("Place")).toBeInTheDocument();
    expect(screen.queryByText(/added after saving/i)).not.toBeInTheDocument();
  });

  it("shows a permission message instead of the new-person form to a read-only user", async () => {
    const net = mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read"], <PersonForm />);
    expect(await screen.findByText("You do not have permission to do that.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Given names")).not.toBeInTheDocument();
    expect(net.calls.some((c) => c.path.startsWith("/api/people"))).toBe(false);
  });

  it("shows a permission message instead of the edit form to someone who cannot edit", async () => {
    const net = mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read", "add"], <PersonForm id={3} />);
    expect(await screen.findByText("You do not have permission to do that.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Given names")).not.toBeInTheDocument();
    expect(net.calls.some((c) => c.path === "/api/people/3")).toBe(false);
  });

  it.each([["19x6", "1960"], ["1960", "19x6"], ["12345", "1960"], ["-5", ""]])("rejects the place years %s / %s without adding the place", async (from, to) => {
    mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read", "add", "edit"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Place"), "Geelong");
    await userEvent.type(screen.getByLabelText("From year"), from);
    if (to) await userEvent.type(screen.getByLabelText("To year"), to);
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/year/i);
    expect(screen.queryByText(/Geelong from/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Place")).toHaveValue("Geelong");
  });

  it("rejects a from year after the to year", async () => {
    mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read", "add", "edit"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Place"), "Geelong");
    await userEvent.type(screen.getByLabelText("From year"), "1990");
    await userEvent.type(screen.getByLabelText("To year"), "1980");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/later/i);
    expect(screen.queryByText(/Geelong from/)).not.toBeInTheDocument();
  });

  it("accepts a place with only a to year and clears an earlier year error", async () => {
    mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read", "add", "edit"], <PersonForm />);
    await userEvent.type(await screen.findByLabelText("Place"), "Geelong");
    await userEvent.type(screen.getByLabelText("From year"), "19x6");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    await userEvent.clear(screen.getByLabelText("From year"));
    await userEvent.type(screen.getByLabelText("To year"), "1975");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    expect(screen.getByText("Geelong until 1975")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
