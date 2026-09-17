from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from ..services import insert_debug_service as debug

router = APIRouter(prefix="/api/debug", tags=["Editor debug"])


@router.post("/inserts")
def create(record: debug.InsertRecord) -> dict[str, str]:
    return debug.create_record(record)


@router.get("/inserts")
def listing(course_id: str, start: datetime, end: datetime) -> dict[str, Any]:
    try:
        return debug.list_records(course_id, start, end)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/inserts/{record_id}")
def detail(record_id: str) -> dict[str, Any]:
    try:
        return debug.get_record(record_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.patch("/inserts/{record_id}")
def review(record_id: str, command: debug.ReviewRecord) -> dict[str, bool]:
    try:
        debug.review_record(record_id, command)
        return {"ok": True}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.post("/inserts/{record_id}/complete")
def complete(record_id: str, command: debug.CompleteReview) -> dict[str, bool]:
    try:
        debug.complete_review(record_id, command)
        return {"ok": True}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.delete("/inserts/{record_id}")
def discard(record_id: str) -> dict[str, bool]:
    debug.discard_record(record_id)
    return {"ok": True}


@router.get("/fixtures")
def fixtures() -> list[dict[str, Any]]:
    return debug.list_fixtures()
