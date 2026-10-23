import { describe, expect, it } from "vitest";
import { hasPermission } from "./me";
import { meWith } from "./test-utils";

describe("hasPermission", () => {
  it("gives an administrator every permission whatever the boxes say", () => {
    const admin = { ...meWith(["admin"]), can_read: false };
    for (const p of ["read", "add", "edit", "delete", "admin"] as const) expect(hasPermission(admin, p)).toBe(true);
  });

  it("uses the boxes for everyone else", () => {
    const user = meWith(["read", "edit"]);
    expect(hasPermission(user, "read")).toBe(true);
    expect(hasPermission(user, "edit")).toBe(true);
    expect(hasPermission(user, "add")).toBe(false);
    expect(hasPermission(user, "delete")).toBe(false);
    expect(hasPermission(user, "admin")).toBe(false);
  });
});
