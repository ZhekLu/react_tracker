import { describe, expect, it } from "vitest";
import type { Annotation, Course, StudyDay, Task } from "../types/tracker";
import { taskQuestions, taskScopedAnnotations } from "./prompts";

function question(
  id: string,
  resourceId: string,
  chapterNumber?: number,
  createdDayId?: string,
): Annotation {
  return {
    anchor: {
      anchorType: "pdf_rect",
      metadata: {
        chapterNumber,
        createdDayId,
      },
      quote: `Question ${id}`,
    },
    createdAt: "2026-08-19T00:00:00Z",
    discussionResponseCount: 0,
    id,
    kind: "question",
    notes: [],
    origin: "manual",
    postponed: false,
    priority: "normal",
    resourceId,
    revision: 1,
    status: "open",
    updatedAt: "2026-08-19T00:00:00Z",
  };
}

describe("task question prompts", () => {
  it("keeps book questions in the task chapter/day and supports explicit continuations", () => {
    const annotations = [
      question("chapter-7", "book", 7),
      question("future-chapter", "book", 8),
      question("created-today", "book", 8, "day-8"),
      question("lecture-question", "lecture"),
      question("other-resource", "other"),
    ];
    const course = {
      annotations,
      resources: [
        { id: "book", kind: "book", title: "RL Book" },
        { id: "lecture", kind: "slides", title: "Lecture 14" },
        { id: "other", kind: "paper", title: "Other" },
      ],
      shortCode: "TORL",
      title: "Trustworthy Offline RL",
    } as unknown as Course;
    const day = { id: "day-8", number: 8 } as StudyDay;
    const task = {
      chapterNumbers: [7],
      id: "read-chapter-7",
      resourceIds: ["book", "lecture"],
      title: "Read chapter 7",
    } as Task;

    expect(
      taskScopedAnnotations(course, day, task).map((item) => item.id),
    ).toEqual(["chapter-7", "created-today", "lecture-question"]);

    const payload = taskQuestions(course, day, task, {
      annotationIds: ["created-today", "lecture-question"],
      parentDiscussionId: "day-8-discussion",
      questionLabelStart: 21,
      questionLabels: {
        "created-today": "Q-021",
        "lecture-question": "Q-022",
      },
      unansweredOnly: true,
    });
    expect(payload.annotationIds).toEqual(["created-today", "lecture-question"]);
    expect(payload.markdown).toContain("Q-021");
    expect(payload.markdown).toContain("Q-022");
    expect(payload.markdown).not.toContain("Q-023");
    expect(payload.parentDiscussionId).toBe("day-8-discussion");
  });
});
