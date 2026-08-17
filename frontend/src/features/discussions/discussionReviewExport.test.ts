import { describe, expect, it } from "vitest";
import type { Annotation, Course, Discussion } from "../../types/tracker";
import { discussionReviewPrompt } from "./discussionReviewExport";

describe("discussionReviewPrompt", () => {
  it("groups a question, tutor answer, personal note, and follow-up", () => {
    const root = {
      id: "root",
      kind: "question",
      origin: "drawboard_cloud",
      postponed: false,
      priority: "normal",
      resourceId: "book",
      revision: 1,
      status: "answered",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      body: { markdown: "Why?", plainText: "Why?" },
      notes: [{ document: { markdown: "My attempt" } }],
    } as unknown as Annotation;
    const followup = {
      ...root,
      id: "followup",
      origin: "discussion_review_followup",
      status: "open",
      body: { markdown: "But what about variance?", plainText: "But what about variance?" },
      anchor: {
        anchorType: "discussion_selection",
        discussionMessageId: "message",
        quote: "Selected answer",
        metadata: { promptLabel: "Q-002", rootQuestionIds: [root.id] },
      },
      notes: [],
    } as unknown as Annotation;
    const discussion = {
      id: "discussion",
      title: "Day 7",
      questionIds: [root.id, followup.id],
      questionLabels: [
        { label: "Q-001", annotationIds: [root.id] },
        { label: "Q-002", annotationIds: [followup.id] },
      ],
      messages: [{
        id: "message",
        role: "assistant",
        sequenceNumber: 1,
        createdAt: "2026-01-02",
        body: { markdown: "## Q-001 — Answer\n\nTutor explanation.", plainText: "Tutor explanation." },
        annotationLinks: [
          { annotationId: root.id, relation: "answers" },
          { annotationId: followup.id, relation: "followup_to" },
        ],
      }],
      qaReviews: [],
    } as unknown as Discussion;
    const course = {
      title: "TORL",
      resources: [{ id: "book", title: "RL Book" }],
      annotations: [root, followup],
      discussions: [discussion],
      notes: [],
    } as unknown as Course;

    const exported = discussionReviewPrompt(course, discussion);

    expect(exported).toContain("## Q-001");
    expect(exported).toContain("My attempt");
    expect(exported).toContain("Tutor explanation.");
    expect(exported).toContain("My follow-up 1");
    expect(exported).toContain("But what about variance?");
    expect(exported).toContain("## Review request");
  });
});
