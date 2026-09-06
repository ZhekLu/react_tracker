import { describe, expect, it } from "vitest";
import type { Annotation } from "../types/tracker";
import {
  isTrackedQuestion,
  questionCaptureHasAttachment,
  queuedTrackedQuestionGroups,
  trackedQuestionGroups,
} from "./questionIdentity";

function question(id: string, stableLabel: string): Annotation {
  return {
    anchor: { anchorType: "pdf_rect", metadata: {} },
    createdAt: "2026-09-06T00:00:00Z",
    discussionResponseCount: 0,
    id,
    kind: "question",
    notes: [],
    origin: "manual",
    postponed: false,
    priority: "normal",
    resourceId: "book",
    revision: 1,
    stableLabel,
    status: "open",
    updatedAt: "2026-09-06T00:00:00Z",
  };
}

describe("immutable question identity", () => {
  it("keeps a recoloured capture in question scopes", () => {
    const recoloured = {
      kind: "highlight",
      stableLabel: "Q-b-07-009",
    } as Annotation;

    expect(isTrackedQuestion(recoloured)).toBe(true);
  });

  it("does not promote an ordinary highlight", () => {
    const highlight = { kind: "highlight", stableLabel: null } as Annotation;

    expect(isTrackedQuestion(highlight)).toBe(false);
  });

  it("treats companion captures as one queued question", () => {
    const first = question("first-capture", "Q-b-11-007");
    const second = question("second-capture", "Q-b-11-007");

    expect(trackedQuestionGroups([first, second])).toHaveLength(1);
    expect(queuedTrackedQuestionGroups([first, second])).toHaveLength(1);

    second.discussionResponseCount = 1;
    expect(queuedTrackedQuestionGroups([first, second])).toEqual([]);
  });

  it("marks screenshot-backed captures in manual prompt selection", () => {
    const screenshot = question("screenshot", "Q-b-11-007");
    screenshot.anchor!.metadata.contextImageUrl = "/api/annotation-images/example";
    const textOnly = question("text", "Q-b-11-008");

    expect(questionCaptureHasAttachment(screenshot)).toBe(true);
    expect(questionCaptureHasAttachment(textOnly)).toBe(false);
  });
});
