import { describe, expect, it } from "vitest";
import type { Annotation } from "../types/tracker";
import { isTrackedQuestion } from "./questionIdentity";

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
});
