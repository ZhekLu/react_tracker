import { describe, expect, it } from "vitest";
import type { Annotation, Course, Resource, StudyDay, Task } from "../types/tracker";
import {
  resourceQuestions,
  resourceScopedAnnotations,
  taskQuestions,
  taskScopedAnnotations,
} from "./prompts";

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

  it("uses the immutable readable identity without renumbering a later prompt", () => {
    const first = question("first", "book", 5);
    first.stableLabel = "Q-b-05-004";
    const second = question("second", "book", 5);
    second.stableLabel = "Q-b-05-009";
    const course = {
      annotations: [first, second],
      resources: [{ id: "book", kind: "book", title: "RL Book" }],
      shortCode: "TORL",
      title: "Trustworthy Offline RL",
    } as unknown as Course;
    const day = { id: "day-5", number: 5 } as StudyDay;
    const task = {
      chapterNumbers: [5],
      id: "read-chapter-5",
      resourceIds: ["book"],
      title: "Read chapter 5",
    } as Task;

    const payload = taskQuestions(course, day, task, {
      annotationIds: [second.id],
      unansweredOnly: true,
    });

    expect(payload.markdown).toContain("### Q-b-05-009");
    expect(payload.markdown).not.toContain("Q-001");
    expect(payload.questionLabels).toEqual({ second: "Q-b-05-009" });
  });
});

describe("resource question prompts", () => {
  it("collects a resource family and orders book questions by chapter and page", () => {
    const late = question("late", "book-cloud", 7);
    late.anchor = { ...late.anchor!, pageNumber: 170 };
    const early = question("early", "book", 6);
    early.anchor = { ...early.anchor!, pageNumber: 145 };
    const middle = question("middle", "book-cloud", 7);
    middle.anchor = { ...middle.anchor!, pageNumber: 160 };
    const answered = question("answered", "book", 5);
    answered.discussionResponseCount = 1;
    const book = {
      chapters: [
        { number: 6, title: "Temporal-Difference Learning" },
        { number: 7, title: "n-step Bootstrapping" },
      ],
      id: "book",
      kind: "book",
      title: "RL Book",
    } as Resource;
    const course = {
      annotations: [late, answered, middle, early],
      resources: [
        book,
        { id: "book-cloud", kind: "book", parentResourceId: "book", title: "RL Book cloud" },
      ],
      shortCode: "TORL",
      title: "Trustworthy Offline RL",
    } as unknown as Course;

    expect(resourceScopedAnnotations(course, book).map((item) => item.id)).toEqual([
      "answered",
      "early",
      "middle",
      "late",
    ]);

    const payload = resourceQuestions(course, book, {
      annotationIds: [late.id, early.id, middle.id],
      parentDiscussionId: "book-discussion",
      questionLabels: {
        early: "Q-006",
        late: "Q-008",
        middle: "Q-007",
      },
      unansweredOnly: true,
    });
    expect(payload.annotationIds).toEqual(["early", "middle", "late"]);
    expect(payload.sourceScope).toBe("resource_questions_continuation");
    expect(payload.markdown.indexOf("Chapter 6")).toBeLessThan(
      payload.markdown.indexOf("Chapter 7"),
    );
    expect(payload.markdown.indexOf("Q-007")).toBeLessThan(
      payload.markdown.indexOf("Q-008"),
    );
  });

  it("copies one logical question with every companion capture", () => {
    const first = question("first-capture", "book", 11);
    const second = question("second-capture", "book", 11);
    first.stableLabel = "Q-b-11-007";
    second.stableLabel = "Q-b-11-007";
    first.anchor!.metadata.contextGroupId = "shared-question";
    second.anchor!.metadata.contextGroupId = "shared-question";
    const book = {
      chapters: [{ number: 11, title: "Off-policy Methods" }],
      id: "book",
      kind: "book",
      title: "RL Book",
    } as Resource;
    const course = {
      annotations: [first, second],
      resources: [book],
      shortCode: "TORL",
      title: "Trustworthy Offline RL",
    } as unknown as Course;

    const payload = resourceQuestions(course, book, {
      parentDiscussionId: "book-discussion",
      unansweredOnly: true,
    });

    expect(payload.annotationIds).toEqual([first.id, second.id]);
    expect(payload.questionLabels).toEqual({
      [first.id]: "Q-b-11-007",
      [second.id]: "Q-b-11-007",
    });
    expect(payload.markdown.match(/^### Q-b-11-007/gm)).toHaveLength(1);
    expect(payload.markdown).toContain(first.id);
    expect(payload.markdown).toContain(second.id);
  });
});
