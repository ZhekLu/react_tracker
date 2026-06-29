import type {
  Annotation,
  AnnotationAnchor,
  AnnotationKind,
  AnnotationStatus,
  Course,
  CourseStats,
  CourseSummary,
  DayProgress,
  DayStatus,
  Discussion,
  DiscussionMessage,
  DocumentContent,
  ExamQuestion,
  ExamSet,
  ExamStatus,
  Note,
  NoteLink,
  Resource,
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
  priority: "low" | "normal" | "high";
  origin: string;
  revision: number;
  body?: ApiDocumentContent | null;
  anchor?: ApiAnnotationAnchor | null;
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
  version?: ApiResourceVersion | null;
  progress_percent: number;
  day_ids: string[];
  task_ids: string[];
  notes: ApiNote[];
  annotations: ApiAnnotation[];
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
  revision: number;
  created_at: string;
};

type ApiDiscussion = {
  id: string;
  resource_id: string;
  title: string;
  provider: string;
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
  entityType: string;
  entityId: string;
  markdown: string;
  editorJson?: Record<string, unknown> | null;
  plainText: string;
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
    priority: api.priority,
    origin: api.origin,
    revision: api.revision,
    body: api.body ? documentContent(api.body) : null,
    anchor: api.anchor ? annotationAnchor(api.anchor) : null,
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
    version: api.version ? resourceVersion(api.version) : null,
    progress: api.progress_percent,
    dayIds: api.day_ids,
    taskIds: api.task_ids,
    notes: api.notes.map(note),
    annotations: api.annotations.map(annotation),
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
    revision: api.revision,
    createdAt: api.created_at,
  };
}

function discussion(api: ApiDiscussion): Discussion {
  return {
    id: api.id,
    resourceId: api.resource_id,
    title: api.title,
    provider: api.provider,
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

export async function upsertNote(input: NoteUpsertInput): Promise<MutationResponse> {
  return requestJson<MutationResponse>("/notes", {
    body: JSON.stringify({
      course_id: input.courseId,
      note_id: input.noteId,
      note_revision: input.noteRevision,
      document_revision: input.documentRevision,
      kind: input.kind,
      entity_type: input.entityType,
      entity_id: input.entityId,
      markdown: input.markdown,
      editor_json: input.editorJson,
      plain_text: input.plainText,
    }),
    method: "POST",
  });
}
