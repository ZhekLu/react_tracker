import { describe, expect, it } from "vitest";
import type { Annotation } from "../types/tracker";
import {
  canonicalQuestionCaptures,
  isTrackedQuestion,
  questionCaptureHasAttachment,
  queuedTrackedQuestionGroups,
  trackedQuestionGroups,
  trackedQuestionKey,
} from "./questionIdentity";

function question(
  id: string,
  stableLabel: string,
  metadata: Record<string, unknown> = {},
): Annotation {
  return {
    anchor: { anchorType: "pdf_rect", metadata } as Annotation["anchor"],
    createdAt: "2026-09-07T00:00:00Z",
    discussionResponseCount: 0,
    id,
    kind: "question",
    notes: [],
    origin: "manual",
    postponed: false,
    priority: "normal",
    resourceId: "book",
    revision: 1,
    skipped: false,
    stableLabel,
    status: "open",
    updatedAt: "2026-09-07T00:00:00Z",
  };
}

describe("logical question frames", () => {
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

  it("joins historical labels while showing only the current crop", () => {
    const old = question("old", "Q-b-11-001", {
      questionFrameId: "frame-11-282",
      supersededByAnnotationId: "current",
    });
    const edge = question("edge", "Q-b-11-008", {
      questionFrameId: "frame-11-282",
      supersededByAnnotationId: "current",
    });
    const current = question("current", "Q-b-11-007", {
      questionFrameId: "frame-11-282",
    });

    expect(trackedQuestionKey(old)).toBe(trackedQuestionKey(current));
    expect(trackedQuestionGroups([old, edge, current])).toHaveLength(1);
    expect(canonicalQuestionCaptures([old, edge, current]).map((item) => item.id))
      .toEqual(["current"]);
  });

  it("keeps a historical crop visible when its replacement is out of scope", () => {
    const old = question("old", "Q-b-11-001", {
      questionFrameId: "frame-11-282",
      supersededByAnnotationId: "current",
    });

    expect(canonicalQuestionCaptures([old])).toEqual([old]);
  });
});
