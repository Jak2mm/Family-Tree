import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSettings } from "./AdminSettings";
import { deferred, mockFetch, renderAs } from "../test-utils";
import { BOB, SETTINGS, STATUS_OK, routes } from "./adminTestKit";

const CAROL = { ...BOB, id: 3, username: "carol" };
const TWO_USERS = { "GET /api/users": { body: [{ ...BOB }, CAROL] } };

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "#/settings";
});

async function openReset(name: string) {
  const row = (await screen.findByText(name)).closest("li")!;
  await userEvent.click(within(row).getByRole("button", { name: `Reset password for ${name}` }));
  return row;
}

describe("Password reset and quick actions", () => {
  it("sends both requests when two different rows are acted on in quick succession", async () => {
    const gate = deferred();
    const net = mockFetch(routes({
      ...TWO_USERS,
      "PATCH /api/users/2": async () => (await gate.promise, { body: BOB }),
      "PATCH /api/users/3": { body: CAROL },
    }));
    renderAs(["read", "admin"], <AdminSettings />);
    await userEvent.click(await screen.findByLabelText("Add (bob)"));
    const row = await openReset("carol");
    await userEvent.type(within(row).getByLabelText("New password for carol"), "carols new pass");
    await userEvent.click(within(row).getByRole("button", { name: "Save new password" }));
    await vi.waitFor(() => expect(net.count("PATCH /api/users/3")).toBe(1));
    expect(net.count("PATCH /api/users/2")).toBe(1);
    gate.resolve();
  });

  it("shows 'Password changed.' in the row after a successful reset and closes the form", async () => {
    mockFetch(routes({ ...TWO_USERS, "PATCH /api/users/3": { body: CAROL } }));
    renderAs(["read", "admin"], <AdminSettings />);
    const row = await openReset("carol");
    await userEvent.type(within(row).getByLabelText("New password for carol"), "carols new pass");
    await userEvent.click(within(row).getByRole("button", { name: "Save new password" }));
    expect(await within(row).findByText("Password changed.")).toBeInTheDocument();
    expect(within(row).queryByLabelText("New password for carol")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("carols new pass");
  });

  it("keeps the form open and shows the error inside the row when a reset fails", async () => {
    mockFetch(routes({ ...TWO_USERS, "PATCH /api/users/3": { status: 422, body: { detail: "That password is too short." } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    const row = await openReset("carol");
    await userEvent.type(within(row).getByLabelText("New password for carol"), "carols new pass");
    await userEvent.click(within(row).getByRole("button", { name: "Save new password" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("That password is too short.");
    expect(within(row).getByLabelText("New password for carol")).toHaveValue("");
    expect(within(row).queryByText("Password changed.")).not.toBeInTheDocument();
  });

  it("warns an admin resetting their own password that they will need to sign in again", async () => {
    mockFetch(routes());
    renderAs(["read", "admin"], <AdminSettings />);
    const row = await openReset("sam");
    expect(within(row).getByText("You will need to sign in again.")).toBeInTheDocument();
    const other = (await screen.findByText("bob")).closest("li")!;
    await userEvent.click(within(other).getByRole("button", { name: "Reset password for bob" }));
    expect(within(other).queryByText("You will need to sign in again.")).not.toBeInTheDocument();
  });
});

describe("Backup status stays current", () => {
  const statusCounter = () => {
    let n = 0;
    return () => ({ body: { ...STATUS_OK, next_run: n++ === 0 ? "2026-10-21T02:00:00+00:00" : "2026-10-21T14:00:00+00:00" } });
  };

  it("reloads the status after saving the backup settings", async () => {
    const net = mockFetch(routes({ "GET /api/backup/status": statusCounter(), "PUT /api/settings/backup": { body: SETTINGS } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await screen.findByDisplayValue("02:00");
    await userEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    await vi.waitFor(() => expect(net.count("GET /api/backup/status")).toBe(2));
  });

  it("collapses duplicate times to what the server stored", async () => {
    mockFetch(routes({ "PUT /api/settings/backup": { body: { ...SETTINGS, times: ["02:00", "12:00"] } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await screen.findByDisplayValue("02:00");
    await userEvent.click(screen.getByRole("button", { name: "Add another time" }));
    await userEvent.click(screen.getByRole("button", { name: "Add another time" }));
    expect(screen.getAllByLabelText(/^Backup time/)).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    await screen.findByText("Saved.");
    expect(screen.getAllByLabelText(/^Backup time/)).toHaveLength(2);
  });

  it("reloads the status after Back up now", async () => {
    const net = mockFetch(routes({ "POST /api/backup/run": { body: { ok: true, path: "/backups/a.db", size: 1024, error: null } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Back up now" }));
    await vi.waitFor(() => expect(net.count("GET /api/backup/status")).toBe(2));
  });

  it("names the time zone the backup times are read in", async () => {
    mockFetch(routes({ "GET /api/settings/backup": { body: { ...SETTINGS, timezone: "Australia/Sydney" } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    expect(await screen.findByLabelText("Backup time 1 (Australia/Sydney time)")).toHaveValue("02:00");
  });

  it("hides the size of a failed backup and shows its error once", async () => {
    mockFetch(routes({ "GET /api/backup/status": { body: { ...STATUS_OK, ok: false, size: 0, error: "Disk is full.", warning: "The last backup failed: Disk is full. It is being retried." } } }));
    renderAs(["read", "admin"], <AdminSettings />);
    const status = await screen.findByTestId("backup-status");
    expect(status).toHaveTextContent("Failed");
    expect(status).not.toHaveTextContent(/0 bytes|0 KB/);
    expect(status.textContent!.split("Disk is full.").length - 1).toBe(1);
  });

  it("clears the previous Back up now result before the next run", async () => {
    const gate = deferred();
    let calls = 0;
    mockFetch(routes({
      "POST /api/backup/run": async () => {
        if (calls++ === 0) return { body: { ok: true, path: "/backups/a.db", size: 1024, error: null } };
        await gate.promise;
        return { status: 500, body: { detail: "The server had a problem." } };
      },
    }));
    renderAs(["read", "admin"], <AdminSettings />);
    const button = await screen.findByRole("button", { name: "Back up now" });
    await userEvent.click(button);
    await screen.findByText(/Backup finished/);
    await userEvent.click(button);
    expect(screen.queryByText(/Backup finished/)).not.toBeInTheDocument();
    gate.resolve();
    expect(await screen.findByText("The server had a problem.")).toBeInTheDocument();
    expect(screen.queryByText(/Backup finished/)).not.toBeInTheDocument();
  });
});
