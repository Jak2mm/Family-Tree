import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import Settings, load_settings
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

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app
