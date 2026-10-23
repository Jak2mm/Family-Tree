import os
import threading
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings, load_settings
from app import audit, auth, backup, links, people, photos, settings_api, tree, users
from app.db import connect, init_db


DEFAULT_FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app(
    settings: Settings | None = None, start_scheduler: bool = True, frontend_dir: str | os.PathLike | None = None
) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        os.makedirs(settings.data_dir, exist_ok=True)
        conn = connect(os.path.join(settings.data_dir, "family_tree.db"))
        init_db(conn)
        conn.close()
        lock = backup.acquire_app_lock(settings)
        stop = threading.Event()
        thread = None
        if start_scheduler:
            thread = threading.Thread(
                target=backup.scheduler_loop, name="backup-scheduler", daemon=True,
                args=(settings, stop), kwargs={"periodic": (settings_api.daily_dependency_check,)},
            )
            thread.start()
        app.state.scheduler_thread = thread
        try:
            yield
        finally:
            stop.set()
            if thread:
                thread.join(timeout=10)
            lock.close()

    app = FastAPI(title="Family Tree", lifespan=lifespan)
    app.state.settings = settings
    app.state.scheduler_thread = None

    @app.exception_handler(RequestValidationError)
    async def plain_validation_error(request: Request, exc: RequestValidationError):
        first = exc.errors()[0]
        field = next((str(p) for p in reversed(first["loc"]) if p != "body"), "request")
        return JSONResponse(status_code=422, content={"detail": f"Please check the {field} you entered: {first['msg']}."})

    app.add_middleware(photos.UploadSizeLimit)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(audit.router)
    app.include_router(people.router)
    app.include_router(links.router)
    app.include_router(photos.router)
    app.include_router(tree.router)
    app.include_router(settings_api.router)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    dist = Path(frontend_dir if frontend_dir is not None else DEFAULT_FRONTEND_DIR).resolve()
    if (dist / "index.html").is_file():
        _serve_frontend(app, dist)

    return app


def _serve_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built front end for addresses no route claims: real files as they are, other page
    addresses as index.html. It runs only on a 404, so it can never shadow a route (even one added
    later), and /api paths keep the API's JSON 404."""

    @app.exception_handler(StarletteHTTPException)
    async def frontend_or_error(request: Request, exc: StarletteHTTPException):
        path = request.url.path.lstrip("/")
        if exc.status_code != 404 or request.method != "GET" or path == "api" or path.startswith("api/"):
            return await http_exception_handler(request, exc)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        if path.startswith("assets/") or Path(path).suffix:
            return await http_exception_handler(request, exc)
        return FileResponse(dist / "index.html")
