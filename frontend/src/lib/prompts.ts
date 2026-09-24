import type {
  Annotation,
  Course,
  Note,
  Resource,
  StudyDay,
  Task,
} from "../types/tracker";
import {
  isTrackedQuestion,
  trackedQuestionGroups,
  type TrackedQuestionGroup,
} from "./questionIdentity";
import promptTemplates from "../config/promptTemplates.json";
import {
  exerciseNumbersInText,
  parseExerciseReviewProgress,
} from "./exerciseReview";

export type DayPromptOptions = {
  includeTutorSolutions?: boolean;
};

export type PromptPayload = {
  title: string;
  sourceScope: string;
  markdown: string;
  annotationIds?: string[];
  supportingAnnotationIds?: string[];
  sourceDayId?: string;
  sourceResourceId?: string;
  sourceTaskId?: string;
  parentDiscussionId?: string;
  questionLabelStart?: number;
  questionLabels?: Record<string, string>;
};

function noteText(notes: Note[]): string {
  return notes
    .map((note) =>
      (note.document.markdown ?? note.document.plainText).trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

function taskNoteText(
  task: StudyDay["sections"][number]["tasks"][number],
  options: DayPromptOptions,
): string {
  const review = parseExerciseReviewProgress(
    task.notes.find((note) => note.kind === "exercise_review"),
  );
  return noteText(
    task.notes.filter((note) => {
      if (["exercise_review", "exercise_progress"].includes(note.kind)) {
        return false;
      }
      if (note.kind === "exercise_solution") {
        return Boolean(options.includeTutorSolutions);
      }
      if (note.kind !== "exercise_my_solution") return true;
      const numbers = exerciseNumbersInText(
        note.document.markdown ?? note.document.plainText,
      );
      return !numbers.length || numbers.some(
        (number) => review[number] !== "understood",
      );
    }),
  );
}


function annotationMetadata(annotation: Annotation): Record<string, unknown> {
  const metadata = annotation.anchor?.metadata ?? {};
  const selector = metadata.selector;
  return selector && typeof selector === "object" && !Array.isArray(selector)
    ? { ...metadata, ...(selector as Record<string, unknown>) }
    : metadata;
}

export function annotationChapterNumber(annotation: Annotation): number | null {
  const metadata = annotationMetadata(annotation);
  const direct = metadata.chapterNumber;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return Math.trunc(direct);
  }
  if (typeof direct === "string" && /^\d+$/.test(direct.trim())) {
    return Number(direct.trim());
  }
  for (const value of [
    metadata.chapterTitle,
    metadata.chapterLabel,
    metadata.subchapterTitle,
    annotation.anchor?.sectionTitle,
  ]) {
    if (typeof value !== "string") continue;
    const match = value.match(/(?:chapter\s+)?(\d{1,3})(?:\.\d+)?/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function annotationLocationOffset(annotation: Annotation): number {
  const metadata = annotationMetadata(annotation);
  for (const value of [
    metadata.y,
    metadata.top,
    metadata.pageY,
    metadata.normalizedY,
    annotation.anchor?.rect?.[1],
  ]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

export function resourceScopedAnnotations(
  course: Course,
  resource: Resource,
): Annotation[] {
  const rootId = resource.parentResourceId ?? resource.id;
  const familyIds = new Set(
    course.resources
      .filter((candidate) => (candidate.parentResourceId ?? candidate.id) === rootId)
      .map((candidate) => candidate.id),
  );
  familyIds.add(rootId);
  return course.annotations
    .filter((annotation) => familyIds.has(annotation.resourceId))
    .sort((left, right) => {
      const leftChapter = annotationChapterNumber(left) ?? Number.MAX_SAFE_INTEGER;
      const rightChapter = annotationChapterNumber(right) ?? Number.MAX_SAFE_INTEGER;
      const leftPage = left.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER;
      const rightPage = right.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER;
      return (
        leftChapter - rightChapter ||
        leftPage - rightPage ||
        annotationLocationOffset(left) - annotationLocationOffset(right) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    });
}

function dayScopedAnnotations(course: Course, day: StudyDay): Annotation[] {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const resourceScopes = new Map<
    string,
    { unrestricted: boolean; chapters: Set<number> }
  >();

  for (const task of day.sections.flatMap((section) => section.tasks)) {
    for (const resourceId of task.resourceIds) {
      const resource = resourceById.get(resourceId);
      const current = resourceScopes.get(resourceId) ?? {
        chapters: new Set<number>(),
        unrestricted: false,
      };
      if (resource?.kind !== "book") {
        current.unrestricted = true;
      } else {
        (task.resourceChapterNumbers?.[resourceId] ?? task.chapterNumbers).forEach((chapter) => current.chapters.add(chapter));
      }
      resourceScopes.set(resourceId, current);
    }
  }

  return course.annotations.filter((annotation) => {
    const scope = resourceScopes.get(annotation.resourceId);
    if (!scope) return false;
    if (scope.unrestricted) return true;
    const createdDayId = annotationMetadata(annotation).createdDayId;
    if (createdDayId === day.id) return true;
    const chapter = annotationChapterNumber(annotation);
    return chapter !== null && scope.chapters.has(chapter);
  });
}

function activeQuestions(annotations: Annotation[]): Annotation[] {
  return annotations.filter(
    (annotation) =>
      isTrackedQuestion(annotation) &&
      annotation.status === "open" &&
      !annotation.postponed &&
      !annotation.skipped,
  );
}

export function taskScopedAnnotations(
  course: Course,
  day: StudyDay,
  task: Task,
): Annotation[] {
  const resourceIds = new Set(task.resourceIds);

  const taskRootIds = new Set(course.annotations.filter(a => a.anchor?.metadata?.taskId === task.id).map(a => a.id));
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  return course.annotations.filter((annotation) => {
    const metadata = annotationMetadata(annotation);
    const sourceNoteId = metadata.sourceNoteId;
    if (Array.isArray(metadata.rootQuestionIds) && metadata.rootQuestionIds.some(id => taskRootIds.has(String(id)))) return true;
    if (metadata.taskId === task.id || metadata.sourceTaskId === task.id ||
      (typeof sourceNoteId === "string" && task.notes.some(note => note.id === sourceNoteId))) return true;
    if (metadata.taskId || metadata.sourceTaskId) return false;
    if (typeof sourceNoteId === "string" && course.days?.some(d => d.sections.some(s => s.tasks.some(t =>
      t.notes.some(note => note.id === sourceNoteId))))) return false;
    if (!resourceIds.has(annotation.resourceId)) return false;
    const resource = resourceById.get(annotation.resourceId);
    if (resource?.kind !== "book") return true;
    if (annotationMetadata(annotation).createdDayId === day.id) return true;
    const chapter = annotationChapterNumber(annotation);
    return chapter !== null && (task.resourceChapterNumbers?.[annotation.resourceId] ?? task.chapterNumbers).includes(chapter);
  });
}

export function taskSupportingNotes(
  course: Course,
  day: StudyDay,
  task: Task,
): Annotation[] {
  const resourceOrder = new Map(
    task.resourceIds.map((resourceId, index) => [resourceId, index]),
  );
  return taskScopedAnnotations(course, day, task)
    .filter((annotation) => {
      if (annotation.kind !== "note" || annotation.status === "archived") return false;
      const metadata = annotationMetadata(annotation);
      const createdDayId = metadata.createdDayId;
      if (typeof createdDayId === "string" && createdDayId !== day.id) return false;
      const createdTaskId = metadata.createdTaskId ?? metadata.sourceTaskId;
      return typeof createdTaskId !== "string" || createdTaskId === task.id;
    })
    .sort((left, right) =>
      (resourceOrder.get(left.resourceId) ?? Number.MAX_SAFE_INTEGER) -
        (resourceOrder.get(right.resourceId) ?? Number.MAX_SAFE_INTEGER) ||
      (left.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) ||
      annotationLocationOffset(left) - annotationLocationOffset(right) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
    );
}

function annotationLine(
  annotation: Annotation,
  resource: Resource | undefined,
  label: number | string,
): string {
  const questionLabel = typeof label === "number"
    ? `Q-${String(label).padStart(3, "0")}`
    : label;
  const location = [
    resource?.title,
    annotation.anchor?.pageNumber
      ? `page ${annotation.anchor.pageNumber}`
      : null,
    annotation.anchor?.sectionTitle,
  ]
    .filter(Boolean)
    .join(" · ");
  const quote = annotation.anchor?.quote?.trim();
  const body = annotation.body?.plainText.trim();
  const notes = noteText(annotation.notes);
  return [
    `### ${questionLabel} · ${location || "Tracker question"}`,
    `Tracker annotation ID: ${annotation.id}`,
    quote ? `> ${quote}` : "",
    body || "This item was flagged as an open question.",
    notes ? `\n#### My note / attempted solution\n\n${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function supportingNoteLine(
  annotation: Annotation,
  resource: Resource | undefined,
  index: number,
): string {
  const location = [
    resource?.title,
    annotation.anchor?.pageNumber
      ? `page ${annotation.anchor.pageNumber}`
      : null,
    annotation.anchor?.sectionTitle,
  ].filter(Boolean).join(" · ");
  const quote = annotation.anchor?.quote?.trim();
  const body = (
    annotation.body?.markdown ?? annotation.body?.plainText ?? ""
  ).trim();
  const notes = noteText(annotation.notes);
  return [
    `### N-${String(index + 1).padStart(3, "0")} · ${location || "Resource note"}`,
    `Tracker annotation ID: ${annotation.id}`,
    quote ? `> ${quote}` : "",
    body || "This idea was recorded directly on the resource.",
    notes ? `\n#### Additional note\n\n${notes}` : "",
  ].filter(Boolean).join("\n");
}

function annotationGroupLine(
  group: TrackedQuestionGroup,
  resource: Resource | undefined,
  label: number | string,
): string {
  if (group.annotations.length === 1) {
    return annotationLine(group.annotations[0], resource, label);
  }
  const primary = group.annotations[0];
  const questionLabel = typeof label === "number"
    ? `Q-${String(label).padStart(3, "0")}`
    : label;
  const location = [
    resource?.title,
    primary.anchor?.pageNumber ? `page ${primary.anchor.pageNumber}` : null,
    primary.anchor?.sectionTitle,
  ]
    .filter(Boolean)
    .join(" · ");
  const unique = (values: Array<string | null | undefined>) => [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ] as string[];
  const quotes = unique(group.annotations.map((annotation) => annotation.anchor?.quote));
  const bodies = unique(group.annotations.map((annotation) => annotation.body?.plainText));
  const notes = unique(group.annotations.map((annotation) => noteText(annotation.notes)));
  return [
    `### ${questionLabel} · ${location || "Tracker question"}`,
    `Tracker annotation IDs: ${group.annotations.map((annotation) => annotation.id).join(", ")}`,
    ...quotes.map((quote) => `> ${quote}`),
    ...bodies,
    bodies.length || quotes.length
      ? ""
      : "This item was flagged as an open question.",
    notes.length ? `\n#### My note / attempted solution\n\n${notes.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function annotationPromptLabel(
  annotation: Annotation,
  fallbackNumber: number,
): string | number {
  return annotation.stableLabel ?? fallbackNumber;
}

function stableQuestionLabels(
  annotations: readonly Annotation[],
): Record<string, string> | undefined {
  const labels = annotations.flatMap((annotation) =>
    annotation.stableLabel
      ? [[annotation.id, annotation.stableLabel] as const]
      : [],
  );
  return labels.length ? Object.fromEntries(labels) : undefined;
}

function promptQuestionGroups(
  annotations: readonly Annotation[],
  options: {
    annotationIds?: readonly string[];
    unansweredOnly?: boolean;
    includeAnswered?: boolean;
  } = {},
): TrackedQuestionGroup[] {
  const requestedIds = options.annotationIds
    ? new Set(options.annotationIds)
    : null;
  return trackedQuestionGroups(options.includeAnswered
    ? annotations.filter(a => isTrackedQuestion(a) && a.status !== "archived" && a.origin !== "discussion_review_source")
    : activeQuestions([...annotations])).filter(
    (group) =>
      (!requestedIds ||
        group.annotations.some((annotation) => requestedIds.has(annotation.id))) &&
      (!options.unansweredOnly ||
        group.annotations.every(
          (annotation) => (annotation.discussionResponseCount ?? 0) === 0,
        )),
  );
}

export function taskQuestions(
  course: Course,
  day: StudyDay,
  task: Task,
  options: {
    annotationIds?: readonly string[];
    parentDiscussionId?: string;
    questionLabelStart?: number;
    questionLabels?: Readonly<Record<string, string>>;
    unansweredOnly?: boolean;
    includeAnswered?: boolean;
  } = {},
): PromptPayload {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const questionGroups = promptQuestionGroups(
    taskScopedAnnotations(course, day, task),
    options,
  );
  const questions = questionGroups.flatMap((group) => group.annotations);
  const labelStart = options.questionLabelStart ?? 1;
  const markdown = [
    `# ${course.title} · Day ${day.number} · ${task.title}`,
    "",
    questionGroups.length
      ? questionGroups
          .map((group, index) => {
            const annotation = group.annotations[0];
            return annotationGroupLine(
              group,
              resourceById.get(annotation.resourceId),
              options.questionLabels?.[annotation.id] ??
                annotationPromptLabel(annotation, labelStart + index),
            );
          })
          .join("\n\n")
      : "No unanswered questions are attached to this task.",
  ].join("\n");
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown,
    parentDiscussionId: options.parentDiscussionId,
    questionLabelStart: labelStart,
    questionLabels:
      options.questionLabels ?? stableQuestionLabels(questions),
    sourceDayId: day.id,
    sourceScope: "task_questions_continuation",
    sourceTaskId: task.id,
    title: `${course.shortCode} Day ${day.number} · ${task.title}`,
  };
}

export function taskTutorPrompt(course: Course, day: StudyDay, task: Task,
  options: Parameters<typeof taskQuestions>[3] & { includeResourceNotes?: boolean } = {}): PromptPayload {
  const payload = taskQuestions(course, day, task, {...options, includeAnswered: true});
  const resourceNotes = options.includeResourceNotes
    ? taskSupportingNotes(course, day, task)
    : [];
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  return {...payload, sourceScope: "task_review", markdown: [
    `# Review my task · Day ${day.number}`,
    "Please review my explanation and attempt. Preserve correct reasoning, point out gaps, and explain corrections. Put the task feedback under `## Task review`. Treat the attached N-… items as my observations or ideas, not as questions unless I explicitly ask one. Answer attached questions separately under their exact Q-… headings; do not rename IDs.",
    `## Task\n\n${task.title}`,
    task.rationale ? `### Task info\n\n${task.rationale.markdown ?? task.rationale.plainText}` : "",
    `### Task note / my work\n\n${noteText(task.notes.filter(note => note.kind === "task")) || "No task note yet."}`,
    resourceNotes.length ? "## My resource notes / ideas" : "",
    resourceNotes.length
      ? resourceNotes.map((annotation, index) =>
          supportingNoteLine(
            annotation,
            resourceById.get(annotation.resourceId),
            index,
          )).join("\n\n")
      : "",
    "## Attached questions", payload.markdown,
  ].filter(Boolean).join("\n\n"),
  supportingAnnotationIds: resourceNotes.map((annotation) => annotation.id)};
}

export function dayPrompt(
  course: Course,
  day: StudyDay,
  options: DayPromptOptions = {},
): PromptPayload {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const skillById = new Map(course.skills.map((skill) => [skill.id, skill]));
  const tasks = day.sections.flatMap((section) =>
    section.tasks.map((task) => ({ section: section.title, task })),
  );
  const resourceIds = new Set(tasks.flatMap(({ task }) => task.resourceIds));
  const resources = [...resourceIds]
    .map((resourceId) => resourceById.get(resourceId))
    .filter((resource): resource is Resource => Boolean(resource));
  const questionGroups = promptQuestionGroups(dayScopedAnnotations(course, day));
  const questions = questionGroups.flatMap((group) => group.annotations);
  const sections = day.sections.map((section) => {
    const taskLines = section.tasks.map((task) => {
      const linked = task.resourceIds
        .map((resourceId) => resourceById.get(resourceId)?.title)
        .filter(Boolean)
        .join(", ");
      const notes = taskNoteText(task, options);
      return [
        `- [${task.status === "done" ? "x" : " "}] ${task.title}`,
        `  - status: ${task.status}${task.isOptional ? " · optional" : ""}`,
        task.taskType ? `  - type: ${task.taskType}` : "",
        task.estimatedMinutes ? `  - estimate: ${task.estimatedMinutes} minutes` : "",
        linked ? `  - resources: ${linked}` : "",
        task.rationale?.plainText ? `  - why: ${task.rationale.plainText}` : "",
        notes ? `  - my note: ${notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });
    return `## ${section.title}\n\n${taskLines.join("\n")}`;
  });
  const resourceLines = resources.map(
    (resource) =>
      `- ${resource.title} [${resource.kind}; ${resource.status}]` +
      (resource.version?.localPath
        ? ` · ${resource.version.localPath}`
        : resource.canonicalUrl
        ? ` · ${resource.canonicalUrl}`
        : ""),
  );
  const skillLines = day.skillIds
    .map((skillId) => skillById.get(skillId)?.name)
    .filter(Boolean)
    .map((skill) => `- ${skill}`);
  const questionLines = questionGroups.map((group, index) => {
    const annotation = group.annotations[0];
    return annotationGroupLine(
      group,
      resourceById.get(annotation.resourceId),
      annotationPromptLabel(annotation, index + 1),
    );
  });
  const markdown = [
    `# Study session: ${course.title} · Day ${day.number}`,
    "",
    `Date: ${day.date ?? "unscheduled"}`,
    `Topic: ${day.topic || day.title}`,
    `Purpose: ${day.purpose || "No purpose recorded"}`,
    `Day status: ${day.status}`,
    `Required progress: ${day.progress.done}/${day.progress.required}`,
    "",
    noteText(day.notes) ? `## My day note\n\n${noteText(day.notes)}` : "",
    sections.join("\n\n"),
    resourceLines.length
      ? `## Materials\n\n${resourceLines.join("\n")}`
      : "",
    skillLines.length ? `## Skills\n\n${skillLines.join("\n")}` : "",
    questionLines.length
      ? `## Open questions\n\n${questionLines.join("\n\n")}`
      : "",
    "## Request",
    "",
    promptTemplates.dayRequest,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown,
    questionLabels: stableQuestionLabels(questions),
    sourceDayId: day.id,
    sourceScope: "day",
    title: `${course.shortCode} Day ${day.number} prompt`,
  };
}

export function dayQuestions(course: Course, day: StudyDay): PromptPayload {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const questionGroups = promptQuestionGroups(dayScopedAnnotations(course, day));
  const questions = questionGroups.flatMap((group) => group.annotations);
  const markdown = [
    `# ${course.title} · Day ${day.number} open questions`,
    "",
    `Topic: ${day.topic || day.title}`,
    "",
    questionGroups.length
      ? questionGroups
          .map((group, index) => {
            const annotation = group.annotations[0];
            return annotationGroupLine(
              group,
              resourceById.get(annotation.resourceId),
              annotationPromptLabel(annotation, index + 1),
            );
          })
          .join("\n\n")
      : "No structured open questions are attached to this day.",
  ].join("\n");
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown,
    questionLabels: stableQuestionLabels(questions),
    sourceDayId: day.id,
    sourceScope: "day_questions",
    title: `${course.shortCode} Day ${day.number} questions`,
  };
}

export function allQuestions(course: Course): PromptPayload {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const questionGroups = promptQuestionGroups(course.annotations);
  const questions = questionGroups.flatMap((group) => group.annotations);
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown: [
      `# ${course.title} · Active questions`,
      "",
      questionGroups.length
        ? questionGroups
            .map((group, index) => {
              const annotation = group.annotations[0];
              return annotationGroupLine(
                group,
                resourceById.get(annotation.resourceId),
                annotationPromptLabel(annotation, index + 1),
              );
            })
            .join("\n\n")
        : "No structured open questions.",
    ].join("\n"),
    questionLabels: stableQuestionLabels(questions),
    sourceScope: "course_questions",
    title: `${course.shortCode} active questions`,
  };
}

export function annotationContext(
  course: Course,
  annotation: Annotation,
): PromptPayload {
  const resource = course.resources.find(
    (item) => item.id === annotation.resourceId,
  );
  return {
    annotationIds: [annotation.id],
    markdown: [
      `# ${course.title} · Annotation context`,
      "",
      `Resource: ${resource?.title ?? annotation.resourceId}`,
      annotation.anchor?.pageNumber
        ? `Page: ${annotation.anchor.pageNumber}`
        : "",
      annotation.anchor?.sectionTitle
        ? `Section: ${annotation.anchor.sectionTitle}`
        : "",
      `Kind: ${annotation.kind}`,
      `Status: ${annotation.status}`,
      `Priority: ${annotation.priority}`,
      `Tracker annotation ID: ${annotation.id}`,
      "",
      annotation.anchor?.quote ? `> ${annotation.anchor.quote}` : "",
      annotation.body?.plainText ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
    sourceResourceId: annotation.resourceId,
    sourceScope: "annotation_context",
    title: `${course.shortCode} annotation context`,
  };
}

export function meetingAgenda(course: Course): PromptPayload {
  const questions = allQuestions(course);
  const later = course.days.flatMap((day) =>
    day.sections.flatMap((section) =>
      section.tasks
        .filter((task) => task.status === "later")
        .map((task) => `- Day ${day.number}: ${task.title}`),
    ),
  );
  const meetingNote = course.notes.find((note) => note.kind === "meeting");
  return {
    ...questions,
    markdown: [
      `# ${course.title} · Meeting agenda`,
      "",
      meetingNote?.document.plainText
        ? `## Scratchpad\n\n${meetingNote.document.plainText}`
        : "",
      `## Open questions\n\n${questions.markdown.replace(/^#.*\n+/, "")}`,
      `## Deferred work\n\n${later.length ? later.join("\n") : "No deferred tasks."}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    sourceScope: "meeting_agenda",
    title: `${course.shortCode} meeting agenda`,
  };
}

export function resourceInventory(course: Course): PromptPayload {
  const resources = course.resources.filter(
    (resource) => !["discussion", "exam_question"].includes(resource.kind),
  );
  const lines = resources.map((resource) => {
    const location =
      resource.version?.localPath ?? resource.canonicalUrl ?? "no source mapped";
    return `- ${resource.title} [${resource.kind}; ${resource.status}] · ${location}`;
  });
  return {
    markdown: `# ${course.title} · Resource inventory\n\n${lines.join("\n")}`,
    sourceScope: "resource_inventory",
    title: `${course.shortCode} resource inventory`,
  };
}

export function resourceQuestions(
  course: Course,
  resource: Resource,
  options: {
    annotationIds?: readonly string[];
    parentDiscussionId?: string;
    questionLabelStart?: number;
    questionLabels?: Readonly<Record<string, string>>;
    unansweredOnly?: boolean;
  } = {},
): PromptPayload {
  const questionGroups = promptQuestionGroups(
    resourceScopedAnnotations(course, resource),
    options,
  );
  const questions = questionGroups.flatMap((group) => group.annotations);
  const resourceById = new Map(
    course.resources.map((candidate) => [candidate.id, candidate]),
  );
  const chapterTitleByNumber = new Map(
    resource.chapters.map((chapter) => [chapter.number, chapter.title]),
  );
  let previousChapter: number | null | undefined;
  const questionBlocks = questionGroups.flatMap((group, index) => {
    const annotation = group.annotations[0];
    const chapter = annotationChapterNumber(annotation);
    const heading = chapter !== previousChapter
      ? [
          chapter === null
            ? "## Other locations"
            : `## Chapter ${chapter}${chapterTitleByNumber.get(chapter) ? ` · ${chapterTitleByNumber.get(chapter)}` : ""}`,
        ]
      : [];
    previousChapter = chapter;
    return [
      ...heading,
      annotationGroupLine(
        group,
        resourceById.get(annotation.resourceId) ?? resource,
        options.questionLabels?.[annotation.id] ??
          annotationPromptLabel(
            annotation,
            (options.questionLabelStart ?? 1) + index,
          ),
      ),
    ];
  });
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown: [
      `# ${course.title} · ${resource.title} questions`,
      "",
      questionGroups.length
        ? questionBlocks.join("\n\n")
        : "No structured open questions for this resource.",
    ].join("\n"),
    parentDiscussionId: options.parentDiscussionId,
    questionLabelStart: options.questionLabelStart ?? 1,
    questionLabels:
      options.questionLabels ?? stableQuestionLabels(questions),
    sourceResourceId: resource.parentResourceId ?? resource.id,
    sourceScope: options.parentDiscussionId
      ? "resource_questions_continuation"
      : "resource_questions",
    title: `${course.shortCode} · ${resource.title} questions`,
  };
}

export function examOverview(course: Course): PromptPayload {
  const lines = course.exams.flatMap((exam) => [
    `## ${exam.title}`,
    ...exam.questions.map(
      (question) =>
        `- ${question.label} [${question.solveStatus}]` +
        (question.topic ? ` · ${question.topic}` : "") +
        (question.notes[0]?.document.plainText
          ? `\n  - my solution note: ${question.notes[0].document.plainText}`
          : ""),
    ),
    "",
  ]);
  return {
    markdown: `# ${course.title} · Exam overview\n\n${lines.join("\n")}`,
    sourceScope: "exam_overview",
    title: `${course.shortCode} exam overview`,
  };
}
