from __future__ import annotations

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .config import get_settings
from .migrations.runner import run_migrations


def create_app() -> FastAPI:
    settings = get_settings()
    run_migrations()
    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    if settings.frontend_dist_path.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=settings.frontend_dist_path, html=True),
            name="frontend",
        )
    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "tracker_api.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
