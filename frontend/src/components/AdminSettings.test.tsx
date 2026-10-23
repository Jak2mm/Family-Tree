import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AdminSettings } from "./AdminSettings";
import { PREFS, deferred, meWith, mockFetch, renderAs } from "../test-utils";
import { ADMIN, BOB, CHECK, SETTINGS, STATUS_OK, routes } from "./adminTestKit";
import { when } from "./adminFormat";

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "#/settings";
});

describe("Settings link and route", () => {
  it("never shows the Settings link to a non-admin, and the route says not allowed", async () => {
    mockFetch({ "GET /api/me": { body: meWith(["read", "edit"]) }, "GET /api/me/preferences": { body: PREFS }, "GET /api/people": { body: [] } });
    render(<App />);
    expect(await screen.findByText(/not allowed/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("does not ask the server for admin data when a non-admin opens the page", () => {
    const net = mockFetch({ "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read"], <AdminSettings />);
    expect(screen.getByText(/not allowed/i)).toBeInTheDocument();
    expect(net.calls.some((c) => c.path.startsWith("/api/users"))).toBe(false);
  });
});

describe("Users", () => {
  it("creates a user with the chosen permissions and never keeps the password", async () => {
    const created = { ...BOB, id: 3, username: "carol", can_edit: true };
    const net = mockFetch(routes({ "POST /api/users": { status: 201, body: created } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await screen.findByText("bob");
    const form = screen.getByRole("form", { name: "New user" });
    await userEvent.type(within(form).getByLabelText("Username"), "carol");
    const password = within(form).getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(password, "a long secret");
    await userEvent.click(within(form).getByLabelText("Edit"));
    await userEvent.click(within(form).getByRole("button", { name: "Create user" }));
    await vi.waitFor(() => expect(net.count("POST /api/users")).toBe(1));
    expect(net.calls.find((c) => c.method === "POST")!.body).toEqual({
      username: "carol", password: "a long secret", can_read: true, can_add: false, can_edit: true, can_delete: false,
    });
    await vi.waitFor(() => expect(within(form).getByLabelText("Password")).toHaveValue(""));
    expect(document.body.textContent).not.toContain("a long secret");
  });

  it("changes a permission with one request", async () => {
    const net = mockFetch(routes({ "PATCH /api/users/2": { body: { ...BOB, can_add: true } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await userEvent.click(await screen.findByLabelText("Add (bob)"));
    await vi.waitFor(() => expect(net.count("PATCH /api/users/2")).toBe(1));
    expect(net.calls.find((c) => c.method === "PATCH")!.body).toEqual({ can_add: true });
  });

  it("shows administrators as such, and offers no way to disable your own account", async () => {
    mockFetch(routes());
    renderAs(["read", "admin"], <AdminSettings />);
    const me = (await screen.findByText("sam")).closest("li")!;
    expect(within(me).getByLabelText("Administrator (sam)")).toBeDisabled();
    expect(within(me).getByLabelText("Administrator (sam)")).toBeChecked();
    expect(within(me).queryByRole("button", { name: /disable/i })).not.toBeInTheDocument();
  });

  it("shows every permission ticked and locked for an administrator", async () => {
    const net = mockFetch(routes({ "GET /api/users": { body: [{ ...ADMIN, can_read: false, can_delete: false }, BOB] } }));
    renderAs(["read", "admin"], <AdminSettings />);
    const me = (await screen.findByText("sam")).closest("li")!;
    for (const label of ["Read", "Add", "Edit", "Delete"]) {
      const box = within(me).getByLabelText(`${label} (sam)`);
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    fireEvent.click(within(me).getByLabelText("Read (sam)"));
    expect(net.calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(screen.getByLabelText("Read (bob)")).toBeEnabled();
  });

  it("disables a user after asking, and enables a disabled user straight away", async () => {
    const net = mockFetch(routes({
      "PATCH /api/users/2": (req) => ({ body: { ...BOB, ...(req.body as object) } }),
      "GET /api/users": { body: [ADMIN, BOB, { ...BOB, id: 4, username: "dee", active: false }] },
    }));
    renderAs(["read", "admin"], <AdminSettings />);
    const row = (await screen.findByText("bob")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Disable bob" }));
    expect(net.count("PATCH /api/users/2")).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Disable account" }));
    await vi.waitFor(() => expect(net.count("PATCH /api/users/2")).toBe(1));
    expect(net.calls.find((c) => c.method === "PATCH")!.body).toEqual({ active: false });
    const dee = (await screen.findByText("dee")).closest("li")!;
    expect(dee).toHaveTextContent("Disabled");
    expect(net.count("PATCH /api/users/4")).toBe(0);
  });

  it("resets a password and clears the box", async () => {
    const net = mockFetch(routes({ "PATCH /api/users/2": { body: BOB } }));
    renderAs(["read", "admin"], <AdminSettings />);
    const row = (await screen.findByText("bob")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Reset password for bob" }));
    const box = within(row).getByLabelText("New password for bob");
    expect(box).toHaveAttribute("type", "password");
    expect(box).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(box, "brand new pass");
    await userEvent.click(within(row).getByRole("button", { name: "Save new password" }));
    await vi.waitFor(() => expect(net.count("PATCH /api/users/2")).toBe(1));
    expect(net.calls.find((c) => c.method === "PATCH")!.body).toEqual({ password: "brand new pass" });
    expect(document.body.textContent).not.toContain("brand new pass");
    expect(screen.queryByLabelText("New password for bob")).not.toBeInTheDocument();
  });
});

describe("Backups", () => {
  it("saves two backup times with PUT /api/settings/backup", async () => {
    const net = mockFetch(routes({ "PUT /api/settings/backup": { body: { ...SETTINGS, times: ["02:00", "14:00"] } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await screen.findByDisplayValue("02:00");
    await userEvent.click(screen.getByRole("button", { name: "Add another time" }));
    const inputs = screen.getAllByLabelText(/^Backup time/);
    fireEvent.change(inputs[1], { target: { value: "14:00" } });
    await userEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    await vi.waitFor(() => expect(net.count("PUT /api/settings/backup")).toBe(1));
    expect(net.calls.find((c) => c.method === "PUT")!.body).toEqual({ times: ["02:00", "14:00"], days: null, retention: 14, session_timeout_hours: 8 });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("sends chosen days of the week, retention and session hours", async () => {
    const net = mockFetch(routes({ "PUT /api/settings/backup": { body: SETTINGS } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await screen.findByDisplayValue("02:00");
    await userEvent.click(screen.getByLabelText("Monday"));
    await userEvent.click(screen.getByLabelText("Thursday"));
    fireEvent.change(screen.getByLabelText("Backups to keep"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Sign-in timeout (hours)"), { target: { value: "24" } });
    await userEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    await vi.waitFor(() => expect(net.count("PUT /api/settings/backup")).toBe(1));
    expect(net.calls.find((c) => c.method === "PUT")!.body).toEqual({ times: ["02:00"], days: [0, 3], retention: 30, session_timeout_hours: 24 });
  });

  it("shows the backups folder in use", async () => {
    mockFetch(routes());
    renderAs(["read", "admin"], <AdminSettings />);
    expect(await screen.findByText("/backups")).toBeInTheDocument();
  });

  it("shows a plain message and no 'Saved' when the server refuses the settings", async () => {
    mockFetch(routes({ "PUT /api/settings/backup": { status: 422, body: { detail: "Please enter a whole number for how many backups to keep between 1 and 365." } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await screen.findByDisplayValue("02:00");
    await userEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a whole number for how many backups to keep");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("sends only one save when the button is pressed twice while it runs", async () => {
    const gate = deferred();
    const net = mockFetch(routes({ "PUT /api/settings/backup": async () => (await gate.promise, { body: SETTINGS }) }));
    renderAs(["read", "admin"], <AdminSettings />);
    await screen.findByDisplayValue("02:00");
    const save = screen.getByRole("button", { name: "Save backup settings" });
    await userEvent.dblClick(save);
    gate.resolve();
    await screen.findByText("Saved.");
    expect(net.count("PUT /api/settings/backup")).toBe(1);
  });

  it("shows the last backup time, size and result", async () => {
    mockFetch(routes());
    renderAs(["read", "admin"], <AdminSettings />);
    const status = await screen.findByTestId("backup-status");
    expect(status).toHaveTextContent(when(STATUS_OK.last_run, "DD-MM-YYYY"));
    expect(status).toHaveTextContent("2 KB");
    expect(status).toHaveTextContent("Succeeded");
  });

  it("says NAS offline and shows the last error", async () => {
    mockFetch(routes({
      "GET /api/backup/status": {
        body: { ...STATUS_OK, ok: false, nas_available: false, error: "The backups folder could not be written to.", warning: "The last backup failed." },
      },
    }));
    renderAs(["read", "admin"], <AdminSettings />);
    expect(await screen.findByText(/NAS offline/)).toBeInTheDocument();
    expect(screen.getByText(/The backups folder could not be written to\./)).toBeInTheDocument();
  });

  it("Back up now shows the result, and only runs once for a double press", async () => {
    const gate = deferred();
    const net = mockFetch(routes({
      "POST /api/backup/run": async () => (await gate.promise, { body: { ok: true, path: "/backups/family-1.db", size: 4096, error: null } }),
    }));
    renderAs(["read", "admin"], <AdminSettings />);
    await userEvent.dblClick(await screen.findByRole("button", { name: "Back up now" }));
    gate.resolve();
    expect(await screen.findByText(/Backup finished/)).toHaveTextContent("4 KB");
    expect(net.count("POST /api/backup/run")).toBe(1);
  });

  it("Back up now shows a failure in plain words", async () => {
    mockFetch(routes({ "POST /api/backup/run": { body: { ok: false, path: null, size: null, error: "The backups folder is not available." } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(await screen.findByText(/Backup failed/)).toHaveTextContent("The backups folder is not available.");
  });
});

describe("Updates", () => {
  it("lists dependency warnings", async () => {
    const vuln = { package: "pillow", version: "10.0.0", id: "CVE-2026-1", fix_versions: ["10.1.0"], description: "Bad image bug." };
    mockFetch(routes({ "GET /api/settings/dependency-check": { body: { ...CHECK, vulnerabilities: [vuln], message: "1 known vulnerabilities found." } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    const item = (await screen.findByText(/pillow/)).closest("li")!;
    expect(item).toHaveTextContent("CVE-2026-1");
    expect(item).toHaveTextContent("10.1.0");
  });

  it("says could not check for updates when the check failed", async () => {
    mockFetch(routes({ "GET /api/settings/dependency-check": { body: { ...CHECK, check_failed: true, message: "The security check could not run." } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    expect(await screen.findByText("Could not check for updates")).toBeInTheDocument();
  });

  it("Check now posts and shows the new result", async () => {
    const net = mockFetch(routes({
      "POST /api/settings/dependency-check": { body: { ...CHECK, message: "Everything is fine today." } },
    }));
    renderAs(["read", "admin"], <AdminSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Everything is fine today.")).toBeInTheDocument();
    expect(net.count("POST /api/settings/dependency-check")).toBe(1);
  });
});

describe("Recent activity", () => {
  it("shows who did what to which record and when", async () => {
    mockFetch(routes({
      "GET /api/audit?limit=50": {
        body: [
          { id: 2, user_id: 2, username: "bob", action: "update", record_type: "person", record_id: 5, created_at: "2026-10-20T12:30:00Z" },
          { id: 1, user_id: null, username: null, action: "delete", record_type: "photo", record_id: 9, created_at: "2026-10-19T12:30:00Z" },
        ],
      },
    }));
    renderAs(["read", "admin"], <AdminSettings />);
    const first = (await screen.findByText(/bob changed/)).closest("li")!;
    expect(first).toHaveTextContent("person 5");
    expect(first).toHaveTextContent(when("2026-10-20T12:30:00Z", "DD-MM-YYYY"));
    expect(first).toHaveTextContent(/\d{2}:\d{2}/);
    expect(screen.getByText(/A removed user deleted/).closest("li")).toHaveTextContent("photo 9");
  });
});
