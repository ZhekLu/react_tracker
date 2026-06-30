export type CourseId = string;

export type TaskStatus = "todo" | "in_progress" | "done" | "later" | "skipped";
export type DayStatus = "not_started" | "open" | "closed" | "completed" | "archived";
export type ResourceStatus = "unread" | "skimmed" | "reading" | "read" | "review" | "archived";
export type ExamStatus = "unsolved" | "attempted" | "solved" | "review" | "skipped";
export type AnnotationKind = "question" | "note" | "highlight" | "todo";
export type AnnotationStatus = "open" | "answered" | "archived";
export type DiscussionQuestionRelation =
  | "answers"
  | "partially_answers"
  | "references"
  | "followup_to"
  | "generated_from";

export type ResourceKind =
  | "paper"
  | "book"
  | "slides"
  | "exercise"
  | "guide"
  | "dataset"
  | "exam"
  | "exam_question"
  | "web"
  | "other"
  | string;

export type TrackerView =
  | "roadmap"
  | "resources"
  | "skills"
  | "exams"
  | "notes"
  | "discussions";

export type CourseStats = {
  dayCount: number;
  taskCount: number;
  completedTaskCount: number;
  resourceCount: number;
  readResourceCount: number;
  examQuestionCount: number;
  solvedExamQuestionCount: number;
  openQuestionCount: number;
  doLaterCount: number;
  skillCount: number;
  trackedSeconds: number;
  progressRatio: number;
};

export type CourseSummary = {
  id: CourseId;
  title: string;
  shortCode: string;
  subtitle?: string | null;
  accent: string;
  iconUri?: string | null;
  deadline?: string | null;
  status: string;
  revision: number;
  stats: CourseStats;
};

export type DocumentContent = {
  id: string;
  canonicalFormat: "markdown" | "tiptap_json";
  markdown?: string | null;
  editorJson?: Record<string, unknown> | null;
  plainText: string;
  revision: number;
  updatedAt: string;
};

export type NoteLink = {
  entityType: string;
  entityId: string;
  relation: "primary" | "related";
};

export type Note = {
  id: string;
  courseId: string;
  kind: string;
  status: "active" | "archived";
  revision: number;
  document: DocumentContent;
  links: NoteLink[];
  createdAt: string;
  updatedAt: string;
};

export type AnnotationAnchor = {
  anchorType: string;
  quote?: string | null;
  sectionTitle?: string | null;
  sourceLineStart?: number | null;
  sourceLineEnd?: number | null;
  pageNumber?: number | null;
  rect?: number[] | null;
  color?: string | null;
  discussionMessageId?: string | null;
  metadata: Record<string, unknown>;
};

export type Annotation = {
  id: string;
  resourceId: string;
  kind: AnnotationKind;
  status: AnnotationStatus;
  priority: "low" | "normal" | "high";
  origin: string;
  revision: number;
  body?: DocumentContent | null;
  anchor?: AnnotationAnchor | null;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  dayId: string;
  sectionId?: string | null;
  title: string;
  taskType?: string | null;
  isOptional: boolean;
  orderIndex: number;
  estimatedMinutes?: number | null;
  status: TaskStatus;
  deferUntil?: string | null;
  revision: number;
  resourceIds: string[];
  examQuestionIds: string[];
  skillIds: string[];
  rationale?: DocumentContent | null;
  notes: Note[];
  openQuestionCount: number;
};

export type DaySection = {
  id: string;
  title: string;
  orderIndex: number;
  defaultCollapsed: boolean;
  tasks: Task[];
};

export type DayProgress = {
  required: number;
  done: number;
  later: number;
  skipped: number;
  optional: number;
  ratio: number;
};

export type StudyDay = {
  id: string;
  number: number;
  title: string;
  date?: string | null;
  topic?: string | null;
  purpose?: string | null;
  status: DayStatus;
  revision: number;
  sections: DaySection[];
  notes: Note[];
  skillIds: string[];
  openQuestionCount: number;
  trackedSeconds: number;
  progress: DayProgress;
};

export type ResourceVersion = {
  id: string;
  versionNumber: number;
  storageType: string;
  localPath?: string | null;
  sourceUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  pageCount?: number | null;
};

export type ResourceFile = {
  index: number;
  localPath: string;
  fileName: string;
  isPrimary: boolean;
};

export type Resource = {
  id: string;
  parentResourceId?: string | null;
  title: string;
  kind: ResourceKind;
  format: string;
  sourceType: string;
  category?: string | null;
  authors: string[];
  publicationYear?: number | null;
  canonicalUrl?: string | null;
  status: ResourceStatus;
  revision: number;
  description?: DocumentContent | null;
  version?: ResourceVersion | null;
  localFiles: ResourceFile[];
  metadata: Record<string, unknown>;
  progress: number;
  dayIds: string[];
  taskIds: string[];
  notes: Note[];
  annotations: Annotation[];
  openQuestionCount: number;
};

export type ExamQuestion = {
  id: string;
  label: string;
  part?: string | null;
  topic?: string | null;
  points?: number | null;
  orderIndex: number;
  solveStatus: ExamStatus;
  prompt?: DocumentContent | null;
  notes: Note[];
  annotations: Annotation[];
  openQuestionCount: number;
  revision: number;
};

export type ExamSet = {
  id: string;
  title: string;
  category?: string | null;
  sourcePath?: string | null;
  questions: ExamQuestion[];
};

export type Skill = {
  id: string;
  name: string;
  category?: string | null;
  description?: DocumentContent | null;
  confidence?: number | null;
  dayIds: string[];
  completedDayCount: number;
  covered: boolean;
};

export type DiscussionMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "personal_note";
  sequenceNumber: number;
  body: DocumentContent;
  replyToMessageId?: string | null;
  importedFromClipboard: boolean;
  annotationLinks: {
    annotationId: string;
    relation: DiscussionQuestionRelation;
  }[];
  revision: number;
  createdAt: string;
};

export type Discussion = {
  id: string;
  resourceId: string;
  sourceResourceIds: string[];
  initialPromptBatchId?: string | null;
  questionIds: string[];
  title: string;
  provider: string;
  status: "active" | "reviewed" | "archived";
  revision: number;
  messages: DiscussionMessage[];
};

export type Course = CourseSummary & {
  days: StudyDay[];
  resources: Resource[];
  skills: Skill[];
  exams: ExamSet[];
  discussions: Discussion[];
  notes: Note[];
  annotations: Annotation[];
};

export type EntityNoteSaveInput = {
  entityType: "day" | "task" | "resource" | "exam_question" | "course";
  entityId: string;
  kind: string;
  note?: Note;
  html: string;
};
