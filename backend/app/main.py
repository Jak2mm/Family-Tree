import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Settings, load_settings
from app import audit, auth, links, people, photos, tree, users
from app.db import connect, init_db


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        os.makedirs(settings.data_dir, exist_ok=True)
        conn = connect(os.path.join(settings.data_dir, "family_tree.db"))
        init_db(conn)
        conn.close()
        yield

    app = FastAPI(title="Family Tree", lifespan=lifespan)
    app.state.settings = settings

    @app.exception_handler(RequestValidationError)
    async def plain_validation_error(request: Request, exc: RequestValidationError):
        first = exc.errors()[0]
        field = next((str(p) for p in reversed(first["loc"]) if p != "body"), "request")
        return JSONResponse(status_code=422, content={"detail": f"Please check the {field} you entered: {first['msg']}."})

    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(audit.router)
    app.include_router(people.router)
    app.include_router(links.router)
    app.include_router(photos.router)
    app.include_router(tree.router)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app
