import type {
  Annotation,
  AnnotationAnchor,
  AnnotationKind,
  AnnotationStatus,
  Attention,
  Course,
  CourseStats,
  CourseSummary,
  DayProgress,
  DayStatus,
  Discussion,
  DiscussionMessage,
  DiscussionQuestionRelation,
  DocumentContent,
  ExamQuestion,
  ExamSet,
  ExamStatus,
  Note,
  NoteLink,
  Resource,
  ResourceFile,
  ResourceChapterStatus,
  ResourceStatus,
  ResourceVersion,
  Skill,
  StudyDay,
  Task,
  TaskStatus,
} from "../types/tracker";

const API_BASE = import.meta.env.VITE_TRACKER_API_BASE ?? "http://127.0.0.1:8787/api";

type ApiCourseStats = {
  day_count: number;
  task_count: number;
  completed_task_count: number;
  resource_count: number;
  read_resource_count: number;
  exam_question_count: number;
  solved_exam_question_count: number;
  open_question_count: number;
  do_later_count: number;
  skill_count: number;
  tracked_seconds: number;
  progress_ratio: number;
};

type ApiCourseSummary = {
  id: string;
  title: string;
  short_code: string;
  subtitle?: string | null;
  accent_color: string;
  icon_uri?: string | null;
  deadline?: string | null;
  status: string;
  revision: number;
  stats: ApiCourseStats;
};

type ApiDocumentContent = {
  id: string;
  canonical_format: "markdown" | "tiptap_json";
  markdown?: string | null;
  editor_json?: Record<string, unknown> | null;
  plain_text: string;
  revision: number;
  updated_at: string;
};

type ApiNoteLink = {
  entity_type: string;
  entity_id: string;
  relation: "primary" | "related";
};

type ApiNote = {
  id: string;
  course_id: string;
  kind: string;
  attention: Attention;
  status: "active" | "archived";
  revision: number;
  document: ApiDocumentContent;
  links: ApiNoteLink[];
  created_at: string;
  updated_at: string;
};

type ApiAnnotationAnchor = {
  anchor_type: string;
  quote?: string | null;
  section_title?: string | null;
  source_line_start?: number | null;
  source_line_end?: number | null;
  page_number?: number | null;
  rect?: number[] | null;
  color?: string | null;
  discussion_message_id?: string | null;
  metadata: Record<string, unknown>;
};

type ApiAnnotation = {
  id: string;
  resource_id: string;
  kind: AnnotationKind;
  status: AnnotationStatus;
  postponed: boolean;
  priority: "low" | "normal" | "high";
  origin: string;
  revision: number;
  body?: ApiDocumentContent | null;
  anchor?: ApiAnnotationAnchor | null;
  notes: ApiNote[];
  created_at: string;
  updated_at: string;
};

type ApiTask = {
  id: string;
  day_id: string;
  section_id?: string | null;
  title: string;
  task_type?: string | null;
  is_optional: boolean;
  order_index: number;
  estimated_minutes?: number | null;
  status: TaskStatus;
  defer_until?: string | null;
  revision: number;
  resource_ids: string[];
  exam_question_ids: string[];
  skill_ids: string[];
  chapter_numbers: number[];
  rationale?: ApiDocumentContent | null;
  notes: ApiNote[];
  open_question_count: number;
};

type ApiDaySection = {
  id: string;
  title: string;
  order_index: number;
  default_collapsed: boolean;
  tasks: ApiTask[];
};

type ApiDayProgress = {
  required: number;
  done: number;
  later: number;
  skipped: number;
  optional: number;
  ratio: number;
};

type ApiStudyDay = {
  id: string;
  number: number;
  date?: string | null;
  title: string;
  topic?: string | null;
  purpose?: string | null;
  status: DayStatus;
  revision: number;
  sections: ApiDaySection[];
  notes: ApiNote[];
  skill_ids: string[];
  open_question_count: number;
  tracked_seconds: number;
  progress: ApiDayProgress;
};

type ApiResourceVersion = {
  id: string;
  version_number: number;
  storage_type: string;
  local_path?: string | null;
  source_url?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  page_count?: number | null;
};

type ApiResource = {
  id: string;
  parent_resource_id?: string | null;
  title: string;
  kind: string;
  format: string;
  source_type: string;
  category?: string | null;
  authors: string[];
  publication_year?: number | null;
  canonical_url?: string | null;
  status: ResourceStatus;
  revision: number;
  description?: ApiDocumentContent | null;
  version?: ApiResourceVersion | null;
  local_files: {
    index: number;
    local_path: string;
    file_name: string;
    is_primary: boolean;
  }[];
  metadata: Record<string, unknown>;
  progress_percent: number;
  day_ids: string[];
  task_ids: string[];
  notes: ApiNote[];
  annotations: ApiAnnotation[];
  chapters: {
    number: number;
    title: string;
    planned: boolean;
    status: ResourceChapterStatus;
    revision?: number | null;
  }[];
  open_question_count: number;
};

type ApiExamQuestion = {
  id: string;
  label: string;
  part?: string | null;
  topic?: string | null;
  points?: number | null;
  order_index: number;
  solve_status: ExamStatus;
  prompt?: ApiDocumentContent | null;
  notes: ApiNote[];
  annotations: ApiAnnotation[];
  open_question_count: number;
  revision: number;
};

type ApiExamSet = {
  id: string;
  title: string;
  category?: string | null;
  source_path?: string | null;
  questions: ApiExamQuestion[];
};

type ApiSkill = {
  id: string;
  name: string;
  category?: string | null;
  description?: ApiDocumentContent | null;
  confidence?: number | null;
  day_ids: string[];
  completed_day_count: number;
};

type ApiDiscussionMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "personal_note";
  sequence_number: number;
  body: ApiDocumentContent;
  reply_to_message_id?: string | null;
  imported_from_clipboard: boolean;
  annotation_links: {
    annotation_id: string;
    relation: DiscussionQuestionRelation;
  }[];
  revision: number;
  created_at: string;
};

type ApiDiscussion = {
  id: string;
  resource_id: string;
  source_resource_ids: string[];
  initial_prompt_batch_id?: string | null;
  question_ids: string[];
  title: string;
  provider: string;
  attention: Attention;
  status: "active" | "reviewed" | "archived";
  revision: number;
  messages: ApiDiscussionMessage[];
};

type ApiCourseWorkspace = {
  course: ApiCourseSummary;
  days: ApiStudyDay[];
  resources: ApiResource[];
  exams: ApiExamSet[];
  skills: ApiSkill[];
  discussions: ApiDiscussion[];
  notes: ApiNote[];
  annotations: ApiAnnotation[];
};

type MutationResponse = {
  id: string;
  revision: number;
  updated_at: string;
};

export type NoteUpsertInput = {
  courseId: string;
  noteId?: string | null;
  noteRevision?: number | null;
  documentRevision?: number | null;
  kind: string;
  attention?: Attention;
  entityType: string;
  entityId: string;
  markdown: string;
  editorJson?: Record<string, unknown> | null;
  plainText: string;
  relatedLinks?: {
    entityType: string;
    entityId: string;
  }[];
};

export type DiscussionMessageInput = {
  role: "user" | "assistant" | "system" | "personal_note";
  markdown: string;
  editorJson?: Record<string, unknown> | null;
  plainText: string;
  replyToMessageId?: string;
  importedFromClipboard?: boolean;
  linkPromptQuestions?: boolean;
  annotationLinks?: {
    annotationId: string;
    relation: DiscussionQuestionRelation;
  }[];
};

export type DiscussionMessageUpdateInput = {
  revision: number;
  documentRevision: number;
  markdown: string;
  editorJson?: Record<string, unknown> | null;
  plainText?: string;
};

export type DiscussionReviewItemInput = {
  kind: "question" | "highlight";
  quote: string;
  markdown: string;
  color?: "primary" | "secondary";
  contextBefore?: string;
  contextAfter?: string;
  fromPosition?: number;
  toPosition?: number;
};

export type DiscussionMessageReviewInput = DiscussionMessageUpdateInput & {
  reviewItems: DiscussionReviewItemInput[];
};

export type DiscussionAnswerDeleteInput = DiscussionMessageUpdateInput & {
  questionIds: string[];
};

export type DiscussionCreateInput = {
  courseId: string;
  sourceResourceId?: string;
  initialPromptBatchId?: string;
  title?: string;
  provider?: string;
};

export type ResourceOpenResult = {
  resourceId: string;
  target: string;
  application: string;
};

export type PdfAnnotationCollectionResult = {
  resourceId: string;
  path: string;
  extractedCount: number;
  createdCount: number;
  updatedCount: number;
  existingCount: number;
  removedCount: number;
  ignoredCount: number;
  ignored: Record<string, number>;
  kindCounts: Partial<Record<AnnotationKind, number>>;
  colorPalette: DrawboardColorPaletteEntry[];
  requiresColorRoles: boolean;
};

export type DrawboardColorRole = "question" | "regular";

export type DrawboardColorPaletteEntry = {
  key: string;
  rgb: number[];
  count: number;
  annotationKinds: string[];
  role: DrawboardColorRole | null;
  suggestedRole: DrawboardColorRole;
};

export type TogglStatus = {
  online: boolean;
  configured: boolean;
  running: boolean;
  error: string;
  projectName: string;
  current: {
    id: string | number;
    description: string;
    planId: string;
    dayId: string;
    taskId?: string | null;
    start: string;
  } | null;
  totals: Record<string, number>;
  days: Record<string, Record<string, number>>;
  tasks: Record<string, number>;
};

type ApiTogglStatus = {
  configured: boolean;
  running: boolean;
  error: string;
  project_name: string;
  current: {
    id: string | number;
    description: string;
    plan_id: string;
    day_id: string;
    task_id?: string | null;
    start: string;
  } | null;
  totals: Record<string, number>;
  days: Record<string, Record<string, number>>;
  tasks: Record<string, number>;
};

export type AnnotationCreateInput = {
  resourceId: string;
  kind?: AnnotationKind;
  priority?: "low" | "normal" | "high";
  origin?: string;
  externalId?: string;
  sourceFingerprint?: string;
  markdown?: string;
  plainText?: string;
  anchor?: {
    anchorType?: string;
    quote?: string;
    sectionTitle?: string;
    sourceLineStart?: number;
    sourceLineEnd?: number;
    pageNumber?: number;
    rect?: number[];
    color?: string;
    rgb?: number[];
    annotationKind?: string;
    discussionMessageId?: string;
    metadata?: Record<string, unknown>;
  };
};

export type PromptBatchInput = {
  courseId: string;
  title: string;
  sourceScope: string;
  markdown: string;
  plainText?: string;
  sourceResourceId?: string;
  sourceDayId?: string;
  sourceTaskId?: string;
  annotationIds?: string[];
  attachmentLimit?: number;
};

export type PromptAttachment = {
  name: string;
  kind: "resource" | "question_image" | "manifest";
  path: string;
  resourceId?: string | null;
  annotationId?: string | null;
  questionLabel?: string | null;
};

export type PromptBatchResult = MutationResponse & {
  markdown: string;
  attachmentDirectory: string;
  attachments: PromptAttachment[];
  warnings: string[];
};

export type PromptBatchProgress = {
  progress: number;
  stage: string;
};

type ApiPromptBatchResult = {
  id: string;
  revision: number;
  updated_at: string;
  markdown: string;
  attachment_directory: string;
  attachments: {
    name: string;
    kind: "resource" | "question_image" | "manifest";
    path: string;
    resource_id?: string | null;
    annotation_id?: string | null;
    question_label?: string | null;
  }[];
  warnings: string[];
};

type ApiPromptBatchJob = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  result?: ApiPromptBatchResult | null;
  error?: string | null;
};

export type ResourceContentResult = {
  resourceId: string;
  versionId?: string | null;
  title: string;
  format: "markdown" | "html" | "text";
  content: string;
  sourcePath: string;
};

export type CourseFileItem = {
  id: string;
  name: string;
  relativePath: string;
  rootName: string;
};

export type PdfReaderMetadata = {
  pageCount: number;
  pages: Array<{ number: number; title: string }>;
  resourceId: string;
  sourcePath: string;
  title: string;
};

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail ?? detail;
    } catch {
      // Keep the HTTP status text when the body is not JSON.
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

function stats(api: ApiCourseStats): CourseStats {
  return {
    dayCount: api.day_count,
    taskCount: api.task_count,
    completedTaskCount: api.completed_task_count,
    resourceCount: api.resource_count,
    readResourceCount: api.read_resource_count,
    examQuestionCount: api.exam_question_count,
    solvedExamQuestionCount: api.solved_exam_question_count,
    openQuestionCount: api.open_question_count,
    doLaterCount: api.do_later_count,
    skillCount: api.skill_count,
    trackedSeconds: api.tracked_seconds,
    progressRatio: api.progress_ratio,
  };
}

function courseSummary(api: ApiCourseSummary): CourseSummary {
  return {
    id: api.id,
    title: api.title,
    shortCode: api.short_code,
    subtitle: api.subtitle,
    accent: api.accent_color,
    iconUri: api.icon_uri,
    deadline: api.deadline,
    status: api.status,
    revision: api.revision,
    stats: stats(api.stats),
  };
}

function documentContent(api: ApiDocumentContent): DocumentContent {
  return {
    id: api.id,
    canonicalFormat: api.canonical_format,
    markdown: api.markdown,
    editorJson: api.editor_json,
    plainText: api.plain_text,
    revision: api.revision,
    updatedAt: api.updated_at,
  };
}

function noteLink(api: ApiNoteLink): NoteLink {
  return {
    entityType: api.entity_type,
    entityId: api.entity_id,
    relation: api.relation,
  };
}

function note(api: ApiNote): Note {
  return {
    id: api.id,
    courseId: api.course_id,
    kind: api.kind,
    attention: api.attention,
    status: api.status,
    revision: api.revision,
    document: documentContent(api.document),
    links: api.links.map(noteLink),
    createdAt: api.created_at,
    updatedAt: api.updated_at,
  };
}

function annotationAnchor(api: ApiAnnotationAnchor): AnnotationAnchor {
  return {
    anchorType: api.anchor_type,
    quote: api.quote,
    sectionTitle: api.section_title,
    sourceLineStart: api.source_line_start,
    sourceLineEnd: api.source_line_end,
    pageNumber: api.page_number,
    rect: api.rect,
    color: api.color,
    discussionMessageId: api.discussion_message_id,
    metadata: api.metadata,
  };
}

function annotation(api: ApiAnnotation): Annotation {
  return {
    id: api.id,
    resourceId: api.resource_id,
    kind: api.kind,
    status: api.status,
    postponed: api.postponed,
    priority: api.priority,
    origin: api.origin,
    revision: api.revision,
    body: api.body ? documentContent(api.body) : null,
    anchor: api.anchor ? annotationAnchor(api.anchor) : null,
    notes: api.notes.map(note),
    createdAt: api.created_at,
    updatedAt: api.updated_at,
  };
}

function task(api: ApiTask): Task {
  return {
    id: api.id,
    dayId: api.day_id,
    sectionId: api.section_id,
    title: api.title,
    taskType: api.task_type,
    isOptional: api.is_optional,
    orderIndex: api.order_index,
    estimatedMinutes: api.estimated_minutes,
    status: api.status,
    deferUntil: api.defer_until,
    revision: api.revision,
    resourceIds: api.resource_ids,
    examQuestionIds: api.exam_question_ids,
    skillIds: api.skill_ids,
    chapterNumbers: api.chapter_numbers,
    rationale: api.rationale ? documentContent(api.rationale) : null,
    notes: api.notes.map(note),
    openQuestionCount: api.open_question_count,
  };
}

function dayProgress(api: ApiDayProgress): DayProgress {
  return {
    required: api.required,
    done: api.done,
    later: api.later,
    skipped: api.skipped,
    optional: api.optional,
    ratio: api.ratio,
  };
}

function studyDay(api: ApiStudyDay): StudyDay {
  return {
    id: api.id,
    number: api.number,
    date: api.date,
    title: api.title,
    topic: api.topic,
    purpose: api.purpose,
    status: api.status,
    revision: api.revision,
    sections: api.sections.map((section) => ({
      id: section.id,
      title: section.title,
      orderIndex: section.order_index,
      defaultCollapsed: section.default_collapsed,
      tasks: section.tasks.map(task),
    })),
    notes: api.notes.map(note),
    skillIds: api.skill_ids,
    openQuestionCount: api.open_question_count,
    trackedSeconds: api.tracked_seconds,
    progress: dayProgress(api.progress),
  };
}

function resourceVersion(api: ApiResourceVersion): ResourceVersion {
  return {
    id: api.id,
    versionNumber: api.version_number,
    storageType: api.storage_type,
    localPath: api.local_path,
    sourceUrl: api.source_url,
    fileName: api.file_name,
    mimeType: api.mime_type,
    pageCount: api.page_count,
  };
}

function resource(api: ApiResource): Resource {
  return {
    id: api.id,
    parentResourceId: api.parent_resource_id,
    title: api.title,
    kind: api.kind,
    format: api.format,
    sourceType: api.source_type,
    category: api.category,
    authors: api.authors,
    publicationYear: api.publication_year,
    canonicalUrl: api.canonical_url,
    status: api.status,
    revision: api.revision,
    description: api.description ? documentContent(api.description) : null,
    version: api.version ? resourceVersion(api.version) : null,
    localFiles: api.local_files.map<ResourceFile>((file) => ({
      index: file.index,
      localPath: file.local_path,
      fileName: file.file_name,
      isPrimary: file.is_primary,
    })),
    metadata: api.metadata,
    progress: api.progress_percent,
    dayIds: api.day_ids,
    taskIds: api.task_ids,
    notes: api.notes.map(note),
    annotations: api.annotations.map(annotation),
    chapters: api.chapters.map((chapter) => ({
      number: chapter.number,
      planned: chapter.planned,
      revision: chapter.revision,
      status: chapter.status,
      title: chapter.title,
    })),
    openQuestionCount: api.open_question_count,
  };
}

function examQuestion(api: ApiExamQuestion): ExamQuestion {
  return {
    id: api.id,
    label: api.label,
    part: api.part,
    topic: api.topic,
    points: api.points,
    orderIndex: api.order_index,
    solveStatus: api.solve_status,
    prompt: api.prompt ? documentContent(api.prompt) : null,
    notes: api.notes.map(note),
    annotations: api.annotations.map(annotation),
    openQuestionCount: api.open_question_count,
    revision: api.revision,
  };
}

function exam(api: ApiExamSet): ExamSet {
  return {
    id: api.id,
    title: api.title,
    category: api.category,
    sourcePath: api.source_path,
    questions: api.questions.map(examQuestion),
  };
}

function skill(api: ApiSkill): Skill {
  return {
    id: api.id,
    name: api.name,
    category: api.category,
    description: api.description ? documentContent(api.description) : null,
    confidence: api.confidence,
    dayIds: api.day_ids,
    completedDayCount: api.completed_day_count,
    covered: api.day_ids.length > 0 && api.completed_day_count >= api.day_ids.length,
  };
}

function discussionMessage(api: ApiDiscussionMessage): DiscussionMessage {
  return {
    id: api.id,
    role: api.role,
    sequenceNumber: api.sequence_number,
    body: documentContent(api.body),
    replyToMessageId: api.reply_to_message_id,
    importedFromClipboard: api.imported_from_clipboard,
    annotationLinks: api.annotation_links.map((link) => ({
      annotationId: link.annotation_id,
      relation: link.relation,
    })),
    revision: api.revision,
    createdAt: api.created_at,
  };
}

function discussion(api: ApiDiscussion): Discussion {
  return {
    id: api.id,
    resourceId: api.resource_id,
    sourceResourceIds: api.source_resource_ids,
    initialPromptBatchId: api.initial_prompt_batch_id,
    questionIds: api.question_ids,
    title: api.title,
    provider: api.provider,
    attention: api.attention,
    status: api.status,
    revision: api.revision,
    messages: api.messages.map(discussionMessage),
  };
}

function workspace(api: ApiCourseWorkspace): Course {
  return {
    ...courseSummary(api.course),
    days: api.days.map(studyDay),
    resources: api.resources.map(resource),
    exams: api.exams.map(exam),
    skills: api.skills.map(skill),
    discussions: api.discussions.map(discussion),
    notes: api.notes.map(note),
    annotations: api.annotations.map(annotation),
  };
}

function togglStatus(api: ApiTogglStatus): TogglStatus {
  return {
    configured: api.configured,
    current: api.current
      ? {
          dayId: api.current.day_id,
          description: api.current.description,
          id: api.current.id,
          planId: api.current.plan_id,
          start: api.current.start,
          taskId: api.current.task_id,
        }
      : null,
    days: api.days,
    error: api.error,
    online: true,
    projectName: api.project_name,
    running: api.running,
    tasks: api.tasks ?? {},
    totals: api.totals,
  };
}

export async function fetchCourses(): Promise<CourseSummary[]> {
  const payload = await requestJson<{ courses: ApiCourseSummary[] }>("/courses");
  return payload.courses.map(courseSummary);
}

export async function fetchCourseWorkspace(courseId: string): Promise<Course> {
  return workspace(await requestJson<ApiCourseWorkspace>(`/courses/${courseId}/workspace`));
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/tasks/${taskId}/status`, {
    body: JSON.stringify({ status, revision }),
    method: "PATCH",
  });
}

export async function updateDayStatus(
  dayId: string,
  status: DayStatus,
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/days/${dayId}/status`, {
    body: JSON.stringify({ status, revision }),
    method: "PATCH",
  });
}

export async function updateResourceStatus(
  resourceId: string,
  status: ResourceStatus,
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/resources/${resourceId}/status`, {
    body: JSON.stringify({ status, revision }),
    method: "PATCH",
  });
}

export async function fetchResourceContent(
  resourceId: string,
): Promise<ResourceContentResult> {
  const payload = await requestJson<{
    resource_id: string;
    version_id?: string | null;
    title: string;
    format: "markdown" | "html" | "text";
    content: string;
    source_path: string;
  }>(`/resources/${resourceId}/content`);
  return {
    content: payload.content,
    format: payload.format,
    resourceId: payload.resource_id,
    sourcePath: payload.source_path,
    title: payload.title,
    versionId: payload.version_id,
  };
}

export async function fetchCourseFiles(
  courseId: string,
): Promise<CourseFileItem[]> {
  const response = await requestJson<{
    files: Array<{
      id: string;
      name: string;
      relative_path: string;
      root_name: string;
    }>;
  }>(`/courses/${courseId}/files`);
  return response.files.map((file) => ({
    id: file.id,
    name: file.name,
    relativePath: file.relative_path,
    rootName: file.root_name,
  }));
}

export async function fetchPdfReaderMetadata(
  resourceId: string,
): Promise<PdfReaderMetadata> {
  const payload = await requestJson<{
    page_count: number;
    pages: Array<{ number: number; title: string }>;
    resource_id: string;
    source_path: string;
    title: string;
  }>(`/resources/${resourceId}/pdf`);
  return {
    pageCount: payload.page_count,
    pages: payload.pages,
    resourceId: payload.resource_id,
    sourcePath: payload.source_path,
    title: payload.title,
  };
}

export function pdfReaderPageUrl(
  resourceId: string,
  pageNumber: number,
): string {
  return `${API_BASE}/resources/${resourceId}/pdf/pages/${pageNumber}`;
}

export function annotationImageUrl(
  resourceId: string,
  imageId: string,
): string {
  return `${API_BASE}/resources/${resourceId}/annotation-images/${imageId}`;
}

export async function openCourseFile(
  courseId: string,
  fileId: string,
): Promise<{ application: string; target: string }> {
  return requestJson<{ application: string; target: string }>(
    `/courses/${courseId}/files/open`,
    {
      body: JSON.stringify({ file_id: fileId }),
      method: "POST",
    },
  );
}

export async function updateResourceProgress(
  resourceId: string,
  progressPercent: number,
  position: Record<string, unknown> = {},
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/resources/${resourceId}/progress`, {
    body: JSON.stringify({
      position,
      progress_percent: progressPercent,
    }),
    method: "PATCH",
  });
}

export async function updateResourceChapterProgress(
  resourceId: string,
  chapterNumber: number,
  status: ResourceChapterStatus,
  revision?: number | null,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(
    `/resources/${resourceId}/chapters/${chapterNumber}`,
    {
      body: JSON.stringify({ revision, status }),
      method: "PATCH",
    },
  );
}

export async function updateExamQuestionStatus(
  questionId: string,
  status: ExamStatus,
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/exam-questions/${questionId}/status`, {
    body: JSON.stringify({ status, revision }),
    method: "PATCH",
  });
}

export async function updateAnnotation(
  annotationId: string,
  revision: number,
  changes: {
    kind?: AnnotationKind;
    status?: AnnotationStatus;
    postponed?: boolean;
    priority?: "low" | "normal" | "high";
    markdown?: string;
    plainText?: string;
    documentRevision?: number;
  },
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/annotations/${annotationId}`, {
    body: JSON.stringify({
      revision,
      kind: changes.kind,
      status: changes.status,
      postponed: changes.postponed,
      priority: changes.priority,
      markdown: changes.markdown,
      plain_text: changes.plainText,
      document_revision: changes.documentRevision,
    }),
    method: "PATCH",
  });
}

export async function createAnnotation(
  input: AnnotationCreateInput,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>("/annotations", {
    body: JSON.stringify({
      resource_id: input.resourceId,
      kind: input.kind ?? "note",
      priority: input.priority ?? "normal",
      origin: input.origin ?? "manual",
      external_id: input.externalId,
      source_fingerprint: input.sourceFingerprint,
      markdown: input.markdown ?? "",
      plain_text: input.plainText ?? input.markdown ?? "",
      anchor: input.anchor
        ? {
            anchor_type: input.anchor.anchorType ?? "resource",
            quote: input.anchor.quote,
            section_title: input.anchor.sectionTitle,
            source_line_start: input.anchor.sourceLineStart,
            source_line_end: input.anchor.sourceLineEnd,
            page_number: input.anchor.pageNumber,
            rect: input.anchor.rect,
            color: input.anchor.color,
            rgb: input.anchor.rgb,
            annotation_kind: input.anchor.annotationKind,
            discussion_message_id: input.anchor.discussionMessageId,
            metadata: input.anchor.metadata ?? {},
          }
        : undefined,
    }),
    method: "POST",
  });
}

export async function createPromptBatch(
  input: PromptBatchInput,
  onProgress?: (progress: PromptBatchProgress) => void,
): Promise<PromptBatchResult> {
  const command = {
    annotation_ids: input.annotationIds ?? [],
    attachment_limit: input.attachmentLimit,
    course_id: input.courseId,
    markdown: input.markdown,
    plain_text: input.plainText ?? input.markdown,
    source_day_id: input.sourceDayId,
    source_resource_id: input.sourceResourceId,
    source_scope: input.sourceScope,
    source_task_id: input.sourceTaskId,
    title: input.title,
  };
  let job = await requestJson<ApiPromptBatchJob>("/prompt-batches/jobs", {
    body: JSON.stringify(command),
    method: "POST",
  });
  onProgress?.({ progress: job.progress, stage: job.stage });
  while (job.status === "queued" || job.status === "running") {
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    job = await requestJson<ApiPromptBatchJob>(
      `/prompt-batches/jobs/${job.job_id}`,
    );
    onProgress?.({ progress: job.progress, stage: job.stage });
  }
  if (job.status === "failed") {
    throw new Error(job.error || "Prompt attachment preparation failed.");
  }
  if (!job.result) {
    throw new Error("Prompt preparation finished without a result.");
  }
  const result = job.result;
  return {
    id: result.id,
    revision: result.revision,
    updated_at: result.updated_at,
    markdown: result.markdown,
    attachmentDirectory: result.attachment_directory,
    attachments: result.attachments.map((attachment) => ({
      name: attachment.name,
      kind: attachment.kind,
      path: attachment.path,
      resourceId: attachment.resource_id,
      annotationId: attachment.annotation_id,
      questionLabel: attachment.question_label,
    })),
    warnings: result.warnings,
  };
}

export async function prepareExerciseScreenshots(
  taskId: string,
): Promise<{
  directory: string;
  available_exercises: string[];
  exercises: string[];
  screenshots: Array<{
    exercise: string;
    name: string;
    page: number;
    path: string;
  }>;
  warnings: string[];
}> {
  return requestJson(`/tasks/${taskId}/exercise-screenshots`, {
    method: "POST",
  });
}

export async function openResource(resourceId: string): Promise<ResourceOpenResult> {
  const result = await requestJson<{
    resource_id: string;
    target: string;
    application: string;
  }>(`/resources/${resourceId}/open`, {
    method: "POST",
  });
  return {
    resourceId: result.resource_id,
    target: result.target,
    application: result.application,
  };
}

export async function openResourceFile(
  resourceId: string,
  fileIndex: number,
): Promise<ResourceOpenResult> {
  const result = await requestJson<{
    resource_id: string;
    target: string;
    application: string;
  }>(`/resources/${resourceId}/files/${fileIndex}/open`, {
    method: "POST",
  });
  return {
    resourceId: result.resource_id,
    target: result.target,
    application: result.application,
  };
}

export async function collectResourcePdfAnnotations(
  resourceId: string,
  sourceDayId?: string,
): Promise<PdfAnnotationCollectionResult> {
  const result = await requestJson<{
    resource_id: string;
    path: string;
    extracted_count: number;
    created_count: number;
    updated_count: number;
    existing_count: number;
    removed_count: number;
    ignored_count: number;
    ignored: Record<string, number>;
    kind_counts: Partial<Record<AnnotationKind, number>>;
    color_palette: Array<{
      key: string;
      rgb: number[];
      count: number;
      annotation_kinds: string[];
      role: DrawboardColorRole | null;
      suggested_role: DrawboardColorRole;
    }>;
    requires_color_roles: boolean;
  }>(`/resources/${resourceId}/pdf-annotations/collect${
    sourceDayId ? `?source_day_id=${encodeURIComponent(sourceDayId)}` : ""
  }`, {
    method: "POST",
  });
  return {
    createdCount: result.created_count,
    updatedCount: result.updated_count,
    existingCount: result.existing_count,
    removedCount: result.removed_count,
    extractedCount: result.extracted_count,
    ignored: result.ignored,
    ignoredCount: result.ignored_count,
    kindCounts: result.kind_counts,
    colorPalette: result.color_palette.map((entry) => ({
      key: entry.key,
      rgb: entry.rgb,
      count: entry.count,
      annotationKinds: entry.annotation_kinds,
      role: entry.role,
      suggestedRole: entry.suggested_role,
    })),
    requiresColorRoles: result.requires_color_roles,
    path: result.path,
    resourceId: result.resource_id,
  };
}

export async function saveDrawboardColorRoles(
  resourceId: string,
  roles: Record<string, DrawboardColorRole>,
): Promise<Record<string, DrawboardColorRole>> {
  const result = await requestJson<{
    resource_id: string;
    roles: Record<string, DrawboardColorRole>;
  }>(`/resources/${resourceId}/pdf-annotations/color-roles`, {
    method: "PUT",
    body: JSON.stringify({ roles }),
  });
  return result.roles;
}

export async function fetchTogglStatus(force = false): Promise<TogglStatus> {
  try {
    return togglStatus(
      await requestJson<ApiTogglStatus>(
        `/integrations/toggl${force ? "?force=true" : ""}`,
      ),
    );
  } catch (caught) {
    return {
      configured: false,
      current: null,
      days: {},
      error:
        caught instanceof Error
          ? caught.message
          : "The tracker API is not running.",
      online: false,
      projectName: "",
      running: false,
      tasks: {},
      totals: {},
    };
  }
}

export async function startToggl(
  input: {
    courseId: string;
    dayId: string;
    description: string;
    taskId?: string;
  },
): Promise<TogglStatus> {
  return togglStatus(
    await requestJson<ApiTogglStatus>("/integrations/toggl/start", {
      body: JSON.stringify({
        course_id: input.courseId,
        day_id: input.dayId,
        description: input.description,
        task_id: input.taskId,
      }),
      method: "POST",
    }),
  );
}

export async function stopToggl(): Promise<TogglStatus> {
  return togglStatus(
    await requestJson<ApiTogglStatus>("/integrations/toggl/stop", {
      method: "POST",
    }),
  );
}

export async function upsertNote(input: NoteUpsertInput): Promise<MutationResponse> {
  return requestJson<MutationResponse>("/notes", {
    body: JSON.stringify({
      course_id: input.courseId,
      note_id: input.noteId,
      note_revision: input.noteRevision,
      document_revision: input.documentRevision,
      kind: input.kind,
      attention: input.attention ?? "none",
      entity_type: input.entityType,
      entity_id: input.entityId,
      markdown: input.markdown,
      editor_json: input.editorJson,
      plain_text: input.plainText,
      related_links: (input.relatedLinks ?? []).map((link) => ({
        entity_type: link.entityType,
        entity_id: link.entityId,
      })),
    }),
    method: "POST",
  });
}

export async function deleteNote(
  noteId: string,
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/notes/${noteId}`, {
    body: JSON.stringify({ revision }),
    method: "DELETE",
  });
}

export async function createDiscussion(
  input: DiscussionCreateInput,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>("/discussions", {
    body: JSON.stringify({
      course_id: input.courseId,
      source_resource_id: input.sourceResourceId,
      initial_prompt_batch_id: input.initialPromptBatchId,
      title: input.title,
      provider: input.provider ?? "chatgpt",
    }),
    method: "POST",
  });
}

export async function deleteDiscussion(
  discussionId: string,
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/discussions/${discussionId}`, {
    body: JSON.stringify({ revision }),
    method: "DELETE",
  });
}

export async function createDiscussionMessage(
  discussionId: string,
  input: DiscussionMessageInput,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/discussions/${discussionId}/messages`, {
    body: JSON.stringify({
      role: input.role,
      markdown: input.markdown,
      editor_json: input.editorJson,
      plain_text: input.plainText,
      reply_to_message_id: input.replyToMessageId,
      imported_from_clipboard: input.importedFromClipboard ?? false,
      link_prompt_questions: input.linkPromptQuestions ?? false,
      annotation_links: (input.annotationLinks ?? []).map((link) => ({
        annotation_id: link.annotationId,
        relation: link.relation,
      })),
    }),
    method: "POST",
  });
}

export async function updateDiscussionMessage(
  messageId: string,
  input: DiscussionMessageUpdateInput,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/discussion-messages/${messageId}`, {
    body: JSON.stringify({
      revision: input.revision,
      document_revision: input.documentRevision,
      markdown: input.markdown,
      editor_json: input.editorJson,
      plain_text: input.plainText ?? input.markdown,
    }),
    method: "PATCH",
  });
}

export async function reviewDiscussionMessage(
  messageId: string,
  input: DiscussionMessageReviewInput,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(
    `/discussion-messages/${messageId}/review`,
    {
      body: JSON.stringify({
        revision: input.revision,
        document_revision: input.documentRevision,
        markdown: input.markdown,
        editor_json: input.editorJson,
        plain_text: input.plainText ?? input.markdown,
        review_items: input.reviewItems.map((item) => ({
          kind: item.kind,
          quote: item.quote,
          markdown: item.markdown,
          color: item.color,
          context_before: item.contextBefore ?? "",
          context_after: item.contextAfter ?? "",
          from_position: item.fromPosition,
          to_position: item.toPosition,
        })),
      }),
      method: "POST",
    },
  );
}

export async function deleteDiscussionAnswer(
  messageId: string,
  input: DiscussionAnswerDeleteInput,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(
    `/discussion-messages/${messageId}/answer`,
    {
      body: JSON.stringify({
        revision: input.revision,
        document_revision: input.documentRevision,
        markdown: input.markdown,
        editor_json: input.editorJson,
        plain_text: input.plainText ?? input.markdown,
        question_ids: input.questionIds,
      }),
      method: "DELETE",
    },
  );
}

export async function linkDiscussionQuestion(
  messageId: string,
  annotationId: string,
  relation: DiscussionQuestionRelation,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(
    `/discussion-messages/${messageId}/questions/${annotationId}`,
    {
      body: JSON.stringify({ relation }),
      method: "PUT",
    },
  );
}

export async function updateDiscussionStatus(
  discussionId: string,
  status: Discussion["status"],
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(`/discussions/${discussionId}/status`, {
    body: JSON.stringify({ revision, status }),
    method: "PATCH",
  });
}

export async function updateDiscussionAttention(
  discussionId: string,
  attention: Discussion["attention"],
  revision: number,
): Promise<MutationResponse> {
  return requestJson<MutationResponse>(
    `/discussions/${discussionId}/attention`,
    {
      body: JSON.stringify({ attention, revision }),
      method: "PATCH",
    },
  );
}
