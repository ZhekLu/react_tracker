from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TaskStatus = Literal["todo", "in_progress", "done", "later", "skipped"]
DayStatus = Literal["not_started", "open", "closed", "completed", "archived"]
ResourceStatus = Literal["unread", "skimmed", "reading", "read", "review", "archived"]
ResourceChapterStatus = Literal["unread", "read_partially", "read_fully"]
ExamStatus = Literal["unsolved", "attempted", "solved", "review", "skipped"]
AnnotationKind = Literal["question", "note", "highlight", "todo"]
AnnotationStatus = Literal["open", "answered", "archived"]
DiscussionQuestionRelation = Literal[
    "answers",
    "partially_answers",
    "references",
    "followup_to",
    "generated_from",
]
Attention = Literal["none", "professor"]


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
    attention: Attention
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
    postponed: bool = False
    priority: Literal["low", "normal", "high"]
    origin: str
    revision: int
    body: DocumentContent | None = None
    anchor: AnnotationAnchor | None = None
    notes: list[Note] = Field(default_factory=list)
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
    chapter_numbers: list[int] = Field(default_factory=list)
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


class ResourceFile(StrictModel):
    index: int
    local_path: str
    file_name: str
    is_primary: bool


class ResourceChapter(StrictModel):
    number: int
    title: str
    planned: bool
    status: ResourceChapterStatus
    revision: int | None = None


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
    description: DocumentContent | None = None
    version: ResourceVersion | None = None
    local_files: list[ResourceFile] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    progress_percent: float
    day_ids: list[str] = Field(default_factory=list)
    task_ids: list[str] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    chapters: list[ResourceChapter] = Field(default_factory=list)
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
    imported_from_clipboard: bool
    annotation_links: list[DiscussionMessageAnnotation] = Field(default_factory=list)
    revision: int
    created_at: str


class DiscussionMessageAnnotation(StrictModel):
    annotation_id: str
    relation: DiscussionQuestionRelation


class Discussion(StrictModel):
    id: str
    resource_id: str
    source_resource_ids: list[str] = Field(default_factory=list)
    initial_prompt_batch_id: str | None = None
    question_ids: list[str] = Field(default_factory=list)
    title: str
    provider: str
    attention: Attention
    status: Literal["active", "reviewed", "archived"]
    revision: int
    messages: list[DiscussionMessage]


class ResourceOpenResponse(StrictModel):
    resource_id: str
    target: str
    application: str


class CourseFileItem(StrictModel):
    id: str
    name: str
    relative_path: str
    root_name: str


class CourseFilesResponse(StrictModel):
    files: list[CourseFileItem]


class CourseFileOpenCommand(StrictModel):
    file_id: str


class CourseFileOpenResponse(StrictModel):
    target: str
    application: str


class ResourceContentResponse(StrictModel):
    resource_id: str
    version_id: str | None = None
    title: str
    format: Literal["markdown", "html", "text"]
    content: str
    source_path: str


DrawboardColorRole = Literal["question", "regular"]


class DrawboardColorPaletteEntryResponse(StrictModel):
    key: str
    rgb: list[float]
    count: int
    annotation_kinds: list[str]
    role: DrawboardColorRole | None = None
    suggested_role: DrawboardColorRole


class DrawboardColorRolesCommand(StrictModel):
    roles: dict[str, DrawboardColorRole]


class DrawboardColorRolesResponse(StrictModel):
    resource_id: str
    roles: dict[str, DrawboardColorRole]


class PdfAnnotationCollectionResponse(StrictModel):
    resource_id: str
    path: str
    extracted_count: int
    created_count: int
    updated_count: int
    existing_count: int
    removed_count: int
    ignored_count: int
    ignored: dict[str, int]
    kind_counts: dict[str, int]
    color_palette: list[DrawboardColorPaletteEntryResponse] = Field(
        default_factory=list
    )
    requires_color_roles: bool = False


class PdfReaderPage(StrictModel):
    number: int
    title: str


class PdfReaderMetadataResponse(StrictModel):
    resource_id: str
    title: str
    page_count: int
    pages: list[PdfReaderPage]
    source_path: str


class TogglCurrent(StrictModel):
    id: str | int
    description: str
    plan_id: str
    day_id: str
    task_id: str | None = None
    start: str


class TogglStatusResponse(StrictModel):
    configured: bool
    error: str
    project_name: str
    running: bool
    current: TogglCurrent | None = None
    totals: dict[str, int]
    days: dict[str, dict[str, int]]
    tasks: dict[str, int]


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


class ResourceChapterProgressCommand(StrictModel):
    status: ResourceChapterStatus
    revision: int | None = Field(default=None, ge=1)


class ExamStatusCommand(RevisionCommand):
    status: ExamStatus


class AnnotationCommand(RevisionCommand):
    kind: AnnotationKind | None = None
    status: AnnotationStatus | None = None
    postponed: bool | None = None
    priority: Literal["low", "normal", "high"] | None = None
    markdown: str | None = None
    plain_text: str | None = None
    document_revision: int | None = Field(default=None, ge=1)


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
    discussion_message_id: str | None = None
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


class NoteRelatedLinkInput(StrictModel):
    entity_type: str
    entity_id: str


class NoteUpsertCommand(StrictModel):
    course_id: str
    note_id: str | None = None
    note_revision: int | None = Field(default=None, ge=1)
    document_revision: int | None = Field(default=None, ge=1)
    kind: str
    attention: Attention = "none"
    entity_type: str
    entity_id: str
    markdown: str = ""
    editor_json: dict[str, Any] | None = None
    plain_text: str = ""
    related_links: list[NoteRelatedLinkInput] = Field(default_factory=list)


class DiscussionCreateCommand(StrictModel):
    course_id: str
    source_resource_id: str | None = None
    initial_prompt_batch_id: str | None = None
    title: str | None = None
    provider: str = "chatgpt"


class DiscussionMessageAnnotationInput(StrictModel):
    annotation_id: str
    relation: DiscussionQuestionRelation


class DiscussionMessageCreateCommand(StrictModel):
    role: Literal["user", "assistant", "system", "personal_note"]
    markdown: str = ""
    editor_json: dict[str, Any] | None = None
    plain_text: str = ""
    reply_to_message_id: str | None = None
    imported_from_clipboard: bool = False
    link_prompt_questions: bool = False
    annotation_links: list[DiscussionMessageAnnotationInput] = Field(
        default_factory=list
    )


class DiscussionMessageUpdateCommand(RevisionCommand):
    document_revision: int = Field(ge=1)
    markdown: str = ""
    editor_json: dict[str, Any] | None = None
    plain_text: str = ""


class DiscussionReviewItem(StrictModel):
    kind: Literal["question", "highlight"]
    quote: str = Field(min_length=1, max_length=20_000)
    markdown: str = Field(default="", max_length=20_000)
    color: Literal["primary", "secondary"] | None = None
    context_before: str = Field(default="", max_length=2_000)
    context_after: str = Field(default="", max_length=2_000)
    from_position: int | None = Field(default=None, ge=0)
    to_position: int | None = Field(default=None, ge=0)


class DiscussionMessageReviewCommand(DiscussionMessageUpdateCommand):
    review_items: list[DiscussionReviewItem] = Field(default_factory=list)


class DiscussionQuestionLinkCommand(StrictModel):
    relation: DiscussionQuestionRelation


class DiscussionStatusCommand(RevisionCommand):
    status: Literal["active", "reviewed", "archived"]


class DiscussionAttentionCommand(RevisionCommand):
    attention: Attention


class DiscussionDeleteCommand(RevisionCommand):
    pass


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


class TogglStartCommand(StrictModel):
    description: str = Field(min_length=1, max_length=500)
    course_id: str | None = None
    day_id: str | None = None
    task_id: str | None = None


class MutationResponse(StrictModel):
    id: str
    revision: int
    updated_at: str


class PromptAttachmentItem(StrictModel):
    name: str
    kind: Literal["resource", "question_image", "manifest"]
    path: str
    resource_id: str | None = None
    annotation_id: str | None = None
    question_label: str | None = None


class PromptBatchCreateResponse(MutationResponse):
    markdown: str
    attachment_directory: str
    attachments: list[PromptAttachmentItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PromptBatchJobResponse(StrictModel):
    job_id: str
    status: Literal["queued", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    stage: str
    result: PromptBatchCreateResponse | None = None
    error: str | None = None


class ExerciseScreenshotItem(StrictModel):
    exercise: str
    name: str
    page: int
    path: str


class ExerciseScreenshotResponse(StrictModel):
    directory: str
    exercises: list[str] = Field(default_factory=list)
    screenshots: list[ExerciseScreenshotItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
