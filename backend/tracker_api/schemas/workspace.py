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
    stable_label: str | None = None
    resource_id: str
    kind: AnnotationKind
    status: AnnotationStatus
    postponed: bool = False
    skipped: bool = False
    priority: Literal["low", "normal", "high"]
    discussion_priority: Literal["auto", "core", "high", "medium", "low"] | None = None
    origin: str
    revision: int
    body: DocumentContent | None = None
    anchor: AnnotationAnchor | None = None
    notes: list[Note] = Field(default_factory=list)
    created_at: str
    updated_at: str


class TodoCounts(StrictModel):
    total: int = 0
    done: int = 0
    open: int = 0
    later: int = 0
    skipped: int = 0


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
    resource_chapter_numbers: dict[str, list[int]] = Field(default_factory=dict)
    rationale: DocumentContent | None = None
    notes: list[Note] = Field(default_factory=list)
    open_question_count: int = 0
    todo_counts: TodoCounts = Field(default_factory=TodoCounts)


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
    postponed_question_count: int
    tracked_seconds: int
    progress: DayProgress
    todo_counts: TodoCounts = Field(default_factory=TodoCounts)


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


class DiscussionQuestionLabel(StrictModel):
    """A human prompt label resolved inside one discussion namespace."""

    label: str
    annotation_ids: list[str] = Field(default_factory=list)


class DiscussionQaReview(StrictModel):
    annotation_id: str
    message_id: str
    message_revision: int
    section_id: str | None = None
    section_fingerprint: str | None = None
    viewed_at: str


class Discussion(StrictModel):
    id: str
    resource_id: str
    source_resource_ids: list[str] = Field(default_factory=list)
    initial_prompt_batch_id: str | None = None
    scope_type: Literal["day", "resource", "general"] = "general"
    source_day_id: str | None = None
    source_task_id: str | None = None
    question_ids: list[str] = Field(default_factory=list)
    question_labels: list[DiscussionQuestionLabel] = Field(default_factory=list)
    qa_reviews: list[DiscussionQaReview] = Field(default_factory=list)
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


class TrackerSettings(StrictModel):
    capture_debug_mode: bool = True
    capture_correction_count: int = 0


class TrackerSettingsCommand(StrictModel):
    capture_debug_mode: bool


class ZoteroStatusResponse(StrictModel):
    available: bool
    enabled: bool
    api_version: str = ""
    zotero_version: str = ""
    item_count: int | None = None
    message: str


class ZoteroExportResponse(StrictModel):
    status: Literal["synced", "partial"]
    created: bool
    item_key: str
    note_key: str
    attachment_key: str
    metadata_source: str
    file_attached: bool
    message: str


class PdfCaptureRejection(StrictModel):
    target_source_fingerprint: str | None = None


class PdfAnnotationCollectionCommand(StrictModel):
    capture_overrides: dict[str, list[float]] = Field(default_factory=dict)
    capture_rejections: dict[str, PdfCaptureRejection] = Field(default_factory=dict)


class PdfCaptureAttachmentCandidateResponse(StrictModel):
    source_fingerprint: str
    page: int
    layout_column: Literal["full", "left", "right"] = "full"
    text: str = ""
    existing: bool = False


class PdfAnnotationCollectionItemResponse(StrictModel):
    outcome: Literal["created", "updated"]
    kind: AnnotationKind
    text: str
    page: int | None = None
    section_title: str = ""
    source_day_id: str | None = None
    source_fingerprint: str = ""
    context_image_url: str = ""
    annotated_page_image_url: str = ""
    proposed_capture_rect: list[float] = Field(default_factory=list)
    capture_rect: list[float] = Field(default_factory=list)
    page_width: float = 0
    page_height: float = 0
    layout_mode: Literal["single", "two_column"] = "single"
    layout_column: Literal["full", "left", "right"] = "full"
    requires_capture_review: bool = False
    attachment_candidates: list[PdfCaptureAttachmentCandidateResponse] = Field(
        default_factory=list
    )


class PdfAnnotationCollectionResponse(StrictModel):
    dry_run: bool = False
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
    changed_items: list[PdfAnnotationCollectionItemResponse] = Field(
        default_factory=list
    )


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
    synced_at: str | None = None
    sync_interval_seconds: int = 600


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
    skipped: bool | None = None
    priority: Literal["low", "normal", "high"] | None = None
    discussion_priority: Literal["auto", "core", "high", "medium", "low"] | None = None
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


class NoteDeleteCommand(RevisionCommand):
    pass


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


class DiscussionAnswerImportItem(StrictModel):
    """One normalized tutor answer extracted from a pasted response."""

    markdown: str = ""
    editor_json: dict[str, Any] | None = None
    plain_text: str = ""
    annotation_links: list[DiscussionMessageAnnotationInput] = Field(
        default_factory=list
    )


class DiscussionAnswerImportCommand(StrictModel):
    answers: list[DiscussionAnswerImportItem] = Field(min_length=1)
    imported_from_clipboard: bool = False


class TaskTutorReviewCommand(StrictModel):
    import_id: str = Field(min_length=1, max_length=100)
    discussion_id: str | None = None
    note_id: str | None = None
    note_revision: int | None = Field(default=None, ge=1)
    document_revision: int | None = Field(default=None, ge=1)
    review_markdown: str = Field(min_length=1)
    answers: list[DiscussionAnswerImportItem] = Field(default_factory=list)


class TaskTutorReviewResponse(StrictModel):
    discussion_id: str
    note_id: str
    message_id: str
    question_id: str


class DiscussionMessageUpdateCommand(RevisionCommand):
    document_revision: int = Field(ge=1)
    markdown: str = ""
    editor_json: dict[str, Any] | None = None
    plain_text: str = ""


class DiscussionMessageDeleteCommand(RevisionCommand):
    pass


class DiscussionReviewItem(StrictModel):
    kind: Literal["question", "highlight"]
    quote: str = Field(min_length=1, max_length=20_000)
    markdown: str = Field(default="", max_length=20_000)
    color: Literal["primary", "secondary"] | None = None
    context_before: str = Field(default="", max_length=2_000)
    context_after: str = Field(default="", max_length=2_000)
    from_position: int | None = Field(default=None, ge=0)
    to_position: int | None = Field(default=None, ge=0)
    section_label: str | None = Field(default=None, max_length=200)
    question_ids: list[str] = Field(default_factory=list)


class DiscussionMessageReviewCommand(DiscussionMessageUpdateCommand):
    review_items: list[DiscussionReviewItem] = Field(default_factory=list)


class DiscussionAnswerDeleteCommand(DiscussionMessageUpdateCommand):
    question_ids: list[str] = Field(default_factory=list)
    archive_questions: bool = False


class DiscussionQuestionLinkCommand(StrictModel):
    relation: DiscussionQuestionRelation


class DiscussionQaReviewCommand(StrictModel):
    message_id: str
    section_id: str
    section_fingerprint: str
    question_ids: list[str] = Field(min_length=1)


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
    parent_discussion_thread_id: str | None = None
    question_label_start: int = Field(default=1, ge=1)
    question_labels: dict[str, str] = Field(default_factory=dict)
    annotation_ids: list[str] = Field(default_factory=list)
    supporting_annotation_ids: list[str] = Field(default_factory=list)
    attachment_limit: int | None = Field(default=None, ge=1, le=100)


class PromptAttachmentPreviewResponse(StrictModel):
    attachment_count: int = Field(ge=0)
    resource_file_count: int = Field(ge=0)
    question_image_count: int = Field(ge=0)
    note_image_count: int = Field(ge=0)


class MaccyImageImportCommand(StrictModel):
    count: int = Field(default=5, ge=1, le=20)
    source_day_id: str | None = None
    source_task_id: str | None = None


class ImageQuestionImportResponse(StrictModel):
    imported: int = Field(ge=0)
    duplicates: int = Field(ge=0)
    annotation_ids: list[str] = Field(default_factory=list)
    source: Literal["maccy", "files"]


class TogglStartCommand(StrictModel):
    description: str = Field(min_length=1, max_length=500)
    course_id: str | None = None
    day_id: str | None = None
    task_id: str | None = None


class MutationResponse(StrictModel):
    id: str
    revision: int
    updated_at: str


class DiscussionAnswerImportResponse(MutationResponse):
    message_ids: list[str] = Field(default_factory=list)


class PromptAttachmentItem(StrictModel):
    name: str
    kind: Literal["resource", "question_image", "note_image", "manifest"]
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
    available_exercises: list[str] = Field(default_factory=list)
    exercises: list[str] = Field(default_factory=list)
    screenshots: list[ExerciseScreenshotItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ExerciseIndexResponse(StrictModel):
    exercises: list[str] = Field(default_factory=list)
