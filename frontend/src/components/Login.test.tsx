import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login";
import { meWith, mockFetch } from "../test-utils";

beforeEach(() => vi.unstubAllGlobals());

describe("Login", () => {
  it("shows the server's plain message when sign-in is refused", async () => {
    mockFetch({ "POST /api/login": { status: 401, body: { detail: "Incorrect username or password." } } });
    const onDone = vi.fn();
    render(<Login onSignedIn={onDone} />);
    await userEvent.type(screen.getByLabelText("Username"), "sam");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("passes the signed-in user on when the password is right", async () => {
    const me = meWith(["read"]);
    const net = mockFetch({ "POST /api/login": { status: 200, body: me } });
    const onDone = vi.fn();
    render(<Login onSignedIn={onDone} />);
    await userEvent.type(screen.getByLabelText("Username"), "sam");
    await userEvent.type(screen.getByLabelText("Password"), "right password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(me));
    expect(net.calls[0].body).toEqual({ username: "sam", password: "right password" });
  });
});
