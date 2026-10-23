import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PREFS, meWith, mockFetch } from "./test-utils";

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const signedOut = { status: 401, body: { detail: "Please sign in." } };

describe("App", () => {
  it("shows the first-run setup screen when no account exists yet", async () => {
    mockFetch({ "GET /api/me": signedOut, "GET /api/setup/status": { body: { needed: true } } });
    render(<App />);
    expect(await screen.findByRole("heading", { name: /create the first account/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("creates the first administrator and signs them in", async () => {
    const net = mockFetch({
      "GET /api/me": signedOut,
      "GET /api/setup/status": { body: { needed: true } },
      "POST /api/setup": { status: 201, body: { id: 1, username: "owner" } },
      "POST /api/login": { body: meWith(["read", "add", "edit", "delete", "admin"]) },
      "GET /api/me/preferences": { body: PREFS },
      "GET /api/people": { body: [] },
    });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Username"), "owner");
    await userEvent.type(screen.getByLabelText("Password"), "a long password");
    await userEvent.type(screen.getByLabelText("Confirm password"), "a long password");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(net.calls.find((c) => c.path === "/api/setup")!.body).toEqual({ username: "owner", password: "a long password" });
  });

  it("does not create an account when the two passwords differ", async () => {
    const net = mockFetch({ "GET /api/me": signedOut, "GET /api/setup/status": { body: { needed: true } } });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Username"), "owner");
    await userEvent.type(screen.getByLabelText("Password"), "a long password");
    await userEvent.type(screen.getByLabelText("Confirm password"), "another one");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    expect(net.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the sign-in form when accounts already exist", async () => {
    mockFetch({ "GET /api/me": signedOut, "GET /api/setup/status": { body: { needed: false } } });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows navigation for a signed-in admin, including Admin and Family tree", async () => {
    mockFetch({
      "GET /api/me": { body: meWith(["read", "admin"]) },
      "GET /api/me/preferences": { body: PREFS },
      "GET /api/people": { body: [] },
    });
    render(<App />);
    expect(await screen.findByRole("link", { name: "Family tree" })).toHaveAttribute("href", "#/tree");
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "#/admin");
  });

  it("hides the Admin link from other users and signs out through the menu", async () => {
    const net = mockFetch({
      "GET /api/me": { body: meWith(["read"]) },
      "GET /api/me/preferences": { body: PREFS },
      "GET /api/people": { body: [] },
      "POST /api/logout": { body: { ok: true } },
      "GET /api/setup/status": { body: { needed: false } },
    });
    render(<App />);
    await screen.findByRole("link", { name: "Family tree" });
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sam/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(net.count("POST /api/logout")).toBe(1);
  });

  it("returns to the sign-in screen when the session ends part way through", async () => {
    mockFetch({
      "GET /api/me": { body: meWith(["read"]) },
      "GET /api/me/preferences": { body: PREFS },
      "GET /api/people": signedOut,
      "GET /api/setup/status": { body: { needed: false } },
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Family tree" })).not.toBeInTheDocument();
  });

  it("skip link keeps the current page and moves focus to the main content", async () => {
    window.location.hash = "#/people";
    mockFetch({
      "GET /api/me": { body: meWith(["read"]) },
      "GET /api/me/preferences": { body: PREFS },
      "GET /api/people": { body: [] },
    });
    render(<App />);
    await screen.findByRole("heading", { name: "People" });
    await userEvent.click(screen.getByRole("button", { name: "Skip to content" }));
    expect(window.location.hash).toBe("#/people");
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.queryByText("Page not found")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });
});
