import {
  annotationDisplayText,
  metadataText,
} from "../../components/annotations/annotationDisplay";
import type { DiscussionQaSection } from "../../lib/discussionQa";
import type {
  Annotation,
  Discussion,
} from "../../types/tracker";

export type QaReviewItem = {
  id: string;
  questions: Annotation[];
  section?: DiscussionQaSection;
};

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
      id: questions.length
        ? `${section.id}:${questions.map((item) => item.id).join(":")}`
        : `${section.id}:orientation`,
      questions,
      section,
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
    id: `unmapped:${key}`,
    questions,
  }));
  return [...items, ...unmapped];
}
