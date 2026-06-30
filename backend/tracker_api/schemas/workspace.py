from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TaskStatus = Literal["todo", "in_progress", "done", "later", "skipped"]
DayStatus = Literal["not_started", "open", "closed", "completed", "archived"]
ResourceStatus = Literal["unread", "skimmed", "reading", "read", "review", "archived"]
ExamStatus = Literal["unsolved", "attempted", "solved", "review", "skipped"]
AnnotationKind = Literal["question", "note", "highlight", "todo"]
AnnotationStatus = Literal["open", "answered", "archived"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocumentContent(StrictModel):
    id: str
    canonical_format: Literal["markdown", "tiptap_json"]
    markdown: str | None = None
    editor_json: dict[str, Any] | None = None
    plain_text: str
    revision: int
    updated_at: str


class NoteLink(StrictModel):
    entity_type: str
    entity_id: str
    relation: Literal["primary", "related"]


class Note(StrictModel):
    id: str
    course_id: str
    kind: str
    status: Literal["active", "archived"]
    revision: int
    document: DocumentContent
    links: list[NoteLink]
    created_at: str
    updated_at: str


class AnnotationAnchor(StrictModel):
    anchor_type: str
    quote: str | None = None
    section_title: str | None = None
    source_line_start: int | None = None
    source_line_end: int | None = None
    page_number: int | None = None
    rect: list[float] | None = None
    color: str | None = None
    discussion_message_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Annotation(StrictModel):
    id: str
    resource_id: str
    kind: AnnotationKind
    status: AnnotationStatus
    priority: Literal["low", "normal", "high"]
    origin: str
    revision: int
    body: DocumentContent | None = None
    anchor: AnnotationAnchor | None = None
    created_at: str
    updated_at: str


class Task(StrictModel):
    id: str
    day_id: str
    section_id: str | None = None
    title: str
    task_type: str | None = None
    is_optional: bool
    order_index: int
    estimated_minutes: int | None = None
    status: TaskStatus
    defer_until: str | None = None
    revision: int
    resource_ids: list[str] = Field(default_factory=list)
    exam_question_ids: list[str] = Field(default_factory=list)
    skill_ids: list[str] = Field(default_factory=list)
    rationale: DocumentContent | None = None
    notes: list[Note] = Field(default_factory=list)
    open_question_count: int = 0


class DaySection(StrictModel):
    id: str
    title: str
    order_index: int
    default_collapsed: bool
    tasks: list[Task]


class DayProgress(StrictModel):
    required: int
    done: int
    later: int
    skipped: int
    optional: int
    ratio: float


class StudyDay(StrictModel):
    id: str
    number: int
    date: str | None = None
    title: str
    topic: str | None = None
    purpose: str | None = None
    status: DayStatus
    revision: int
    sections: list[DaySection]
    notes: list[Note]
    skill_ids: list[str]
    open_question_count: int
    tracked_seconds: int
    progress: DayProgress


class ResourceVersion(StrictModel):
    id: str
    version_number: int
    storage_type: str
    local_path: str | None = None
    source_url: str | None = None
    file_name: str | None = None
    mime_type: str | None = None
    page_count: int | None = None


class Resource(StrictModel):
    id: str
    parent_resource_id: str | None = None
    title: str
    kind: str
    format: str
    source_type: str
    category: str | None = None
    authors: list[str] = Field(default_factory=list)
    publication_year: int | None = None
    canonical_url: str | None = None
    status: ResourceStatus
    revision: int
    version: ResourceVersion | None = None
    progress_percent: float
    day_ids: list[str] = Field(default_factory=list)
    task_ids: list[str] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    open_question_count: int


class ExamQuestion(StrictModel):
    id: str
    label: str
    part: str | None = None
    topic: str | None = None
    points: float | None = None
    order_index: int
    solve_status: ExamStatus
    prompt: DocumentContent | None = None
    notes: list[Note] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    open_question_count: int
    revision: int


class Exam(StrictModel):
    id: str
    title: str
    category: str | None = None
    source_path: str | None = None
    questions: list[ExamQuestion]


class Skill(StrictModel):
    id: str
    name: str
    category: str | None = None
    description: DocumentContent | None = None
    confidence: float | None = None
    day_ids: list[str]
    completed_day_count: int


class DiscussionMessage(StrictModel):
    id: str
    role: Literal["user", "assistant", "system", "personal_note"]
    sequence_number: int
    body: DocumentContent
    reply_to_message_id: str | None = None
    revision: int
    created_at: str


class Discussion(StrictModel):
    id: str
    resource_id: str
    title: str
    provider: str
    status: Literal["active", "reviewed", "archived"]
    revision: int
    messages: list[DiscussionMessage]


class ResourceOpenResponse(StrictModel):
    resource_id: str
    target: str
    application: str


class ResourceContentResponse(StrictModel):
    resource_id: str
    version_id: str | None = None
    title: str
    format: Literal["markdown", "html", "text"]
    content: str
    source_path: str


class CourseStats(StrictModel):
    day_count: int
    task_count: int
    completed_task_count: int
    resource_count: int
    read_resource_count: int
    exam_question_count: int
    solved_exam_question_count: int
    open_question_count: int
    do_later_count: int
    skill_count: int
    tracked_seconds: int
    progress_ratio: float


class CourseSummary(StrictModel):
    id: str
    title: str
    short_code: str
    subtitle: str | None = None
    accent_color: str
    icon_uri: str | None = None
    deadline: str | None = None
    status: str
    revision: int
    stats: CourseStats


class CourseWorkspace(StrictModel):
    course: CourseSummary
    days: list[StudyDay]
    resources: list[Resource]
    exams: list[Exam]
    skills: list[Skill]
    discussions: list[Discussion]
    notes: list[Note]
    annotations: list[Annotation]


class CourseListResponse(StrictModel):
    courses: list[CourseSummary]


class RevisionCommand(StrictModel):
    revision: int = Field(ge=1)


class TaskStatusCommand(RevisionCommand):
    status: TaskStatus
    defer_until: str | None = None


class DayStatusCommand(RevisionCommand):
    status: DayStatus


class ResourceStatusCommand(RevisionCommand):
    status: ResourceStatus


class ResourceProgressCommand(StrictModel):
    progress_percent: float = Field(ge=0, le=100)
    heading_id: str | None = None
    position: dict[str, Any] = Field(default_factory=dict)


class ExamStatusCommand(RevisionCommand):
    status: ExamStatus


class AnnotationCommand(RevisionCommand):
    kind: AnnotationKind | None = None
    status: AnnotationStatus | None = None
    priority: Literal["low", "normal", "high"] | None = None


class AnnotationAnchorCreate(StrictModel):
    anchor_type: str = "resource"
    resource_version_id: str | None = None
    quote: str | None = None
    section_title: str | None = None
    source_line_start: int | None = None
    source_line_end: int | None = None
    page_number: int | None = None
    rect: list[float] | None = None
    color: str | None = None
    rgb: list[float] | None = None
    annotation_kind: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnnotationCreateCommand(StrictModel):
    resource_id: str
    kind: AnnotationKind = "note"
    priority: Literal["low", "normal", "high"] = "normal"
    origin: str = "manual"
    external_id: str | None = None
    source_fingerprint: str | None = None
    markdown: str = ""
    plain_text: str = ""
    anchor: AnnotationAnchorCreate | None = None


class NoteUpsertCommand(StrictModel):
    course_id: str
    note_id: str | None = None
    note_revision: int | None = Field(default=None, ge=1)
    document_revision: int | None = Field(default=None, ge=1)
    kind: str
    entity_type: str
    entity_id: str
    markdown: str = ""
    editor_json: dict[str, Any] | None = None
    plain_text: str = ""


class DiscussionCreateCommand(StrictModel):
    course_id: str
    resource_id: str
    provider: str = "chatgpt"


class DiscussionMessageCreateCommand(StrictModel):
    role: Literal["user", "assistant", "system", "personal_note"]
    markdown: str = ""
    editor_json: dict[str, Any] | None = None
    plain_text: str = ""


class DiscussionStatusCommand(RevisionCommand):
    status: Literal["active", "reviewed", "archived"]


class PromptBatchCreateCommand(StrictModel):
    course_id: str
    title: str
    source_scope: str
    markdown: str
    plain_text: str = ""
    source_resource_id: str | None = None
    source_day_id: str | None = None
    source_task_id: str | None = None
    annotation_ids: list[str] = Field(default_factory=list)


class MutationResponse(StrictModel):
    id: str
    revision: int
    updated_at: str
