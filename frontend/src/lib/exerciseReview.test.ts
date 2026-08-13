import { describe, expect, it } from "vitest";
import type { Annotation, Note } from "../types/tracker";
import {
  annotationExerciseNumbers,
  combinedExerciseReviewStatus,
  exerciseReviewCounts,
  exerciseNumbersInText,
  parseExerciseReviewProgress,
  serializeExerciseReviewProgress,
} from "./exerciseReview";

describe("exercise answer review state", () => {
  it("round-trips durable review states", () => {
    const markdown = serializeExerciseReviewProgress({
      "6.13": "skipped",
      "6.2": "understood",
      "6.6": "later",
    });
    const note = { document: { markdown, plainText: markdown } } as Note;
    expect(parseExerciseReviewProgress(note)).toEqual({
      "6.13": "skipped",
      "6.2": "understood",
      "6.6": "later",
    });
  });

  it("finds exercise numbers in PDF context", () => {
    const annotation = {
      anchor: {
        metadata: {
          contextParagraph: "Exercise 6.1 text. Exercise 6.2 follows.",
        },
      },
      body: { plainText: "Screenshot · Exercise 6.1" },
    } as unknown as Annotation;
    expect(annotationExerciseNumbers(annotation)).toEqual(["6.1", "6.2"]);
  });

  it("finds every required exercise in a plural task title", () => {
    expect(
      exerciseNumbersInText("Solve Exercises 6.2, 6.6, 6.7, and 6.8"),
    ).toEqual(["6.2", "6.6", "6.7", "6.8"]);
  });

  it("counts only understood and skipped exercises as reviewed", () => {
    expect(
      exerciseReviewCounts(
        ["6.1", "6.2", "6.3"],
        ["6.2", "6.3"],
        { "6.1": "later", "6.2": "understood", "6.3": "skipped" },
      ),
    ).toEqual({
      requiredReviewed: 2,
      requiredTotal: 2,
      totalReviewed: 2,
      total: 3,
    });
  });

  it("summarizes the color state of grouped tutor answers", () => {
    expect(
      combinedExerciseReviewStatus(
        ["6.2", "6.6"],
        { "6.2": "understood", "6.6": "understood" },
      ),
    ).toBe("understood");
    expect(
      combinedExerciseReviewStatus(
        ["6.2", "6.6"],
        { "6.2": "understood", "6.6": "later" },
      ),
    ).toBe("mixed");
  });
});
