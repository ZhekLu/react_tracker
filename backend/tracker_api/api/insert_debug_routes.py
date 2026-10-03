from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from ..services import insert_debug_service as debug
from ..services import squeeze_review_service as squeeze

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


@router.get("/squeeze-reviews")
def squeeze_listing(course_id: str) -> list[dict[str, Any]]:
    return squeeze.list_reviews(course_id)


@router.post("/squeeze-reviews/load-recent")
def squeeze_recent(course_id: str) -> list[dict[str, Any]]:
    return squeeze.load_recent(course_id)


@router.get("/squeeze-reviews/export")
def squeeze_export(course_id: str) -> dict[str, Any]:
    return squeeze.export_reviews(course_id)


@router.post("/squeeze-reviews")
def squeeze_create(command: squeeze.NewReview) -> dict[str, Any]:
    return squeeze.create_review(command)


@router.get("/squeeze-reviews/{review_id}")
def squeeze_detail(review_id: str) -> dict[str, Any]:
    try:
        return squeeze.get_review(review_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.put("/squeeze-reviews/{review_id}")
def squeeze_save(review_id: str, command: squeeze.SaveReview) -> dict[str, Any]:
    try:
        return squeeze.save_review(review_id, command)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
