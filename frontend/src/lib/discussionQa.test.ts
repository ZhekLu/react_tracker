import { describe, expect, it } from "vitest";
import type { Annotation, Discussion } from "../types/tracker";
import {
  discussionQaSections,
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
} as Discussion;

describe("discussion QA review model", () => {
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

  it("maps review follow-ups back to the answer section containing their excerpt", () => {
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

    expect(sections.at(-1)?.questionIds).toContain(followup.id);
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

    expect(sections[0].questionIds).toEqual([followup.id]);
    expect(
      responseQuestionIds(
        followupResponse,
        followupResponse.messages[0].body.markdown ?? "",
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
});
