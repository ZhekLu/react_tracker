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
} from "../../types/tracker";

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
): QaReviewItem[] {
  const annotationById = new Map(annotations.map((item) => [item.id, item]));
  const messageCreatedAt = new Map(
    discussions.flatMap((discussion) =>
      discussion.messages.map((message) => [message.id, message.createdAt] as const),
    ),
  );
  const sectionRecords = discussions.flatMap((discussion) =>
    discussionQaSections(discussion, annotations)
      .filter((section) => section.questionIds.length > 0)
      .map((section) => ({ discussionId: discussion.id, section })),
  );
  const rootsByAnnotationId = new Map<string, string[]>();
  annotations.forEach((annotation) => {
    rootsByAnnotationId.set(
      annotation.id,
      rootQuestionIds(annotation, annotationById),
    );
  });

  const components = new QuestionComponents();
  sectionRecords.forEach(({ section }) => {
    const roots = [...new Set(
      section.questionIds.flatMap((id) => rootsByAnnotationId.get(id) ?? []),
    )];
    roots.forEach((id) => components.add(id));
    components.union(roots);
  });

  const activeQuestionIds = new Set([
    ...activeDiscussion.questionIds,
    ...activeDiscussion.questionLabels.flatMap((item) => item.annotationIds),
    ...activeDiscussion.messages.flatMap((message) =>
      message.annotationLinks.map((link) => link.annotationId),
    ),
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

  return [...groupedRoots.entries()]
    .map(([componentId, rootIds]) => {
      const componentRootIds = [...new Set(rootIds)];
      const rootQuestions = componentRootIds
        .map((id) => annotationById.get(id))
        .filter((item): item is Annotation => Boolean(item));
      const followups = annotations.filter(
        (annotation) =>
          annotation.origin === "discussion_review_followup" &&
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
        .sort(
          (left, right) =>
            (messageCreatedAt.get(left.section.messageId) ?? "").localeCompare(
              messageCreatedAt.get(right.section.messageId) ?? "",
            ) || left.section.id.localeCompare(right.section.id),
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
      const leftAnswer = left.answers.at(-1)?.section;
      const rightAnswer = right.answers.at(-1)?.section;
      return (
        (messageCreatedAt.get(leftAnswer?.messageId ?? "") ?? "").localeCompare(
          messageCreatedAt.get(rightAnswer?.messageId ?? "") ?? "",
        ) || left.id.localeCompare(right.id)
      );
    });
}
