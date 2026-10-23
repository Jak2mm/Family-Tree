import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

beforeEach(() => {
  vi.unstubAllGlobals();
  api.onUnauthorized(() => {});
});

function stub(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api", () => {
  it("sends the CSRF token it was given on changes, but not on reads", async () => {
    api.setCsrfToken("abc123");
    const fn = stub(200, {});
    await api.getPerson(1);
    await api.savePreferences({ date_format: "YYYY-MM-DD" });
    const [, read] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const [, write] = fn.mock.calls[1] as unknown as [string, RequestInit];
    expect((read.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
    expect((write.headers as Record<string, string>)["X-CSRF-Token"]).toBe("abc123");
  });
  it("turns an error body into an ApiError with the server's plain message", async () => {
    stub(422, { detail: "Please enter a given name." });
    await expect(api.getPerson(1)).rejects.toMatchObject({ status: 422, message: "Please enter a given name." });
    await expect(api.getPerson(1)).rejects.toBeInstanceOf(ApiError);
  });
  it("gives a plain message when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api.getPerson(1)).rejects.toThrow(/could not reach the server/i);
  });
  it("tells the app when a signed-in request gets 401, but not for login, setup or the startup check", async () => {
    const seen = vi.fn();
    api.onUnauthorized(seen);
    stub(401, { detail: "Please sign in." });
    await expect(api.getPerson(1)).rejects.toMatchObject({ status: 401 });
    await expect(api.listPeople()).rejects.toMatchObject({ status: 401 });
    expect(seen).toHaveBeenCalledTimes(2);
    seen.mockClear();
    await expect(api.login("a", "b")).rejects.toMatchObject({ status: 401 });
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    await expect(api.setup("a", "b")).rejects.toMatchObject({ status: 401 });
    expect(seen).not.toHaveBeenCalled();
  });
});
