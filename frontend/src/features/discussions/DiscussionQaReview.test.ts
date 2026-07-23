import { describe, expect, it } from "vitest";
import type { Annotation, Discussion } from "../../types/tracker";
import type { DiscussionQaSection } from "../../lib/discussionQa";
import {
  qaReviewItems,
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
    } as Discussion;

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
});
