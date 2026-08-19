import { describe, expect, it } from "vitest";
import type { Annotation, Discussion } from "../../types/tracker";
import type { DiscussionQaSection } from "../../lib/discussionQa";
import {
  inferredExerciseLabels,
  qaReviewItems,
  qaReviewThreads,
  sourceQuestionForReview,
} from "./discussionQaReviewModel";

function annotation(
  id: string,
  overrides: Partial<Annotation> = {},
): Annotation {
  return {
    createdAt: "2026-07-23T00:00:00Z",
    id,
    kind: "question",
    notes: [],
    origin: "drawboard_cloud",
    postponed: false,
    priority: "normal",
    resourceId: "book",
    revision: 1,
    status: "open",
    updatedAt: "2026-07-23T00:00:00Z",
    ...overrides,
  };
}

describe("focused discussion QA review units", () => {
  it("reviews a screenshot capture and its text capture as one answer group", () => {
    const textQuestion = annotation("text-question", {
      anchor: {
        anchorType: "pdf_rect",
        metadata: { contextGroupId: "paragraph-1" },
        pageNumber: 115,
      },
    });
    const screenshotQuestion = annotation("screenshot-question", {
      anchor: {
        anchorType: "pdf_rect",
        metadata: {
          contextGroupId: "paragraph-1",
          contextImageUrl: "/image",
        },
        pageNumber: 115,
      },
      origin: "drawboard_cloud_ink",
    });
    const section = {
      id: "answer-1",
      messageId: "message-1",
      questionIds: [textQuestion.id, screenshotQuestion.id],
    } as DiscussionQaSection;
    const discussion = {
      questionIds: [textQuestion.id, screenshotQuestion.id],
    } as unknown as Discussion;

    const items = qaReviewItems(
      [section],
      new Map([
        [textQuestion.id, textQuestion],
        [screenshotQuestion.id, screenshotQuestion],
      ]),
      discussion,
    );

    expect(items).toHaveLength(1);
    expect(items[0].questions.map((item) => item.id)).toEqual([
      "text-question",
      "screenshot-question",
    ]);
  });

  it("groups unmapped companion captures by PDF paragraph", () => {
    const questions = ["text", "ink"].map(
      (id) =>
        annotation(id, {
          anchor: {
            anchorType: "pdf_rect",
            metadata: { contextGroupId: "paragraph-2" },
            pageNumber: 116,
          },
        }),
    );
    const discussion = { questionIds: questions.map((item) => item.id) } as Discussion;

    const items = qaReviewItems(
      [],
      new Map(questions.map((item) => [item.id, item])),
      discussion,
    );

    expect(items).toHaveLength(1);
    expect(items[0].questions).toHaveLength(2);
  });

  it("uses the textual capture as the canonical source page", () => {
    const screenshot = annotation("screenshot", {
      anchor: {
        anchorType: "pdf_rect",
        metadata: { contextImageUrl: "/crop.png" },
        pageNumber: 104,
      },
      body: {
        canonicalFormat: "markdown",
        id: "screenshot-body",
        plainText: "Screenshot · Monte Carlo Prediction",
        revision: 1,
        updatedAt: "2026-07-23T00:00:00Z",
      },
    });
    const textQuestion = annotation("text", {
      anchor: {
        anchorType: "pdf_rect",
        metadata: { annotatedPageImageUrl: "/page-115.png" },
        pageNumber: 115,
        quote: "converge quadratically",
      },
    });

    expect(sourceQuestionForReview([screenshot, textQuestion])?.id).toBe("text");
  });

  it("detects every exercise answered inside one tutor section", () => {
    const item = {
      id: "answer-two-exercises",
      questions: [annotation("exercise-question")],
      section: {
        bodyMarkdown:
          "### Exercise 6.2\n\nFirst answer.\n\n### Exercise 6.6\n\nSecond answer.",
        title: "Exercises 6.2 and 6.6",
      } as DiscussionQaSection,
    };

    expect(inferredExerciseLabels(item)).toEqual([
      "Exercise 6.2",
      "Exercise 6.6",
    ]);
  });

  it("keeps original and follow-up answers in one root-question thread", () => {
    const root = annotation("root-question");
    const followup = annotation("followup-question", {
      anchor: {
        anchorType: "discussion_selection",
        discussionMessageId: "message-1",
        metadata: { rootQuestionIds: [root.id], sectionLabel: "Q-001" },
        quote: "Earlier tutor text",
      },
      origin: "discussion_review_followup",
    });
    const first = {
      id: "discussion-1",
      messages: [{
        annotationLinks: [{ annotationId: root.id, relation: "answers" }],
        body: { markdown: "## Q-001\n\nFirst answer." },
        createdAt: "2026-07-23T01:00:00Z",
        id: "message-1",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [root.id],
      questionLabels: [{ annotationIds: [root.id], label: "Q-001" }],
    } as unknown as Discussion;
    const second = {
      id: "discussion-2",
      messages: [{
        annotationLinks: [{ annotationId: followup.id, relation: "answers" }],
        body: { markdown: "## Q-098\n\nUpdated answer." },
        createdAt: "2026-07-23T02:00:00Z",
        id: "message-2",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [followup.id],
      questionLabels: [{ annotationIds: [followup.id], label: "Q-098" }],
    } as unknown as Discussion;

    const threads = qaReviewThreads([first, second], [root, followup], second);

    expect(threads).toHaveLength(1);
    expect(threads[0].rootQuestions?.map((item) => item.id)).toEqual([root.id]);
    expect(threads[0].questions.map((item) => item.id)).toEqual([
      root.id,
      followup.id,
    ]);
    expect(threads[0].answers?.map((item) => item.section.bodyMarkdown)).toEqual([
      "First answer.",
      "Updated answer.",
    ]);
  });

  it("keeps tutor response order after an earlier question receives an update", () => {
    const firstRoot = annotation("z-first-root", { status: "answered" });
    const secondRoot = annotation("a-second-root");
    const thirdRoot = annotation("m-third-root");
    const followup = annotation("followup-to-first", {
      anchor: {
        anchorType: "discussion_selection",
        discussionMessageId: "original-response",
        metadata: { rootQuestionIds: [firstRoot.id], sectionLabel: "Q-001" },
        quote: "First answer.",
      },
      origin: "discussion_review_followup",
    });
    const original = {
      id: "original",
      messages: [{
        annotationLinks: [firstRoot, secondRoot, thirdRoot].map((question) => ({
          annotationId: question.id,
          relation: "answers",
        })),
        body: {
          markdown: [
            "## Q-001\n\nFirst answer.",
            "## Q-002\n\nSecond answer.",
            "## Q-003\n\nThird answer.",
          ].join("\n\n"),
        },
        createdAt: "2026-07-23T01:00:00Z",
        id: "original-response",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [{
        annotationId: firstRoot.id,
        messageId: "original-response",
        messageRevision: 1,
        viewedAt: "2026-07-23T01:30:00Z",
      }],
      questionIds: [firstRoot.id, secondRoot.id, thirdRoot.id],
      questionLabels: [
        { annotationIds: [firstRoot.id], label: "Q-001" },
        { annotationIds: [secondRoot.id], label: "Q-002" },
        { annotationIds: [thirdRoot.id], label: "Q-003" },
      ],
    } as unknown as Discussion;
    const update = {
      id: "update",
      messages: [{
        annotationLinks: [{ annotationId: followup.id, relation: "answers" }],
        body: { markdown: "## Q-101\n\nUpdated first answer." },
        createdAt: "2026-07-23T02:00:00Z",
        id: "update-response",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [followup.id],
      questionLabels: [{ annotationIds: [followup.id], label: "Q-101" }],
    } as unknown as Discussion;

    const threads = qaReviewThreads(
      [original, update],
      [firstRoot, secondRoot, thirdRoot, followup],
      update,
    );

    expect(threads.map((item) => item.rootQuestions?.[0].id)).toEqual([
      firstRoot.id,
      secondRoot.id,
      thirdRoot.id,
    ]);
    expect(threads[0].answers?.map((answer) => answer.section.bodyMarkdown)).toEqual([
      "First answer.",
      "Updated first answer.",
    ]);
  });

  it("recovers a parent thread from the selected answer when roots were not stored", () => {
    const root = annotation("root-question");
    const followup = annotation("legacy-followup", {
      anchor: {
        anchorType: "discussion_selection",
        discussionMessageId: "message-1",
        metadata: {},
        quote: "The target itself keeps changing randomly.",
      },
      origin: "discussion_review_followup",
    });
    const first = {
      id: "discussion-1",
      messages: [{
        annotationLinks: [{ annotationId: root.id, relation: "answers" }],
        body: {
          markdown: "## Q-001\n\nThe target itself keeps changing randomly.",
        },
        createdAt: "2026-07-23T01:00:00Z",
        id: "message-1",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [root.id],
      questionLabels: [{ annotationIds: [root.id], label: "Q-001" }],
    } as unknown as Discussion;
    const second = {
      id: "discussion-2",
      messages: [{
        annotationLinks: [{ annotationId: followup.id, relation: "answers" }],
        body: { markdown: "## Q-098\n\nThe refined answer." },
        createdAt: "2026-07-23T02:00:00Z",
        id: "message-2",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [followup.id],
      questionLabels: [{ annotationIds: [followup.id], label: "Q-098" }],
    } as unknown as Discussion;

    const threads = qaReviewThreads([first, second], [root, followup], second);

    expect(threads).toHaveLength(1);
    expect(threads[0].rootQuestions?.map((item) => item.id)).toEqual([root.id]);
    expect(threads[0].answers).toHaveLength(2);
  });

  it("restores every first-round QA thread when opening a follow-up discussion", () => {
    const firstRoot = annotation("first-root");
    const secondRoot = annotation("second-root");
    const followup = annotation("followup", {
      anchor: {
        anchorType: "discussion_selection",
        discussionMessageId: "first-response",
        metadata: { rootQuestionIds: [firstRoot.id], sectionLabel: "Q-001" },
      },
      origin: "discussion_review_followup",
    });
    const firstDiscussion = {
      id: "first",
      messages: [{
        annotationLinks: [
          { annotationId: firstRoot.id, relation: "answers" },
          { annotationId: secondRoot.id, relation: "answers" },
        ],
        body: { markdown: "## Q-001\n\nOne.\n\n## Q-002\n\nTwo." },
        createdAt: "2026-07-23T01:00:00Z",
        id: "first-response",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [firstRoot.id, secondRoot.id],
      questionLabels: [
        { annotationIds: [firstRoot.id], label: "Q-001" },
        { annotationIds: [secondRoot.id], label: "Q-002" },
      ],
    } as unknown as Discussion;
    const followupDiscussion = {
      id: "followups",
      messages: [{
        annotationLinks: [{ annotationId: followup.id, relation: "answers" }],
        body: { markdown: "## Q-098\n\nFollow-up answer." },
        createdAt: "2026-07-23T02:00:00Z",
        id: "followup-response",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [followup.id],
      questionLabels: [{ annotationIds: [followup.id], label: "Q-098" }],
    } as unknown as Discussion;

    const threads = qaReviewThreads(
      [firstDiscussion, followupDiscussion],
      [firstRoot, secondRoot, followup],
      followupDiscussion,
    );

    expect(threads.map((item) => item.rootQuestions?.[0].id).sort()).toEqual([
      firstRoot.id,
      secondRoot.id,
    ]);
  });

  it("does not let polluted message links expand a prompt batch", () => {
    const first = annotation("first");
    const second = annotation("second");
    const leaked = annotation("old-day-four");
    const active = {
      id: "active",
      messages: [{
        annotationLinks: [first, second, leaked].map((item) => ({
          annotationId: item.id,
          relation: "answers",
        })),
        body: { markdown: "## Q-001\n\nFirst.\n\n## Q-002\n\nSecond." },
        createdAt: "2026-07-23T01:00:00Z",
        id: "response",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [first.id, second.id, leaked.id],
      questionLabels: [
        { annotationIds: [first.id], label: "Q-001" },
        { annotationIds: [second.id], label: "Q-002" },
      ],
    } as unknown as Discussion;

    const threads = qaReviewThreads([active], [first, second, leaked], active);

    expect(
      threads.flatMap((item) => item.rootQuestions?.map((question) => question.id)),
    ).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(threads.flatMap((item) => item.questions.map((question) => question.id)))
      .not.toContain(leaked.id);
  });

  it("filters the shared QA model to an explicit task question scope", () => {
    const lectureQuestion = annotation("lecture-question");
    const bookQuestion = annotation("book-question");
    const discussion = {
      id: "mixed-day-discussion",
      messages: [{
        annotationLinks: [lectureQuestion, bookQuestion].map((item) => ({
          annotationId: item.id,
          relation: "references",
        })),
        body: {
          markdown:
            "## Q-001\n\nLecture answer.\n\n## Q-002\n\nBook answer.",
        },
        createdAt: "2026-07-23T01:00:00Z",
        id: "mixed-response",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [lectureQuestion.id, bookQuestion.id],
      questionLabels: [
        { annotationIds: [lectureQuestion.id], label: "Q-001" },
        { annotationIds: [bookQuestion.id], label: "Q-002" },
      ],
    } as unknown as Discussion;

    const threads = qaReviewThreads(
      [discussion],
      [lectureQuestion, bookQuestion],
      discussion,
      [bookQuestion.id],
    );

    expect(threads).toHaveLength(1);
    expect(threads[0].rootQuestions?.map((question) => question.id)).toEqual([
      bookQuestion.id,
    ]);
    expect(threads[0].answers?.[0].section.title).toContain("Q-002");
  });

  it("keeps unlabelled tutor exercise sections reviewable and mappable", () => {
    const discussion = {
      id: "exercise-check",
      messages: [{
        annotationLinks: [],
        body: {
          markdown:
            "### Exercise 6.3\n\nCorrect reasoning.\n\n### Exercise 6.4\n\nNeeds one correction.",
        },
        createdAt: "2026-07-23T01:00:00Z",
        id: "exercise-response",
        role: "assistant",
        sequenceNumber: 1,
      }],
      qaReviews: [],
      questionIds: [],
      questionLabels: [],
    } as unknown as Discussion;

    const threads = qaReviewThreads([discussion], [], discussion);

    expect(threads).toHaveLength(2);
    expect(threads.every((item) => item.questions.length === 0)).toBe(true);
    expect(threads.map((item) => inferredExerciseLabels(item))).toEqual([
      ["Exercise 6.3"],
      ["Exercise 6.4"],
    ]);
  });
});
