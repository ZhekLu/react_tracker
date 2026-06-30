import type {
  Annotation,
  Course,
  Note,
  Resource,
  StudyDay,
} from "../types/tracker";

export type PromptPayload = {
  title: string;
  sourceScope: string;
  markdown: string;
  annotationIds?: string[];
  sourceDayId?: string;
  sourceResourceId?: string;
  sourceTaskId?: string;
};

function noteText(notes: Note[]): string {
  return notes
    .map((note) => note.document.plainText.trim())
    .filter(Boolean)
    .join("\n\n");
}

function activeQuestions(annotations: Annotation[]): Annotation[] {
  return annotations.filter(
    (annotation) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open",
  );
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
  return [
    `### Q-${String(index).padStart(3, "0")} · ${location || "Tracker question"}`,
    `Tracker annotation ID: ${annotation.id}`,
    quote ? `> ${quote}` : "",
    body || "This item was flagged as an open question.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function dayPrompt(course: Course, day: StudyDay): PromptPayload {
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
  const questions = activeQuestions(
    course.annotations.filter((annotation) =>
      resourceIds.has(annotation.resourceId),
    ),
  );
  const sections = day.sections.map((section) => {
    const taskLines = section.tasks.map((task) => {
      const linked = task.resourceIds
        .map((resourceId) => resourceById.get(resourceId)?.title)
        .filter(Boolean)
        .join(", ");
      const notes = noteText(task.notes);
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
    "Guide me through this day in task order. Use my progress and notes, answer the open questions, and keep the work scoped to the stated stop condition.",
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
  const resourceIds = new Set(
    day.sections.flatMap((section) =>
      section.tasks.flatMap((task) => task.resourceIds),
    ),
  );
  const questions = activeQuestions(
    course.annotations.filter((annotation) =>
      resourceIds.has(annotation.resourceId),
    ),
  );
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
    (resource) => resource.kind !== "exam_question",
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
