import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "./ProfilePage";
import { UserMenu } from "./UserMenu";
import { MeProvider } from "../me";
import { render } from "@testing-library/react";
import { PREFS, deferred, meWith, mockFetch, renderAs } from "../test-utils";

const profile = {
  id: 1, name: "Mary Smith", given_names: "Mary", family_name: "Smith",
  birth_date: "1950-03-07", birth_place: "Ballarat", death_date: "2020-11", occupation: "Nurse",
  bio: "Loved gardening.", profile_photo_id: null,
  places_lived: [{ id: 1, place: "Geelong", from_year: 1960, to_year: 1975 }],
  parents: [{ id: 2, name: "John Smith", link_id: "p:2-1", kind: "biological" }],
  children: [{ id: 3, name: "Anne Smith", link_id: "p:1-3", kind: "biological" }],
  siblings: [{ id: 4, name: "Pat Smith", half: true }],
  partnerships: [{ id: 5, name: "Bob Jones", link_id: "c:1", kind: "married", start_year: 1972, end_year: null }],
  albums: [{ id: 9, title: "Wedding", photos: [{ id: 30, caption: "Cake", year: 1972 }] }],
};
const routes = () => ({ "GET /api/people/1": { body: profile }, "GET /api/me/preferences": { body: PREFS } });

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "#/person/1";
});

describe("ProfilePage content", () => {
  it("shows every detail, with dates day-first by default", async () => {
    mockFetch(routes());
    renderAs(["read"], <ProfilePage id={1} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Mary Smith" })).toBeInTheDocument();
    expect(screen.getByText("07-03-1950")).toBeInTheDocument();
    expect(screen.getByText("11-2020")).toBeInTheDocument();
    for (const text of ["Ballarat", "Nurse", "Geelong", "John Smith", "Anne Smith", "Loved gardening.", "Wedding", "Cake"]) {
      expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Pat Smith/).closest("li")).toHaveTextContent(/half/i);
    expect(screen.getByText(/Bob Jones/).closest("li")).toHaveTextContent(/married/i);
    expect(screen.getByText(/Bob Jones/).closest("li")).toHaveTextContent("1972");
    expect(screen.getByRole("img", { name: "Cake" })).toHaveAttribute("src", "/api/photos/30/thumb");
    expect(screen.getByRole("img", { name: /no profile photo/i })).toBeInTheDocument();
  });

  it("shows the profile photo from the thumbnail address", async () => {
    mockFetch({ ...routes(), "GET /api/people/1": { body: { ...profile, profile_photo_id: 30 } } });
    renderAs(["read"], <ProfilePage id={1} />);
    expect(await screen.findByRole("img", { name: "Photo of Mary Smith" })).toHaveAttribute("src", "/api/photos/30/thumb");
  });

  it("hides every edit, add and delete control from a read-only user", async () => {
    mockFetch(routes());
    renderAs(["read"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /make profile photo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add album/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/choose a photo/i)).not.toBeInTheDocument();
  });

  it("shows edit controls only with edit, add controls only with add, delete controls only with delete", async () => {
    mockFetch(routes());
    const edit = renderAs(["read", "edit"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "#/person/1/edit");
    expect(screen.getAllByRole("button", { name: /undo link/i })).toHaveLength(3);
    expect(screen.getByRole("button", { name: /make profile photo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add album/i })).not.toBeInTheDocument();
    edit.unmount();

    const add = renderAs(["read", "add"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Add album" })).toBeInTheDocument();
    expect(screen.getByLabelText(/choose a photo/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    add.unmount();

    renderAs(["read", "delete"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Delete person" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete album/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows the server's message when the profile cannot be loaded", async () => {
    mockFetch({ "GET /api/people/1": { status: 404, body: { detail: "That person could not be found." } }, "GET /api/me/preferences": { body: PREFS } });
    renderAs(["read"], <ProfilePage id={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("That person could not be found.");
  });
});

describe("ProfilePage actions", () => {
  it("asks before undoing a link, then removes it and reloads", async () => {
    const net = mockFetch({ ...routes(), "DELETE /api/links/p:2-1": { status: 204 } });
    renderAs(["read", "edit"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: /undo link with John Smith/i }));
    expect(net.count("DELETE /api/links/p:2-1")).toBe(0);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(net.count("DELETE /api/links/p:2-1")).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: /undo link with John Smith/i }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Undo link" }));
    await vi.waitFor(() => expect(net.count("DELETE /api/links/p:2-1")).toBe(1));
    await vi.waitFor(() => expect(net.count("GET /api/people/1")).toBe(2));
  });

  it("deletes a person with no links after one confirmation", async () => {
    const net = mockFetch({ ...routes(), "DELETE /api/people/1?links=refuse": { status: 204 } });
    renderAs(["read", "delete"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Delete person" }));
    expect(net.count("DELETE /api/people/1?links=refuse")).toBe(0);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(window.location.hash).toBe("#/people"));
  });

  it("lists the links on a 409 and only removes them after a second confirmation", async () => {
    const links = [
      { kind: "parent", id: 2, name: "John Smith", link_id: "p:2-1" },
      { kind: "partner", id: 5, name: "Bob Jones", link_id: "c:1" },
    ];
    const net = mockFetch({
      ...routes(),
      "DELETE /api/people/1?links=refuse": { status: 409, body: { detail: "This person still has relationships.", links } },
      "DELETE /api/people/1?links=remove": { status: 204 },
    });
    renderAs(["read", "delete"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Delete person" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: /still has relationships/i });
    expect(within(dialog).getByText(/John Smith/)).toHaveTextContent(/parent/i);
    expect(within(dialog).getByText(/Bob Jones/)).toHaveTextContent(/partner/i);
    expect(net.count("DELETE /api/people/1?links=remove")).toBe(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete anyway (remove these links)" }));
    await vi.waitFor(() => expect(net.count("DELETE /api/people/1?links=remove")).toBe(1));
    await vi.waitFor(() => expect(window.location.hash).toBe("#/people"));
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const net = mockFetch(routes());
    renderAs(["read", "delete"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Delete person" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(net.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("adds an album, then reloads", async () => {
    const net = mockFetch({ ...routes(), "POST /api/people/1/albums": { status: 201, body: { id: 10, title: "Holiday", photos: [] } } });
    renderAs(["read", "add"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.type(screen.getByLabelText("Album title"), "Holiday");
    await userEvent.click(screen.getByRole("button", { name: "Add album" }));
    await vi.waitFor(() => expect(net.calls.find((c) => c.path === "/api/people/1/albums")?.body).toEqual({ title: "Holiday" }));
    await vi.waitFor(() => expect(net.count("GET /api/people/1")).toBe(2));
  });

  it("uploads a photo with its caption and year", async () => {
    const net = mockFetch({ ...routes(), "POST /api/albums/9/photos": { status: 201, body: { id: 31, caption: "Day", year: 1980 } } });
    renderAs(["read", "add"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    const file = new File(["x"], "pic.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), file);
    await userEvent.type(screen.getByLabelText("Caption (optional)"), "Day");
    await userEvent.type(screen.getByLabelText("Year (optional)"), "1980");
    await userEvent.click(screen.getByRole("button", { name: "Upload photo" }));
    await vi.waitFor(() => expect(net.count("POST /api/albums/9/photos")).toBe(1));
    const form = net.calls.find((c) => c.path === "/api/albums/9/photos")!.body as FormData;
    expect(form.get("caption")).toBe("Day");
    expect(form.get("year")).toBe("1980");
    expect((form.get("file") as File).name).toBe("pic.jpg");
  });

  it("shows a plain message when an upload fails", async () => {
    mockFetch({ ...routes(), "POST /api/albums/9/photos": { status: 503, body: { detail: "The photo storage is offline." } } });
    renderAs(["read", "add"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), new File(["x"], "pic.jpg", { type: "image/jpeg" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The photo storage is offline.");
  });

  it("makes a photo the profile photo", async () => {
    const net = mockFetch({ ...routes(), "PUT /api/people/1/profile-photo/30": { body: { ...profile, profile_photo_id: 30 } } });
    renderAs(["read", "edit"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: /make profile photo/i }));
    await vi.waitFor(() => expect(net.count("PUT /api/people/1/profile-photo/30")).toBe(1));
  });
});

describe("date format picker", () => {
  it("changes how an existing profile shows its dates without asking the server for the person again", async () => {
    const net = mockFetch({ ...routes(), "PUT /api/me/preferences": (r) => ({ body: { ...PREFS, ...(r.body as object) } }) });
    render(
      <MeProvider user={meWith(["read"])} onSignOut={() => {}}>
        <UserMenu />
        <ProfilePage id={1} />
      </MeProvider>,
    );
    expect(await screen.findByText("07-03-1950")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sam/ }));
    await userEvent.selectOptions(screen.getByLabelText("Date format"), "YYYY-MM-DD");
    expect(screen.getByText("1950-03-07")).toBeInTheDocument();
    expect(screen.getByText("2020-11")).toBeInTheDocument();
    expect(screen.queryByText("07-03-1950")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(net.count("PUT /api/me/preferences")).toBe(1));
    expect(net.calls.find((c) => c.method === "PUT")!.body).toEqual({ date_format: "YYYY-MM-DD" });
    expect(net.count("GET /api/people/1")).toBe(1);
  });

  it("starts from the format saved in the user's preferences", async () => {
    mockFetch({ ...routes(), "GET /api/me/preferences": { body: { ...PREFS, date_format: "YYYY-MM-DD" } } });
    renderAs(["read"], <ProfilePage id={1} />);
    expect(await screen.findByText("1950-03-07")).toBeInTheDocument();
  });
});

describe("late responses", () => {
  it("shows the person you are on when an earlier request finishes last", async () => {
    const first = deferred<{ body: unknown }>();
    const other = { ...profile, id: 2, name: "Second Person", albums: [] };
    mockFetch({
      "GET /api/me/preferences": { body: PREFS },
      "GET /api/people/1": () => first.promise,
      "GET /api/people/2": { body: other },
    });
    const ui = (id: number) => (
      <MeProvider user={meWith(["read", "delete"])} onSignOut={() => {}}>
        <ProfilePage id={id} />
      </MeProvider>
    );
    const { rerender } = render(ui(1));
    rerender(ui(2));
    expect(await screen.findByRole("heading", { level: 1, name: "Second Person" })).toBeInTheDocument();
    first.resolve({ body: profile });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Second Person");
    await userEvent.click(screen.getByRole("button", { name: "Delete person" }));
    expect(screen.getByRole("dialog", { name: "Delete Second Person?" })).toBeInTheDocument();
  });
});

describe("double clicks", () => {
  it("sends one request when Add album is pressed twice while the first is pending", async () => {
    const hold = deferred<{ status: number; body: unknown }>();
    const net = mockFetch({ ...routes(), "POST /api/people/1/albums": () => hold.promise });
    renderAs(["read", "add"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.type(screen.getByLabelText("Album title"), "Holiday");
    const button = screen.getByRole("button", { name: "Add album" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(net.count("POST /api/people/1/albums")).toBe(1);
    hold.resolve({ status: 201, body: { id: 10 } });
    await vi.waitFor(() => expect(button).toBeEnabled());
  });

  it("sends one request when Make profile photo is pressed twice", async () => {
    const hold = deferred<{ body: unknown }>();
    const net = mockFetch({ ...routes(), "PUT /api/people/1/profile-photo/30": () => hold.promise });
    renderAs(["read", "edit"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    const button = screen.getByRole("button", { name: /make profile photo/i });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(net.count("PUT /api/people/1/profile-photo/30")).toBe(1);
    hold.resolve({ body: profile });
  });

  it("sends one upload when Upload photo is pressed twice", async () => {
    const hold = deferred<{ status: number; body: unknown }>();
    const net = mockFetch({ ...routes(), "POST /api/albums/9/photos": () => hold.promise });
    renderAs(["read", "add"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), new File(["x"], "pic.jpg", { type: "image/jpeg" }));
    const button = screen.getByRole("button", { name: "Upload photo" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(net.count("POST /api/albums/9/photos")).toBe(1);
    hold.resolve({ status: 201, body: { id: 31 } });
  });

  it("disables the delete confirmation while the request is in flight", async () => {
    const hold = deferred<{ status: number }>();
    const net = mockFetch({ ...routes(), "DELETE /api/people/1?links=refuse": () => hold.promise });
    renderAs(["read", "delete"], <ProfilePage id={1} />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Delete person" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete person" })).toBeDisabled();
    expect(net.count("DELETE /api/people/1?links=refuse")).toBe(1);
    hold.resolve({ status: 204 });
    await vi.waitFor(() => expect(window.location.hash).toBe("#/people"));
  });
});
