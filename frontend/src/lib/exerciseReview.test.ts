import { describe, expect, it } from "vitest";
import type { Annotation, Note, Resource, Task } from "../types/tracker";
import {
  annotationExerciseNumbers,
  exerciseAnswerSections,
  combinedExerciseReviewStatus,
  exerciseReviewCounts,
  isExerciseTask,
  exerciseVisualStatus,
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

  it("splits tutor material at explicit exercise headings of mixed levels", () => {
    expect(
      exerciseAnswerSections([
        "Tutor preamble.",
        "",
        "## Exercise 6.2",
        "",
        "First answer.",
        "",
        "### Exercise 6.6 and Exercise 6.7",
        "",
        "Shared answer.",
      ].join("\n")),
    ).toEqual([
      {
        exercises: ["6.2"],
        markdown: "## Exercise 6.2\n\nFirst answer.",
      },
      {
        exercises: ["6.6", "6.7"],
        markdown: "### Exercise 6.6 and Exercise 6.7\n\nShared answer.",
      },
    ]);
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

  it("does not treat decimal parameters after an exercise as more exercises", () => {
    expect(
      exerciseNumbersInText(
        "Exercise 5.13 compares ph = 0.25 and ph = 0.55.",
      ),
    ).toEqual(["5.13"]);
  });

  it("shows the compact map only for an exercise workflow", () => {
    expect(isExerciseTask({ title: "Solve Exercises 7.1 and 7.3" })).toBe(true);
    expect(isExerciseTask({ title: "Derive the lambda-return" })).toBe(false);
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

  it("derives the exercise map from plan, personal work, tutor work, and review", () => {
    const document = (markdown: string) => ({ markdown, plainText: markdown });
    const task = {
      notes: [
        { kind: "exercise_my_solution", document: document("# Exercise 6.2") },
        { kind: "exercise_solution", document: document("# Exercise 6.3") },
        {
          kind: "exercise_review",
          document: document(serializeExerciseReviewProgress({ "6.4": "understood" })),
        },
      ],
      title: "Solve Exercises 6.1 and 6.4",
    } as unknown as Task;
    const resource = { notes: [] } as unknown as Resource;

    expect(exerciseVisualStatus("6.1", task, resource)).toBe("planned");
    expect(exerciseVisualStatus("6.2", task, resource)).toBe("my-solution");
    expect(exerciseVisualStatus("6.3", task, resource)).toBe("tutor");
    expect(exerciseVisualStatus("6.4", task, resource)).toBe("done");
    expect(exerciseVisualStatus("6.5", task, resource)).toBe("unplanned");
  });
});
