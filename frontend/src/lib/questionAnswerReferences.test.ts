import { describe, expect, it } from "vitest";
import type { Annotation, Course, Discussion } from "../types/tracker";
import { withQuestionAnswerReferences } from "./questionAnswerReferences";

function annotation(status: Annotation["status"]): Annotation {
  return {
    anchor: { anchorType: "resource", metadata: {} },
    body: {
      canonicalFormat: "markdown",
      id: "question-body-1",
      markdown: "Why does this converge?",
      plainText: "Why does this converge?",
      revision: 1,
      updatedAt: "2026-08-18T10:00:00Z",
    },
    createdAt: "2026-08-18T10:00:00Z",
    id: "question-1",
    kind: "question",
    notes: [],
    origin: "manual",
    postponed: false,
    priority: "normal",
    resourceId: "book",
    revision: 1,
    status,
    updatedAt: "2026-08-18T10:00:00Z",
  };
}

function courseWith(relation: "answers" | "references", status: Annotation["status"]): Course {
  const question = annotation(status);
  const discussion = {
    id: "discussion-1",
    messages: [
      {
        annotationLinks: [{ annotationId: question.id, relation }],
        body: { markdown: "## Q-001 — Convergence\n\nThe exact tutor answer." },
        createdAt: "2026-08-18T10:01:00Z",
        id: "message-1",
        importedFromClipboard: true,
        replyToMessageId: null,
        revision: 1,
        role: "assistant",
        sequenceNumber: 1,
      },
    ],
    questionIds: [question.id],
    questionLabels: [{ annotationIds: [question.id], label: "Q-001" }],
    title: "Day 8 review",
  } as unknown as Discussion;
  return {
    annotations: [question],
    days: [],
    discussions: [discussion],
    exams: [],
    notes: [],
    resources: [{ id: "book", annotations: [question] }],
    skills: [],
  } as unknown as Course;
}

describe("question answer references", () => {
  it("derives the exact canonical answer after a question is understood", () => {
    const course = withQuestionAnswerReferences(courseWith("answers", "answered"));

    expect(course.annotations[0].answerReferences).toEqual([
      expect.objectContaining({
        discussionId: "discussion-1",
        markdown: "The exact tutor answer.",
        messageId: "message-1",
        sectionLabel: "Q-001",
      }),
    ]);
    expect(course.resources[0].annotations[0].answerReferences).toEqual(
      course.annotations[0].answerReferences,
    );
  });

  it("does not expose a merely referenced or still-open answer", () => {
    const referenced = withQuestionAnswerReferences(
      courseWith("references", "answered"),
    ).annotations[0];
    const stillOpen = withQuestionAnswerReferences(
      courseWith("answers", "open"),
    ).annotations[0];

    expect(referenced.answerReferences).toEqual([]);
    expect(referenced.discussionResponseCount).toBe(1);
    expect(stillOpen.answerReferences).toEqual([]);
    expect(stillOpen.discussionResponseCount).toBe(1);
  });

  it("shares one answer across visual captures with the same stable identity", () => {
    const course = courseWith("answers", "answered");
    const primary = {
      ...course.annotations[0],
      stableLabel: "Q-b-07-008",
    };
    const recolouredCapture = {
      ...primary,
      id: "question-1-recoloured-capture",
    };
    course.annotations = [primary, recolouredCapture];
    course.resources[0].annotations = [primary, recolouredCapture];

    const enriched = withQuestionAnswerReferences(course);

    expect(enriched.annotations[0].discussionResponseCount).toBe(1);
    expect(enriched.annotations[1].discussionResponseCount).toBe(1);
    expect(enriched.annotations[1].answerReferences).toEqual(
      enriched.annotations[0].answerReferences,
    );
  });
});
