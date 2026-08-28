import {
  annotationDisplayText,
  metadataText,
} from "../../components/annotations/annotationDisplay";
import {
  discussionQaSections,
  type DiscussionQaSection,
} from "../../lib/discussionQa";
import type {
  Annotation,
  Discussion,
  Note,
} from "../../types/tracker";

export function centeredQaSourceScrollTop(input: {
  currentScrollTop: number;
  viewportTop: number;
  viewportHeight: number;
  currentTop: number;
  currentBottom: number;
  focusRects: Array<{ top: number; bottom: number }>;
}): number {
  const visibleFocusRects = input.focusRects.filter(
    (rect) => rect.bottom > rect.top,
  );
  const focusTop = visibleFocusRects.length
    ? Math.min(...visibleFocusRects.map((rect) => rect.top))
    : input.currentTop;
  const focusBottom = visibleFocusRects.length
    ? Math.max(...visibleFocusRects.map((rect) => rect.bottom))
    : input.currentBottom;
  const focusHeight = Math.max(1, focusBottom - focusTop);
  const centeredOffset = Math.max(
    8,
    (input.viewportHeight - Math.min(focusHeight, input.viewportHeight)) / 2,
  );
  return Math.max(
    0,
    input.currentScrollTop + focusTop - input.viewportTop - centeredOffset,
  );
}

export type QaReviewItem = {
  answers?: Array<{
    discussionId: string;
    section: DiscussionQaSection;
  }>;
  id: string;
  questions: Annotation[];
  rootQuestions?: Annotation[];
  section?: DiscussionQaSection;
  sectionDiscussionId?: string;
};

export type QaReviewFilter = "all" | "open" | "new";

export type QaReviewRecord = Discussion["qaReviews"][number] & {
  discussionId: string;
};

export type QaReviewStatus =
  | "new"
  | "updated"
  | "viewed"
  | "understood"
  | "skipped";

/**
 * Fingerprint one parsed answer section, not its containing tutor message.
 *
 * Message revisions are intentionally excluded: editing Q-001 in a response
 * must not make Q-002..Q-020 appear updated. FNV-1a is sufficient here because
 * this is a change detector, not an identity or a security boundary.
 */
export function qaSectionFingerprint(section: DiscussionQaSection): string {
  const value = [
    "qa-section-v1",
    section.id,
    section.headingLine.trim(),
    section.bodyMarkdown.replace(/\r\n?/g, "\n").trim(),
  ].join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function activeQuestion(question: Annotation): boolean {
  return (
    question.status === "open" &&
    !question.postponed &&
    !question.skipped
  );
}

function reviewMatchesSection(
  review: QaReviewRecord,
  item: QaReviewItem,
): boolean {
  const section = item.section;
  if (!section || review.discussionId !== item.sectionDiscussionId) return false;
  if (review.sectionId && review.sectionFingerprint) {
    return (
      review.sectionId === section.id &&
      review.sectionFingerprint === qaSectionFingerprint(section)
    );
  }
  // A legacy record can only prove that the exact source message was viewed.
  // It is deliberately not invalidated by another discussion's message.
  return review.messageId === section.messageId;
}

export function qaReviewStatus(
  item: QaReviewItem | undefined,
  reviews: readonly QaReviewRecord[],
  visited = false,
): QaReviewStatus {
  if (!item) return "new";
  const unresolved = item.questions.filter(
    (question) => question.status !== "answered" && question.status !== "archived",
  );
  if (unresolved.length > 0 && unresolved.every((question) => question.skipped)) {
    return "skipped";
  }
  if (
    item.questions.length > 0 &&
    item.questions.every(
      (question) => question.status === "answered" || question.status === "archived",
    )
  ) {
    return "understood";
  }
  const active = item.questions.filter(activeQuestion);
  const matchingIds = new Set(
    reviews
      .filter((review) => reviewMatchesSection(review, item))
      .map((review) => review.annotationId),
  );
  const current =
    active.length > 0 && active.every((question) => matchingIds.has(question.id));
  if (visited || current) return "viewed";
  const hasPriorReview = reviews.some((review) =>
    item.questions.some((question) => question.id === review.annotationId),
  );
  const hasFollowup = item.questions.some(
    (question) => question.origin === "discussion_review_followup",
  );
  const hasAnotherAnswer = (item.answers?.length ?? 0) > 1;
  return hasPriorReview || hasFollowup || hasAnotherAnswer ? "updated" : "new";
}

export function qaReviewItemVisible(
  item: QaReviewItem,
  filter: QaReviewFilter,
  reviews: readonly QaReviewRecord[],
  visited = false,
): boolean {
  if (filter === "all") return true;
  if (!item.questions.length) return true;
  if (!item.questions.some(activeQuestion)) return false;
  if (filter === "open") return true;
  const status = qaReviewStatus(item, reviews, visited);
  return status === "new" || status === "updated";
}

function compareAnswerRecords(
  left: { section: DiscussionQaSection },
  right: { section: DiscussionQaSection },
  messageCreatedAt: ReadonlyMap<string, string>,
): number {
  return (
    (messageCreatedAt.get(left.section.messageId) ?? "").localeCompare(
      messageCreatedAt.get(right.section.messageId) ?? "",
    ) ||
    left.section.messageSequenceNumber - right.section.messageSequenceNumber ||
    left.section.sectionOrder - right.section.sectionOrder ||
    left.section.id.localeCompare(right.section.id)
  );
}

function rootQuestionIds(
  annotation: Annotation,
  annotationById: Map<string, Annotation>,
  seen = new Set<string>(),
): string[] {
  if (seen.has(annotation.id)) return [];
  seen.add(annotation.id);
  const stored = annotation.anchor?.metadata?.rootQuestionIds;
  if (Array.isArray(stored)) {
    const ids = stored.filter(
      (id): id is string => typeof id === "string" && annotationById.has(id),
    );
    if (ids.length) {
      return [...new Set(
        ids.flatMap((id) => {
          const root = annotationById.get(id);
          return root ? rootQuestionIds(root, annotationById, new Set(seen)) : [];
        }),
      )];
    }
  }
  return annotation.origin === "discussion_review_followup" ? [] : [annotation.id];
}

function comparableSelection(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\[a-z]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

class QuestionComponents {
  private readonly parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    this.add(id);
    const parent = this.parent.get(id)!;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(ids: string[]) {
    if (!ids.length) return;
    const root = this.find(ids[0]);
    ids.slice(1).forEach((id) => this.parent.set(this.find(id), root));
  }
}

export function inferredExerciseLabels(item: QaReviewItem): string[] {
  const candidates = [
    item.section?.title ?? "",
    item.section?.bodyMarkdown ?? "",
    ...item.questions.flatMap((question) => [
      annotationDisplayText(question),
      question.anchor?.sectionTitle ?? "",
      metadataText(question, "contextParagraph"),
    ]),
  ];
  const labels: string[] = [];
  for (const candidate of candidates) {
    for (const match of candidate.matchAll(/\bExercise\s+(\d+(?:\.\d+)+)\b/gi)) {
      const label = `Exercise ${match[1]}`;
      if (!labels.includes(label)) labels.push(label);
    }
    for (const group of candidate.matchAll(/\bExercises?\s+([^\n]+)/gi)) {
      for (const match of group[1].matchAll(/\d+(?:\.\d+)+/g)) {
        const label = `Exercise ${match[0]}`;
        if (!labels.includes(label)) labels.push(label);
      }
    }
  }
  return labels.length ? labels : ["Exercise"];
}

/** Exact persisted exercise mapping; matching tutor prose is never a link. */
export function exerciseSolutionNoteMatches(
  note: Note,
  item: QaReviewItem,
  exerciseLabels: readonly string[],
): boolean {
  if (note.kind !== "exercise_solution") return false;
  if (item.questions.length > 0) {
    const questionIds = new Set(item.questions.map((question) => question.id));
    return note.links.some(
      (link) =>
        link.entityType === "annotation" && questionIds.has(link.entityId),
    );
  }
  return (
    Boolean(item.section?.messageId) &&
    note.links.some(
      (link) =>
        link.entityType === "discussion_message" &&
        link.entityId === item.section?.messageId,
    ) &&
    exerciseLabels.every((label) =>
      (note.document.markdown ?? note.document.plainText).includes(label),
    )
  );
}

export function sourceQuestionForReview(
  questions: Annotation[],
): Annotation | undefined {
  return (
    questions.find(
      (item) =>
        Boolean(item.anchor?.quote?.trim()) ||
        !annotationDisplayText(item).startsWith("Screenshot ·"),
    ) ??
    questions.find((item) =>
      Boolean(metadataText(item, "annotatedPageImageUrl")),
    ) ??
    questions.find((item) => metadataText(item, "contextImageUrl")) ??
    questions[0]
  );
}

export function qaReviewItems(
  sections: DiscussionQaSection[],
  annotationById: Map<string, Annotation>,
  discussion: Discussion,
  includeUnmapped = true,
): QaReviewItem[] {
  const mappedQuestionIds = new Set<string>();
  const items = sections.flatMap((section) => {
    const questions = section.questionIds
      .map((id) => annotationById.get(id))
      .filter((item): item is Annotation => Boolean(item));
    questions.forEach((question) => mappedQuestionIds.add(question.id));
    return [{
      answers: [{ discussionId: discussion.id, section }],
      id: questions.length
        ? `${section.id}:${questions.map((item) => item.id).join(":")}`
        : `${section.id}:orientation`,
      questions,
      rootQuestions: questions.filter(
        (question) => question.origin !== "discussion_review_followup",
      ),
      section,
      sectionDiscussionId: discussion.id,
    }];
  });
  if (!includeUnmapped) return items;
  const unmappedQuestions = discussion.questionIds
    .filter((id) => !mappedQuestionIds.has(id))
    .map((id) => annotationById.get(id))
    .filter(
      (item): item is Annotation =>
        Boolean(item && ["question", "todo"].includes(item.kind)),
    );
  const unmapped = [
    ...unmappedQuestions
      .reduce((groups, question) => {
        const contextGroup = metadataText(question, "contextGroupId");
        const key = contextGroup
          ? `${question.resourceId}:${contextGroup}`
          : `annotation:${question.id}`;
        const current = groups.get(key) ?? [];
        current.push(question);
        groups.set(key, current);
        return groups;
      }, new Map<string, Annotation[]>())
      .entries(),
  ].map(([key, questions]) => ({
    answers: [],
    id: `unmapped:${key}`,
    questions,
    rootQuestions: questions,
  }));
  return [...items, ...unmapped];
}

/** Build one review unit per root-question thread, across response rounds. */
export function qaReviewThreads(
  discussions: Discussion[],
  annotations: Annotation[],
  activeDiscussion: Discussion,
  scopedQuestionIds?: readonly string[],
): QaReviewItem[] {
  const annotationById = new Map(annotations.map((item) => [item.id, item]));
  const messageCreatedAt = new Map(
    discussions.flatMap((discussion) =>
      discussion.messages.map((message) => [message.id, message.createdAt] as const),
    ),
  );
  const allSectionRecords = discussions.flatMap((discussion) =>
    discussionQaSections(discussion, annotations)
      .map((section) => ({ discussionId: discussion.id, section })),
  );
  const sectionRecords = allSectionRecords.filter(
    ({ section }) => section.questionIds.length > 0,
  );
  const rootsByAnnotationId = new Map<string, string[]>();
  annotations.forEach((annotation) => {
    rootsByAnnotationId.set(
      annotation.id,
      rootQuestionIds(annotation, annotationById),
    );
  });
  // A follow-up is a child of the answer section it comments on. New captures
  // persist rootQuestionIds directly; for already-created captures, recover the
  // same relation from the immutable parent message + selected answer text.
  // This is a structural join, never a global Q-label join.
  annotations
    .filter(
      (annotation) =>
        annotation.origin === "discussion_review_followup" &&
        !(rootsByAnnotationId.get(annotation.id) ?? []).length &&
        Boolean(annotation.anchor?.discussionMessageId),
    )
    .forEach((annotation) => {
      const selection = comparableSelection(annotation.anchor?.quote ?? "");
      if (!selection) return;
      const parentSections = sectionRecords.filter(
        ({ section }) =>
          section.messageId === annotation.anchor?.discussionMessageId,
      );
      const parent = parentSections.find(({ section }) => {
        const body = comparableSelection(section.bodyMarkdown);
        return (
          body.includes(selection) ||
          (selection.length > 48 && body.includes(selection.slice(0, 96)))
        );
      });
      if (!parent) return;
      const inferredRoots = [...new Set(
        parent.section.questionIds.flatMap(
          (id) => rootsByAnnotationId.get(id) ?? [],
        ),
      )];
      if (inferredRoots.length) {
        rootsByAnnotationId.set(annotation.id, inferredRoots);
      }
    });

  const components = new QuestionComponents();
  sectionRecords.forEach(({ section }) => {
    const roots = [...new Set(
      section.questionIds.flatMap((id) => rootsByAnnotationId.get(id) ?? []),
    )];
    roots.forEach((id) => components.add(id));
    components.union(roots);
  });

  const promptQuestionIds = activeDiscussion.questionLabels.flatMap(
    (item) => item.annotationIds,
  );
  const immutableScopeIds = scopedQuestionIds?.length
    ? [...scopedQuestionIds]
    : promptQuestionIds.length
      ? promptQuestionIds
      : activeDiscussion.questionIds;
  const scopedOrderById = new Map(
    immutableScopeIds.map((id, index) => [id, index]),
  );
  const activeSectionQuestionIds = sectionRecords
    .filter(({ discussionId }) => discussionId === activeDiscussion.id)
    .flatMap(({ section }) => section.questionIds);
  const mappedFollowupIds = activeSectionQuestionIds.filter(
    (id) =>
      annotationById.get(id)?.origin === "discussion_review_followup" &&
      (rootsByAnnotationId.get(id) ?? []).length > 0,
  );
  // Prompt-batch items are the immutable boundary. Historical message links and
  // the denormalized discussion.questionIds list can contain captures imported
  // by older mapping code, so neither is allowed to expand the session. A
  // follow-up may expand it only when an answer section in this discussion was
  // structurally mapped to that follow-up's UUID. This supports a later response
  // round whose parent answer lives in another discussion without trusting a
  // reused Q-### display label or a stale annotation link.
  const activeQuestionIds = new Set([
    ...immutableScopeIds,
    ...mappedFollowupIds,
  ]);
  const activeRoots = new Set(
    [...activeQuestionIds].flatMap((id) => rootsByAnnotationId.get(id) ?? []),
  );
  const parentResponseMessageIds = new Set(
    [...activeQuestionIds]
      .map((id) => annotationById.get(id))
      .filter(
        (annotation): annotation is Annotation =>
          annotation?.origin === "discussion_review_followup",
      )
      .map((annotation) => annotation.anchor?.discussionMessageId)
      .filter((id): id is string => Boolean(id)),
  );
  sectionRecords
    .filter(({ section }) => parentResponseMessageIds.has(section.messageId))
    .forEach(({ section }) =>
      section.questionIds.forEach((id) =>
        (rootsByAnnotationId.get(id) ?? []).forEach((rootId) =>
          activeRoots.add(rootId),
        ),
      ),
    );
  const groupedRoots = new Map<string, string[]>();
  activeRoots.forEach((rootId) => {
    const key = components.find(rootId);
    const current = groupedRoots.get(key) ?? [];
    current.push(rootId);
    groupedRoots.set(key, current);
  });

  const questionThreads = [...groupedRoots.entries()]
    .map(([componentId, rootIds]) => {
      const componentRootIds = [...new Set(rootIds)];
      const rootQuestions = componentRootIds
        .map((id) => annotationById.get(id))
        .filter((item): item is Annotation => Boolean(item));
      const followups = annotations.filter(
        (annotation) =>
          annotation.origin === "discussion_review_followup" &&
          annotation.status !== "archived" &&
          (rootsByAnnotationId.get(annotation.id) ?? []).some((id) =>
            componentRootIds.includes(id),
          ),
      );
      const answers = sectionRecords
        .filter(({ section }) =>
          section.questionIds.some((id) =>
            (rootsByAnnotationId.get(id) ?? []).some((rootId) =>
              componentRootIds.includes(rootId),
            ),
          ),
        )
        .sort((left, right) =>
          compareAnswerRecords(left, right, messageCreatedAt),
        );
      const latest = answers.at(-1);
      return {
        answers,
        id: `thread:${componentId}`,
        questions: [...rootQuestions, ...followups].filter(
          (question, index, all) =>
            all.findIndex((candidate) => candidate.id === question.id) === index,
        ),
        rootQuestions,
        section: latest?.section,
        sectionDiscussionId: latest?.discussionId,
      } satisfies QaReviewItem;
    })
    .filter((item) => item.answers.length > 0)
    .sort((left, right) => {
      if (scopedQuestionIds?.length) {
        const position = (item: QaReviewItem) =>
          Math.min(
            Number.MAX_SAFE_INTEGER,
            ...(item.rootQuestions ?? item.questions).map(
              (question) => scopedOrderById.get(question.id) ?? Number.MAX_SAFE_INTEGER,
            ),
          );
        const scopeDifference = position(left) - position(right);
        if (scopeDifference) return scopeDifference;
      }
      const leftAnswer = left.answers[0];
      const rightAnswer = right.answers[0];
      return leftAnswer && rightAnswer
        ? compareAnswerRecords(leftAnswer, rightAnswer, messageCreatedAt)
        : left.id.localeCompare(right.id);
    });
  // Tutor replies about exercises are useful even when the prompt was a free-form
  // request rather than a Q-### batch. Keep those sections in the active QA
  // session so they can be reviewed and mapped to the exercise task.
  const mappedActiveSectionIds = new Set(
    questionThreads.flatMap((item) =>
      (item.answers ?? []).map((answer) => answer.section.id),
    ),
  );
  const exerciseSections = scopedQuestionIds?.length ? [] : allSectionRecords
    .filter(
      ({ discussionId, section }) =>
        discussionId === activeDiscussion.id &&
        !section.questionIds.length &&
        !mappedActiveSectionIds.has(section.id) &&
        /\bExercises?\s+\d+(?:\.\d+)+/i.test(
          `${section.title}\n${section.bodyMarkdown}`,
        ),
    )
    .map(({ discussionId, section }) => ({
      answers: [{ discussionId, section }],
      id: `exercise-section:${section.id}`,
      questions: [],
      rootQuestions: [],
      section,
      sectionDiscussionId: discussionId,
    } satisfies QaReviewItem));
  return [...questionThreads, ...exerciseSections].sort((left, right) => {
    if (scopedQuestionIds?.length) {
      const position = (item: QaReviewItem) =>
        Math.min(
          Number.MAX_SAFE_INTEGER,
          ...(item.rootQuestions ?? item.questions).map(
            (question) => scopedOrderById.get(question.id) ?? Number.MAX_SAFE_INTEGER,
          ),
        );
      const scopeDifference = position(left) - position(right);
      if (scopeDifference) return scopeDifference;
    }
    const leftAnswer = left.answers?.[0];
    const rightAnswer = right.answers?.[0];
    return leftAnswer && rightAnswer
      ? compareAnswerRecords(leftAnswer, rightAnswer, messageCreatedAt)
      : left.id.localeCompare(right.id);
  });
}
