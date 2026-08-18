import { discussionQaSections } from "./discussionQa";
import type {
  Annotation,
  AnnotationAnswerReference,
  Course,
} from "../types/tracker";

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
      for (const annotationId of section.questionIds) {
        const annotation = annotationById.get(annotationId);
        const isCanonicalAnswer = message.annotationLinks.some(
          (link) =>
            link.annotationId === annotationId && link.relation === "answers",
        );
        if (annotation?.status !== "answered" || !isCanonicalAnswer) continue;
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
        const current = references.get(annotationId) ?? [];
        if (!current.some((item) => item.id === reference.id)) {
          references.set(annotationId, [...current, reference]);
        }
      }
    }
  }
  return references;
}

/**
 * Attach read-only discussion answer views to every annotation projection.
 * The database remains normalized: the discussion message and its `answers`
 * link are the only persisted answer content and relationship.
 */
export function withQuestionAnswerReferences(course: Course): Course {
  const references = answerReferencesByAnnotation(course);
  const enrich = (annotation: Annotation): Annotation => ({
    ...annotation,
    answerReferences: references.get(annotation.id) ?? [],
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
