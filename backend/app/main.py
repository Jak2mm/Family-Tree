import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Settings, load_settings
from app import audit, auth, backup, links, people, photos, settings_api, tree, users
from app.db import connect, init_db


def create_app(settings: Settings | None = None, start_scheduler: bool = True) -> FastAPI:
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

    return app
