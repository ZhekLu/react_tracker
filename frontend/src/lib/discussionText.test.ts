import { describe, expect, it } from "vitest";
import {
  discussionFollowups,
  discussionAnswerSections,
  matchAnswerSectionsToQuestions,
  type DiscussionQuestionCandidate,
} from "./discussionText";
import type { Annotation, Discussion } from "../types/tracker";

const questions: DiscussionQuestionCandidate[] = Array.from(
  { length: 17 },
  (_, index) => ({
    id: `annotation-${index + 1}`,
    text: `Question ${index + 1}`,
  }),
);

describe("follow-up copy queue", () => {
  const followup = (id: string, responseCount = 0): Annotation => ({
    id, kind: "question", status: "open", postponed: false, discussionResponseCount: responseCount,
    body: {markdown: `Why ${id}??`}, createdAt: "2026-09-18",
    anchor: {discussionMessageId: "source", metadata: {promptLabel: id}, quote: "Selected explanation"},
  } as unknown as Annotation);
  const discussion = {title: "Review", questionIds: ["Q-001-F1", "Q-002-F1"],
    messages: [{id: "source", role: "assistant", sequenceNumber: 1,
      body: {plainText: "Why Q-001-F1??\nWhy Q-002-F1??\nUncaptured thought??"}}],
  } as Discussion;

  it("omits open follow-ups with mapped responses and does not recopy their inline markers", () => {
    const prompt = discussionFollowups(discussion, [followup("Q-001-F1", 1), followup("Q-002-F1")]);
    expect(prompt).not.toContain("Q-001-F1");
    expect(prompt.match(/Why Q-002-F1\?\?/g)).toHaveLength(1);
    expect(prompt).toContain("Uncaptured thought??");
  });

  it("uses the whole logical question when an answer is mapped to another capture", () => {
    const question = followup("Q-001-F1");
    question.stableLabel = "Q-001-F1";
    const companion = {...followup("image", 1), stableLabel: "Q-001-F1", anchor: undefined};
    expect(discussionFollowups(discussion, [question, companion])).not.toContain("Q-001-F1");
    expect(discussionFollowups(discussion, [question, {...companion, discussionResponseCount: 0}])).toContain("## Q-001-F1");
  });

  it("returns an empty queue when the only captured follow-up is answered", () => {
    const question = {...followup("Q-001-F1"), status: "answered" as const};
    const source = {...discussion, messages: [{...discussion.messages[0], body: {...discussion.messages[0].body, plainText: "Why Q-001-F1??"}}]};
    expect(discussionFollowups(source, [question])).toBe("");
  });
});

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

  it("keeps follow-up labels in their own root-scoped namespace", () => {
    const parsed = discussionAnswerSections([
      "## Q-021 — a new source question",
      "",
      "New answer.",
      "",
      "## Q-002-F1 — a follow-up to the second question",
      "",
      "Follow-up answer.",
      "",
      "## Q-002 follow up 2",
      "",
      "Second follow-up answer.",
    ].join("\n"));

    expect(parsed.sections.map((section) => section.labels)).toEqual([
      ["Q-021"],
      ["Q-002-F1"],
      ["Q-002-F2"],
    ]);
  });

  it("recognizes immutable resource-scoped labels and their follow-ups", () => {
    const parsed = discussionAnswerSections([
      "## Q-b-05-009 — book question",
      "",
      "Book answer.",
      "",
      "## Q-us-12-003-F2 — lecture follow-up",
      "",
      "Follow-up answer.",
    ].join("\n"));

    expect(parsed.sections.map((section) => section.labels)).toEqual([
      ["Q-b-05-009"],
      ["Q-us-12-003-F2"],
    ]);
  });

  it("uses top-level answer headings when the tutor omits question labels", () => {
    const parsed = discussionAnswerSections([
      "Intro.",
      "",
      "# Policy improvement proof",
      "",
      "Answer one.",
      "",
      "## Why does the action disappear?",
      "",
      "Detail.",
      "",
      "# Gridworld implementation",
      "",
      "Answer two.",
    ].join("\n"));

    expect(parsed.preamble).toBe("Intro.");
    expect(parsed.sections.map((section) => section.label)).toEqual([
      "Policy improvement proof",
      "Gridworld implementation",
    ]);
    expect(parsed.sections[0].markdown).toContain(
      "Why does the action disappear?",
    );
  });

  it("copies anchored review questions with their selected context", () => {
    const discussion = {
      id: "discussion",
      messages: [
        {
          body: { plainText: "Tutor answer" },
          id: "message-1",
          role: "assistant",
          sequenceNumber: 2,
        },
      ],
      questionIds: ["initial", "followup"],
      title: "Bellman review",
    } as Discussion;
    const followup = {
      anchor: {
        discussionMessageId: "message-1",
        metadata: { promptLabel: "Q-002-F1" },
        quote: "$V(s) \\leftarrow r + \\gamma V(s')$",
      },
      body: { markdown: "Why is this bootstrapping?" },
      createdAt: "2026-07-10T10:00:00Z",
      id: "followup",
      kind: "question",
      status: "open",
    } as unknown as Annotation;

    const prompt = discussionFollowups(discussion, [followup]);
    expect(prompt).toContain("## Q-002-F1 — Follow-up to message #2");
    expect(prompt).toContain("$V(s) \\leftarrow r + \\gamma V(s')$");
    expect(prompt).toContain("Why is this bootstrapping?");
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

  it("uses semantic multi-match for legacy resource threads without a batch", () => {
    const sections = discussionAnswerSections([
      "## Q-004, Q-005, Q-006",
      "A deterministic policy chooses one action. The stochastic policy uses probabilities, so equality between q and v needs an expectation.",
    ].join("\n")).sections;
    const legacyQuestions = [
      {
        id: "deterministic",
        text: "Why does equality between q and v hold for a deterministic policy?",
      },
      {
        id: "stochastic",
        text: "What changes for a stochastic policy with action probabilities?",
      },
      {
        id: "screenshot-only",
        text: "This item was flagged as an open question.",
      },
    ];

    expect(
      matchAnswerSectionsToQuestions(sections, legacyQuestions, false),
    ).toEqual([
      {
        questionIds: ["deterministic", "stochastic", "screenshot-only"],
        sectionLabel: "Q-004, Q-005, Q-006",
      },
    ]);
  });
});
