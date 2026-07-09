import { describe, expect, it } from "vitest";
import {
  discussionAnswerSections,
  matchAnswerSectionsToQuestions,
  type DiscussionQuestionCandidate,
} from "./discussionText";

const questions: DiscussionQuestionCandidate[] = Array.from(
  { length: 17 },
  (_, index) => ({
    id: `annotation-${index + 1}`,
    text: `Question ${index + 1}`,
  }),
);

describe("discussion answer mapping", () => {
  it("recognizes hyphenated and grouped ChatGPT question headings", () => {
    const parsed = discussionAnswerSections([
      "Tutor preamble.",
      "",
      "## Q-002 and Q-003 — one shared answer",
      "",
      "Shared response.",
      "",
      "## Question 11 and Q-017",
      "",
      "Another shared response.",
    ].join("\n"));

    expect(parsed.preamble).toBe("Tutor preamble.");
    expect(parsed.sections.map((section) => section.labels)).toEqual([
      ["Q-002", "Q-003"],
      ["Q-011", "Q-017"],
    ]);
  });

  it("maps each label to the prompt-batch question order", () => {
    const sections = discussionAnswerSections([
      "## Q-002 and Q-003",
      "Shared answer.",
      "",
      "## Q-011 and Q-017",
      "Shared answer.",
    ].join("\n")).sections;

    expect(matchAnswerSectionsToQuestions(sections, questions)).toEqual([
      {
        questionIds: ["annotation-2", "annotation-3"],
        sectionLabel: "Q-002, Q-003",
      },
      {
        questionIds: ["annotation-11", "annotation-17"],
        sectionLabel: "Q-011, Q-017",
      },
    ]);
  });
});
