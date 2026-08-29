import { discussionQaSections } from "./discussionQa";
import type {
  Annotation,
  AnnotationAnswerReference,
  Course,
} from "../types/tracker";
import { trackedQuestionKey } from "./questionIdentity";

function answerReferencesByAnnotation(
  course: Course,
): Map<string, AnnotationAnswerReference[]> {
  const references = new Map<string, AnnotationAnswerReference[]>();
  const annotationById = new Map(
    course.annotations.map((annotation) => [annotation.id, annotation]),
  );

  for (const discussion of course.discussions) {
    const messageById = new Map(
      discussion.messages.map((message) => [message.id, message]),
    );
    for (const section of discussionQaSections(discussion, course.annotations)) {
      if (section.kind === "preamble") continue;
      const message = messageById.get(section.messageId);
      if (!message) continue;
      const sectionQuestionKeys = new Set(
        section.questionIds
          .map((annotationId) => annotationById.get(annotationId))
          .filter((annotation): annotation is Annotation => Boolean(annotation))
          .map(trackedQuestionKey),
      );
      for (const annotationId of section.questionIds) {
        const annotation = annotationById.get(annotationId);
        if (!annotation) continue;
        const questionKey = trackedQuestionKey(annotation);
        const isCanonicalAnswer = message.annotationLinks.some(
          (link) => {
            const linked = annotationById.get(link.annotationId);
            return (
              link.relation === "answers" &&
              Boolean(linked) &&
              trackedQuestionKey(linked!) === questionKey
            );
          },
        );
        if (
          annotation.status !== "answered" ||
          !isCanonicalAnswer ||
          !sectionQuestionKeys.has(questionKey)
        ) continue;
        const reference: AnnotationAnswerReference = {
          discussionId: discussion.id,
          discussionTitle: discussion.title,
          id: section.id,
          markdown: section.bodyMarkdown,
          messageId: section.messageId,
          messageSequenceNumber: section.messageSequenceNumber,
          sectionLabel: section.label,
          title: section.title,
        };
        const current = references.get(questionKey) ?? [];
        if (!current.some((item) => item.id === reference.id)) {
          references.set(questionKey, [...current, reference]);
        }
      }
    }
  }
  return references;
}

function discussionResponseCountsByAnnotation(course: Course): Map<string, number> {
  const annotationById = new Map(
    course.annotations.map((annotation) => [annotation.id, annotation]),
  );
  const sectionIdsByQuestion = new Map<string, Set<string>>();

  for (const discussion of course.discussions) {
    for (const section of discussionQaSections(discussion, course.annotations)) {
      if (section.kind === "preamble") continue;
      for (const annotationId of section.questionIds) {
        const annotation = annotationById.get(annotationId);
        if (!annotation) continue;
        const questionKey = trackedQuestionKey(annotation);
        const current = sectionIdsByQuestion.get(questionKey) ?? new Set<string>();
        current.add(section.id);
        sectionIdsByQuestion.set(questionKey, current);
      }
    }
  }

  return new Map(
    [...sectionIdsByQuestion].map(([questionKey, sectionIds]) => [
      questionKey,
      sectionIds.size,
    ]),
  );
}

/**
 * Attach read-only discussion answer views to every annotation projection.
 * The database remains normalized: the discussion message and its `answers`
 * link are the only persisted answer content and relationship.
 */
export function withQuestionAnswerReferences(course: Course): Course {
  const references = answerReferencesByAnnotation(course);
  const discussionResponseCounts = discussionResponseCountsByAnnotation(course);
  const enrich = (annotation: Annotation): Annotation => ({
    ...annotation,
    answerReferences: references.get(trackedQuestionKey(annotation)) ?? [],
    discussionResponseCount:
      discussionResponseCounts.get(trackedQuestionKey(annotation)) ?? 0,
  });
  return {
    ...course,
    annotations: course.annotations.map(enrich),
    exams: course.exams.map((exam) => ({
      ...exam,
      questions: exam.questions.map((question) => ({
        ...question,
        annotations: question.annotations.map(enrich),
      })),
    })),
    resources: course.resources.map((resource) => ({
      ...resource,
      annotations: resource.annotations.map(enrich),
    })),
  };
}
