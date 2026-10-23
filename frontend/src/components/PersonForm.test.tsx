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
});
