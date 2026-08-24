import { describe, expect, it } from "vitest";
import type { Annotation, Discussion } from "../types/tracker";
import {
  discussionQaSections,
  normalizeTutorAnswerInstances,
  reconstructQaMessage,
  responseQuestionIds,
} from "./discussionQa";

const questions = [
  {
    anchor: { metadata: {}, pageNumber: 10 },
    body: { markdown: "Why is the policy deterministic?" },
    createdAt: "2026-07-10T10:00:00Z",
    id: "question-1",
    kind: "question",
    resourceId: "book",
    status: "open",
  },
  {
    anchor: { metadata: {}, pageNumber: 11 },
    body: { markdown: "Why do ties need a stable rule?" },
    createdAt: "2026-07-10T10:01:00Z",
    id: "question-2",
    kind: "question",
    resourceId: "book",
    status: "answered",
  },
] as Annotation[];

const discussion = {
  id: "discussion",
  initialPromptBatchId: "batch",
  messages: [
    {
      annotationLinks: questions.map((question) => ({
        annotationId: question.id,
        relation: "references",
      })),
      body: {
        markdown: [
          "Short orientation.",
          "",
          "## Q-001 — Deterministic policy",
          "",
          "First answer.",
          "",
          "## Q-002 — Tie handling",
          "",
          "Second answer.",
        ].join("\n"),
      },
      id: "message",
      role: "assistant",
      sequenceNumber: 2,
    },
  ],
  questionIds: questions.map((question) => question.id),
  questionLabels: [
    { annotationIds: ["question-1"], label: "Q-001" },
    { annotationIds: ["question-2"], label: "Q-002" },
  ],
} as Discussion;

describe("discussion QA review model", () => {
  it("normalizes a pasted tutor response into one persisted answer per question", () => {
    const answers = normalizeTutorAnswerInstances(
      discussion,
      questions,
      [
        "A short orientation that must not become a fake question.",
        "",
        "## Q-001 — First",
        "",
        "First answer.",
        "",
        "### Detail",
        "",
        "Nested explanation.",
        "",
        "## Q-002 — Second",
        "",
        "Second answer.",
        "",
        "A final note remains with the final answer.",
      ].join("\n"),
      questions.map((question) => question.id),
    );

    expect(answers).toHaveLength(2);
    expect(answers[0].annotationIds).toEqual(["question-1"]);
    expect(answers[0].markdown).toContain("A short orientation");
    expect(answers[0].markdown).toContain("### Detail");
    expect(answers[1].annotationIds).toEqual(["question-2"]);
    expect(answers[1].markdown).toContain("A final note remains");
    expect(answers.map((answer) => answer.markdown).join("\n")).not.toContain(
      "__pending_tutor_answer_import__",
    );
  });

  it("keeps heading-free tutor prose as one standalone answer", () => {
    const answers = normalizeTutorAnswerInstances(
      discussion,
      questions,
      "One useful response without any headings.",
      [questions[0].id],
    );

    expect(answers).toEqual([
      {
        annotationIds: [questions[0].id],
        markdown: "One useful response without any headings.",
        plainText: "One useful response without any headings.",
      },
    ]);
  });

  it("uses primary headings for tutor feedback that has no Q labels", () => {
    const answers = normalizeTutorAnswerInstances(
      undefined,
      [],
      "Intro.\n\n## Exercise 6.2\n\nFirst solution.\n\n## Exercise 6.6\n\nSecond solution.",
    );

    expect(answers).toHaveLength(2);
    expect(answers[0].markdown).toContain("Intro.");
    expect(answers[0].markdown).toContain("## Exercise 6.2");
    expect(answers[1].markdown).toContain("## Exercise 6.6");
  });

  it("keeps an explicit link when one exercise answer is pasted directly", () => {
    const answers = normalizeTutorAnswerInstances(
      discussion,
      questions,
      "## Exercise 6.2\n\nA direct tutor solution.",
      [questions[0].id],
    );

    expect(answers).toHaveLength(1);
    expect(answers[0].annotationIds).toEqual([questions[0].id]);
  });

  it("folds generic introduction and summary headings into real answers", () => {
    const answers = normalizeTutorAnswerInstances(
      undefined,
      [],
      [
        "## Orientation",
        "",
        "First, here is the shared context.",
        "",
        "## Exercise 6.2",
        "",
        "First solution.",
        "",
        "### Detail",
        "",
        "Keep this nested explanation.",
        "",
        "## Exercise 6.6",
        "",
        "Second solution.",
        "",
        "## Closing note",
        "",
        "This belongs to the final answer.",
      ].join("\n"),
    );

    expect(answers).toHaveLength(2);
    expect(answers[0].markdown).toContain("## Orientation");
    expect(answers[0].markdown).toContain("## Exercise 6.2");
    expect(answers[0].markdown).toContain("### Detail");
    expect(answers[1].markdown).toContain("## Exercise 6.6");
    expect(answers[1].markdown).toContain("## Closing note");
  });

  it("does not manufacture QA cards from generic headings without question boundaries", () => {
    const markdown = "## Overview\n\nUseful context.\n\n## Summary\n\nOne conclusion.";
    const answers = normalizeTutorAnswerInstances(undefined, [], markdown);

    expect(answers).toEqual([
      { annotationIds: [], markdown, plainText: markdown },
    ]);
  });

  it("folds a headed preamble into the first Q answer and a postscript into the last", () => {
    const answers = normalizeTutorAnswerInstances(
      discussion,
      questions,
      "## Orientation\n\nShared context.\n\n## Q-001\n\nFirst.\n\n## Q-002\n\nSecond.\n\n## Postscript\n\nKeep this.",
      questions.map((question) => question.id),
    );

    expect(answers).toHaveLength(2);
    expect(answers[0].markdown).toContain("## Orientation");
    expect(answers[0].markdown).toContain("## Q-001");
    expect(answers[1].markdown).toContain("## Q-002");
    expect(answers[1].markdown).toContain("## Postscript");
  });

  it("keeps introduction sections and maps answer sections to questions", () => {
    const sections = discussionQaSections(discussion, questions);

    expect(sections.map((section) => section.title)).toEqual([
      "Introduction",
      "Q-001 — Deterministic policy",
      "Q-002 — Tie handling",
    ]);
    expect(sections.map((section) => section.questionIds)).toEqual([
      [],
      ["question-1"],
      ["question-2"],
    ]);
  });

  it("rebuilds one message from independently edited section drafts", () => {
    const sections = discussionQaSections(discussion, questions);
    const drafts = new Map([
      [sections[1].id, "Edited first answer with $\\pi(a)$."]
    ]);

    const rebuilt = reconstructQaMessage(sections, drafts);

    expect(rebuilt.markdown).toContain(
      "## Q-001 — Deterministic policy\n\nEdited first answer with $\\pi(a)$.",
    );
    expect(rebuilt.markdown).toContain(
      "## Q-002 — Tie handling\n\nSecond answer.",
    );
    expect(rebuilt.sectionBodyOffsets.get(sections[1].id)).toBeGreaterThan(
      rebuilt.sectionBodyOffsets.get(sections[0].id) ?? -1,
    );
  });

  it("keeps answer editor identities stable while preceding answers are deleted", () => {
    const labels = Array.from({ length: 6 }, (_, index) => index + 11);
    let current = {
      ...discussion,
      messages: [{
        ...discussion.messages[0],
        body: {
          markdown: labels.map((number) => [
            `## Q-${String(number).padStart(3, "0")} — answer ${number}`,
            "",
            `Body that belongs only to Q-${number}.`,
          ].join("\n")).join("\n\n"),
        },
        annotationLinks: [],
      }],
      questionIds: [],
      questionLabels: [],
    } as unknown as Discussion;
    const initialSections = discussionQaSections(current, []);
    const drafts = new Map(
      initialSections.map((section) => [section.id, section.bodyMarkdown]),
    );

    for (const deleted of [11, 12, 13, 14]) {
      const sections = discussionQaSections(current, []);
      const remaining = sections.filter(
        (section) => section.label !== `Q-${String(deleted).padStart(3, "0")}`,
      );
      current = {
        ...current,
        messages: [{
          ...current.messages[0],
          body: { markdown: reconstructQaMessage(remaining, drafts).markdown },
        }],
      } as Discussion;
    }

    const markdown = current.messages[0].body.markdown ?? "";
    expect(markdown).not.toContain("Q-011");
    expect(markdown).not.toContain("Q-014");
    expect(markdown).toContain("## Q-015 — answer 15\n\nBody that belongs only to Q-15.");
    expect(markdown).toContain("## Q-016 — answer 16\n\nBody that belongs only to Q-16.");
  });

  it("does not guess a legacy follow-up section inside an explicit batch", () => {
    const followup = {
      anchor: {
        discussionMessageId: "message",
        metadata: {},
        quote: "ties need a stable deterministic rule",
      },
      body: { markdown: "Why does changing a tie break matter?" },
      createdAt: "2026-07-10T10:02:00Z",
      id: "followup",
      kind: "question",
      origin: "discussion_review_followup",
      resourceId: "book",
      status: "open",
    } as unknown as Annotation;
    const withFollowup = {
      ...discussion,
      messages: discussion.messages.map((message) => ({
        ...message,
        annotationLinks: [
          ...message.annotationLinks,
          { annotationId: followup.id, relation: "followup_to" as const },
        ],
        body: {
          ...message.body,
          markdown: `${message.body.markdown}\n\nThe ties need a stable deterministic rule.`,
        },
      })),
      questionIds: [...discussion.questionIds, followup.id],
    } as Discussion;

    const sections = discussionQaSections(withFollowup, [...questions, followup]);

    expect(sections.at(-1)?.questionIds).not.toContain(followup.id);
  });

  it("maps a follow-up response by its persistent copied prompt label", () => {
    const followup = {
      anchor: {
        discussionMessageId: "older-message",
        metadata: { promptLabel: "Q-098" },
        quote: "Batch training repeats the same episodes.",
      },
      body: { markdown: "Why does the target change on the next sweep?" },
      createdAt: "2026-07-10T10:02:00Z",
      id: "followup-98",
      kind: "question",
      origin: "discussion_review_followup",
      resourceId: "discussion-resource",
      status: "open",
    } as unknown as Annotation;
    const followupResponse = {
      ...discussion,
      messages: [
        {
          ...discussion.messages[0],
          id: "older-message",
        },
        {
          annotationLinks: [
            { annotationId: followup.id, relation: "references" as const },
          ],
          body: {
            markdown: "## Q-098\n\nThe target changes because $V(S_{t+1})$ changes.",
          },
          id: "followup-response",
          role: "assistant",
          sequenceNumber: 3,
        },
      ],
      questionIds: [...discussion.questionIds, followup.id],
    } as Discussion;

    const sections = discussionQaSections(followupResponse, [
      ...questions,
      followup,
    ]);

    expect(sections.at(-1)?.questionIds).toEqual([followup.id]);
    expect(
      responseQuestionIds(
        followupResponse,
        followupResponse.messages[1].body.markdown ?? "",
        [...questions, followup],
        [
          {
            ...discussion,
            title: followupResponse.title,
            messages: [
              {
                ...discussion.messages[0],
                id: "older-message",
              },
            ],
          } as Discussion,
          followupResponse,
        ],
      ),
    ).toEqual([followup.id]);
  });

  it("never aliases a continuation label with a root-scoped follow-up label", () => {
    const followup = {
      anchor: {
        discussionMessageId: "older-answer",
        metadata: {
          promptLabel: "Q-002-F1",
          rootQuestionIds: ["question-2"],
        },
        quote: "Second answer.",
      },
      body: { markdown: "Can you clarify the stable tie rule?" },
      createdAt: "2026-07-10T10:02:00Z",
      id: "followup-to-two",
      kind: "question",
      origin: "discussion_review_followup",
      resourceId: "book",
      status: "open",
    } as unknown as Annotation;
    const continuation = {
      ...questions[0],
      id: "new-question-21",
      body: { markdown: "What happens near termination?" },
    } as Annotation;
    const response = {
      ...discussion,
      messages: [{
        annotationLinks: [followup, continuation].map((item) => ({
          annotationId: item.id,
          relation: "references" as const,
        })),
        body: {
          markdown: [
            "## Q-021 — termination",
            "",
            "The continuation answer.",
            "",
            "## Q-002-F1 — stable tie follow-up",
            "",
            "The follow-up answer.",
          ].join("\n"),
        },
        id: "new-response",
        role: "assistant",
        sequenceNumber: 3,
      }],
      questionIds: [...discussion.questionIds, continuation.id, followup.id],
      questionLabels: [
        ...discussion.questionLabels,
        { annotationIds: [continuation.id], label: "Q-021" },
      ],
    } as Discussion;

    const sections = discussionQaSections(response, [
      ...questions,
      continuation,
      followup,
    ]);

    expect(sections.map((section) => section.questionIds)).toEqual([
      [continuation.id],
      [followup.id],
    ]);
  });

  it("keeps a cross-discussion follow-up attached by UUID and prompt label", () => {
    const followup = {
      anchor: {
        discussionMessageId: "message-in-older-discussion",
        metadata: { promptLabel: "Q-098" },
        quote: "Selected context from the older answer.",
      },
      body: { markdown: "Why does replay change the TD target?" },
      createdAt: "2026-07-10T10:02:00Z",
      id: "cross-discussion-followup",
      kind: "question",
      origin: "discussion_review_followup",
      resourceId: "discussion-resource",
      status: "open",
    } as unknown as Annotation;
    const currentDiscussion = {
      ...discussion,
      messages: [
        {
          annotationLinks: [
            { annotationId: followup.id, relation: "answers" as const },
          ],
          body: {
            markdown:
              "## Q-098\n\nThe replay target changes with the current value estimate.",
          },
          id: "current-response",
          role: "assistant",
          sequenceNumber: 1,
        },
      ],
      questionIds: [...discussion.questionIds, followup.id],
    } as Discussion;

    const sections = discussionQaSections(currentDiscussion, [
      ...questions,
      followup,
    ]);

    expect(sections[0].questionIds).toEqual([followup.id]);
  });

  it("fails closed when an imported follow-up label collides with local Q-001", () => {
    const followup = {
      anchor: {
        discussionMessageId: "message-in-older-discussion",
        metadata: { promptLabel: "Q-001" },
        quote: "Unrelated selected context.",
      },
      body: { markdown: "A different discussion's first follow-up." },
      createdAt: "2026-07-10T10:02:00Z",
      id: "colliding-followup",
      kind: "question",
      origin: "discussion_review_followup",
      resourceId: "discussion-resource",
      status: "open",
    } as unknown as Annotation;
    const currentDiscussion = {
      ...discussion,
      messages: [
        {
          annotationLinks: [
            { annotationId: followup.id, relation: "answers" as const },
          ],
          body: { markdown: "## Q-001\n\nAn ambiguous answer." },
          id: "current-response",
          role: "assistant",
          sequenceNumber: 1,
        },
      ],
      questionIds: [...discussion.questionIds, followup.id],
    } as Discussion;

    const sections = discussionQaSections(currentDiscussion, [
      ...questions,
      followup,
    ]);

    expect(sections[0].questionIds).toEqual(["question-1"]);
    expect(sections[0].questionIds).not.toContain(followup.id);
  });

  it("does not semantically reassign an unknown label in an explicit batch", () => {
    const explicit = {
      ...discussion,
      messages: [
        {
          ...discussion.messages[0],
          body: {
            markdown:
              "## Q-999 — Why is the policy deterministic?\n\nLooks semantically similar but has no stored identity.",
          },
        },
      ],
    } as Discussion;

    const sections = discussionQaSections(explicit, questions);

    expect(sections[0].questionIds).toEqual([]);
  });

  it("uses persisted discussion-local labels instead of flattened array positions", () => {
    const grouped = {
      ...discussion,
      messages: [
        {
          ...discussion.messages[0],
          body: {
            markdown:
              "## Q-002 / Q-011 — grouped answer\n\nAn identity answer that must not map semantically.",
          },
        },
      ],
      questionIds: ["unrelated", "wrong-by-position", ...discussion.questionIds],
      questionLabels: [
        { annotationIds: ["question-2"], label: "Q-002" },
        { annotationIds: ["question-1", "capture-2"], label: "Q-011" },
      ],
    } as Discussion;
    const capture = {
      ...questions[0],
      id: "capture-2",
    } as Annotation;

    const sections = discussionQaSections(grouped, [...questions, capture]);

    expect(sections[0].questionIds).toEqual([
      "question-2",
      "question-1",
      "capture-2",
    ]);
  });
});
