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
