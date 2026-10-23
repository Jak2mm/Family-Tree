"""Small hardening items: link id parsing, security headers, closed API docs, plain 422s, and a check
that every API route is protected unless it is on a short, explained list."""
import re
from dataclasses import replace

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import create_app


def api_routes(app) -> set[tuple[str, str]]:
    """Every (method, path) the app answers under /api, including routes in included routers."""
    found = set()

    def walk(routes):
        for r in routes:
            if isinstance(r, APIRoute):
                found.update((m, r.path) for m in r.methods if m != "HEAD")
            elif hasattr(r, "original_router"):  # FastAPI keeps included routers as one entry each
                walk(r.original_router.routes)
            elif hasattr(r, "routes"):
                walk(r.routes)

    walk(app.routes)
    return {(m, p) for m, p in found if p.startswith("/api")}


# Open to anyone, on purpose.
PUBLIC = {
    ("GET", "/api/health"),        # the container health check
    ("GET", "/api/setup/status"),  # the first-run screen asks whether an account exists yet
    ("POST", "/api/setup"),        # creates the first administrator; refuses once any account exists
    ("POST", "/api/login"),        # signing in
}
# Need a signed-in user, but no particular permission: about the user themselves.
SIGNED_IN = {
    ("POST", "/api/logout"),
    ("GET", "/api/me"),
    ("GET", "/api/me/preferences"),
    ("PUT", "/api/me/preferences"),
}


def concrete(path: str) -> str:
    """Fill path parameters with harmless ids; the permission check must answer before any lookup."""
    path = path.replace("{link_id}", "c:1")
    return re.sub(r"\{[^}]+\}", "1", path)


def call(client, method, path):
    kwargs = {} if method in ("GET", "DELETE") else {"json": {}}
    return client.request(method, concrete(path), **kwargs)


def test_every_api_route_is_classified(app):
    routes = api_routes(app)
    assert len(routes) > 30  # the walk really found the routers
    unclassified = routes - PUBLIC - SIGNED_IN - protected(app)
    assert unclassified == set(), "a new API route must be added to PUBLIC, SIGNED_IN or be permission-checked"


def protected(app):
    return api_routes(app) - PUBLIC - SIGNED_IN


def test_every_non_public_route_needs_sign_in(app, client):
    for method, path in sorted(api_routes(app) - PUBLIC):
        r = call(client, method, path)
        assert r.status_code == 401, f"{method} {path} gave {r.status_code} when signed out"


def test_every_permission_route_refuses_a_user_with_no_permissions(app, make_user, login_as):
    nobody = login_as(make_user(set()))
    for method, path in sorted(protected(app)):
        r = call(nobody, method, path)
        assert r.status_code == 403, f"{method} {path} gave {r.status_code} to a user with no permissions"
    for method, path in sorted(SIGNED_IN - {("POST", "/api/logout")}):
        assert call(nobody, method, path).status_code in (200, 422), f"{method} {path}"


# Link ids

@pytest.mark.parametrize("link_id", ["p:99999999999999999999-1", "p:1-99999999999999999999", "c:99999999999999999999", "c:1%0A", "c:1x"])
def test_odd_link_ids_are_not_found_rather_than_errors(link_id, make_user, login_as):
    c = login_as(make_user({"read", "add", "edit", "delete"}))
    assert c.delete(f"/api/links/{link_id}").status_code == 404
    assert c.patch(f"/api/links/{link_id}", json={"kind": "married"}).status_code == 404


# Headers and docs

EXPECTED = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
}


def test_security_headers_on_api_and_front_end(settings, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Family Tree</title>")
    (dist / "assets" / "app.js").write_text("1")
    with TestClient(create_app(settings, start_scheduler=False, frontend_dir=str(dist))) as c:
        for path in ("/api/health", "/api/people", "/api/nope", "/", "/person/3", "/assets/app.js"):
            r = c.get(path)
            for name, value in EXPECTED.items():
                assert r.headers.get(name) == value, f"{name} on {path}"


def test_api_docs_are_not_published(settings, tmp_path, client):
    other = replace(settings, data_dir=str(tmp_path / "other-data"))  # the client fixture's app holds the first data folder
    with TestClient(create_app(other, start_scheduler=False, frontend_dir=str(tmp_path / "none"))) as bare:
        for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
            assert bare.get(path).status_code == 404
    for path in ("/docs", "/redoc", "/openapi.json"):  # with the front end built, at most its own page comes back
        r = client.get(path)
        assert "swagger" not in r.text.lower() and '"openapi"' not in r.text


# Plain 422s

def test_a_body_that_is_not_a_form_gets_a_plain_message(make_user, login_as):
    c = login_as(make_user({"read", "add"}))
    for body in ([], "text", 5):
        r = c.post("/api/people", json=body)
        assert r.status_code == 422
        assert r.json()["detail"] == "Something in the form was not accepted. Please check it and try again."


def test_a_field_error_still_names_the_field(make_user, login_as):
    c = login_as(make_user({"read", "add"}))
    r = c.post("/api/people", json={"given_names": "A", "birth_place": "x" * 5000})
    assert r.status_code == 422 and "birth_place" in r.json()["detail"]
