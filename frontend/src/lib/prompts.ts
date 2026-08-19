import type {
  Annotation,
  Course,
  Note,
  Resource,
  StudyDay,
  Task,
} from "../types/tracker";
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
  sourceDayId?: string;
  sourceResourceId?: string;
  sourceTaskId?: string;
  parentDiscussionId?: string;
  questionLabelStart?: number;
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

function annotationChapterNumber(annotation: Annotation): number | null {
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
      } else if (task.chapterNumbers.length > 0) {
        task.chapterNumbers.forEach((chapter) => current.chapters.add(chapter));
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
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open" &&
      !annotation.postponed,
  );
}

export function taskScopedAnnotations(
  course: Course,
  day: StudyDay,
  task: Task,
): Annotation[] {
  const resourceIds = new Set(task.resourceIds);
  const chapterScope = new Set(task.chapterNumbers);
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  return course.annotations.filter((annotation) => {
    if (!resourceIds.has(annotation.resourceId)) return false;
    const resource = resourceById.get(annotation.resourceId);
    if (resource?.kind !== "book") return true;
    if (annotationMetadata(annotation).createdDayId === day.id) return true;
    const chapter = annotationChapterNumber(annotation);
    return chapter !== null && chapterScope.has(chapter);
  });
}

function annotationLine(
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
  ]
    .filter(Boolean)
    .join(" · ");
  const quote = annotation.anchor?.quote?.trim();
  const body = annotation.body?.plainText.trim();
  const notes = noteText(annotation.notes);
  return [
    `### Q-${String(index).padStart(3, "0")} · ${location || "Tracker question"}`,
    `Tracker annotation ID: ${annotation.id}`,
    quote ? `> ${quote}` : "",
    body || "This item was flagged as an open question.",
    notes ? `\n#### My note / attempted solution\n\n${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function taskQuestions(
  course: Course,
  day: StudyDay,
  task: Task,
  options: {
    annotationIds?: readonly string[];
    parentDiscussionId?: string;
    questionLabelStart?: number;
    unansweredOnly?: boolean;
  } = {},
): PromptPayload {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const requestedIds = options.annotationIds
    ? new Set(options.annotationIds)
    : null;
  const questions = activeQuestions(taskScopedAnnotations(course, day, task))
    .filter(
      (annotation) =>
        (!requestedIds || requestedIds.has(annotation.id)) &&
        (!options.unansweredOnly ||
          (annotation.discussionResponseCount ?? 0) === 0),
    );
  const labelStart = options.questionLabelStart ?? 1;
  const markdown = [
    `# ${course.title} · Day ${day.number} · ${task.title}`,
    "",
    questions.length
      ? questions
          .map((annotation, index) =>
            annotationLine(
              annotation,
              resourceById.get(annotation.resourceId),
              labelStart + index,
            ),
          )
          .join("\n\n")
      : "No unanswered questions are attached to this task.",
  ].join("\n");
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown,
    parentDiscussionId: options.parentDiscussionId,
    questionLabelStart: labelStart,
    sourceDayId: day.id,
    sourceScope: "task_questions_continuation",
    sourceTaskId: task.id,
    title: `${course.shortCode} Day ${day.number} · ${task.title}`,
  };
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
  const questions = activeQuestions(dayScopedAnnotations(course, day));
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
  const questionLines = questions.map((annotation, index) =>
    annotationLine(
      annotation,
      resourceById.get(annotation.resourceId),
      index + 1,
    ),
  );
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
    sourceDayId: day.id,
    sourceScope: "day",
    title: `${course.shortCode} Day ${day.number} prompt`,
  };
}

export function dayQuestions(course: Course, day: StudyDay): PromptPayload {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const questions = activeQuestions(dayScopedAnnotations(course, day));
  const markdown = [
    `# ${course.title} · Day ${day.number} open questions`,
    "",
    `Topic: ${day.topic || day.title}`,
    "",
    questions.length
      ? questions
          .map((annotation, index) =>
            annotationLine(
              annotation,
              resourceById.get(annotation.resourceId),
              index + 1,
            ),
          )
          .join("\n\n")
      : "No structured open questions are attached to this day.",
  ].join("\n");
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown,
    sourceDayId: day.id,
    sourceScope: "day_questions",
    title: `${course.shortCode} Day ${day.number} questions`,
  };
}

export function allQuestions(course: Course): PromptPayload {
  const resourceById = new Map(
    course.resources.map((resource) => [resource.id, resource]),
  );
  const questions = activeQuestions(course.annotations);
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown: [
      `# ${course.title} · Active questions`,
      "",
      questions.length
        ? questions
            .map((annotation, index) =>
              annotationLine(
                annotation,
                resourceById.get(annotation.resourceId),
                index + 1,
              ),
            )
            .join("\n\n")
        : "No structured open questions.",
    ].join("\n"),
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
): PromptPayload {
  const questions = activeQuestions(
    course.annotations.filter(
      (annotation) => annotation.resourceId === resource.id,
    ),
  );
  return {
    annotationIds: questions.map((annotation) => annotation.id),
    markdown: [
      `# ${course.title} · ${resource.title} questions`,
      "",
      questions.length
        ? questions
            .map((annotation, index) =>
              annotationLine(annotation, resource, index + 1),
            )
            .join("\n\n")
        : "No structured open questions for this resource.",
    ].join("\n"),
    sourceResourceId: resource.id,
    sourceScope: "resource_questions",
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
