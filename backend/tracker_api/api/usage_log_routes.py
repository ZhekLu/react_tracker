import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from ..services import usage_log_service as usage

router = APIRouter(prefix="/api/debug/usage", tags=["Usage diagnostics"])


@router.get("/settings")
def settings() -> dict[str, Any]:
    return usage.settings()


@router.post("/settings")
def configure(command: usage.CaptureCommand) -> dict[str, Any]:
    return usage.settings(command)


@router.post("/events")
def record(batch: usage.EventBatch) -> dict[str, Any]:
    return usage.record(batch)


@router.get("/summary")
def summary(course_id: uuid.UUID, start: datetime, end: datetime) -> dict[str, Any]:
    try:
        return usage.summary(course_id, start, end)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
