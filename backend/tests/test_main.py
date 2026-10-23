def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def _make_dist(path):
    (path / "assets").mkdir(parents=True)
    (path / "index.html").write_text("<!doctype html><title>Family Tree</title>")
    (path / "assets" / "app.js").write_text("console.log('hi')")
    return path


def test_without_dist_folder_api_works_and_root_is_404(settings, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app

    app = create_app(settings, start_scheduler=False, frontend_dir=str(tmp_path / "missing"))
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/").status_code == 404


def test_dist_folder_is_served_with_spa_fallback(settings, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app

    dist = _make_dist(tmp_path / "dist")
    app = create_app(settings, start_scheduler=False, frontend_dir=str(dist))
    with TestClient(app) as c:
        root = c.get("/")
        assert root.status_code == 200 and "Family Tree" in root.text
        asset = c.get("/assets/app.js")
        assert asset.status_code == 200 and "console.log" in asset.text
        deep = c.get("/person/3")
        assert deep.status_code == 200 and "Family Tree" in deep.text
        missing = c.get("/api/nonexistent")
        assert missing.status_code == 404
        assert missing.headers["content-type"].startswith("application/json")
        assert "detail" in missing.json()
        assert c.get("/api/health").json() == {"status": "ok"}
        assert c.get("/assets/nope.js").status_code == 404
        assert c.get("/../../etc/passwd").status_code in (200, 404)
        assert "root:" not in c.get("/%2e%2e/%2e%2e/etc/passwd").text


def test_routes_added_after_startup_are_not_shadowed_by_the_front_end(settings, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app

    app = create_app(settings, start_scheduler=False, frontend_dir=str(_make_dist(tmp_path / "dist")))
    app.add_api_route("/late", lambda: {"late": True})
    with TestClient(app) as c:
        assert c.get("/late").json() == {"late": True}
        assert c.post("/person/3").status_code == 404  # only GET falls back to the page
