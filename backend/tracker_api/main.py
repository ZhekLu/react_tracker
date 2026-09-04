from __future__ import annotations

import logging
import time
import uuid

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .config import get_settings
from .migrations.runner import run_migrations

logger = logging.getLogger("uvicorn.error")
READ_ONLY_METHODS = {"GET", "HEAD", "OPTIONS"}


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

    @app.middleware("http")
    async def log_api_action(request: Request, call_next):  # type: ignore[no-untyped-def]
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        started_at = time.perf_counter()
        log = logger.debug if request.method in READ_ONLY_METHODS else logger.info
        log(
            "api.action.started request_id=%s method=%s path=%s query=%s",
            request_id,
            request.method,
            request.url.path,
            request.url.query or "-",
        )
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "api.action.failed request_id=%s method=%s path=%s duration_ms=%.1f",
                request_id,
                request.method,
                request.url.path,
                (time.perf_counter() - started_at) * 1000,
            )
            raise
        duration_ms = (time.perf_counter() - started_at) * 1000
        response.headers["X-Request-ID"] = request_id
        if response.status_code >= 400:
            logger.warning(
                "api.action.completed request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
                request_id,
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
        else:
            log(
                "api.action.completed request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
                request_id,
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
        return response

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
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
