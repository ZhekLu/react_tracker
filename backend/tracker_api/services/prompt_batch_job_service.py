from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from ..database import get_engine
from ..schemas.workspace import PromptBatchCreateCommand, PromptBatchCreateResponse
from .prompt_batch_service import create_prompt_batch

JobState = Literal["queued", "running", "completed", "failed"]
JOB_TTL = timedelta(hours=2)
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="prompt-package")
_LOCK = threading.Lock()


@dataclass(slots=True)
class PromptBatchJob:
    id: str
    status: JobState
    progress: int
    stage: str
    created_at: datetime
    result: PromptBatchCreateResponse | None = None
    error: str | None = None


_JOBS: dict[str, PromptBatchJob] = {}


def _prune_jobs(now: datetime) -> None:
    expired = [
        job_id
        for job_id, job in _JOBS.items()
        if now - job.created_at > JOB_TTL
    ]
    for job_id in expired:
        _JOBS.pop(job_id, None)


def _update(job_id: str, progress: int, stage: str) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job.status = "running"
        job.progress = max(job.progress, min(100, progress))
        job.stage = stage


def _run(job_id: str, command: PromptBatchCreateCommand) -> None:
    try:
        with get_engine().begin() as connection:
            result = create_prompt_batch(
                connection,
                command,
                lambda progress, stage: _update(job_id, progress, stage),
            )
    except Exception as error:
        with _LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job.status = "failed"
                job.stage = "Prompt preparation failed"
                job.error = str(error)
        return

    with _LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            job.status = "completed"
            job.progress = 100
            job.stage = "Prompt and attachments are ready"
            job.result = result


def start_prompt_batch_job(command: PromptBatchCreateCommand) -> PromptBatchJob:
    now = datetime.now(UTC)
    job = PromptBatchJob(
        id=str(uuid.uuid4()),
        status="queued",
        progress=0,
        stage="Waiting to prepare prompt attachments",
        created_at=now,
    )
    with _LOCK:
        _prune_jobs(now)
        _JOBS[job.id] = job
    _EXECUTOR.submit(_run, job.id, command)
    return job


def get_prompt_batch_job(job_id: str) -> PromptBatchJob | None:
    with _LOCK:
        return _JOBS.get(job_id)
