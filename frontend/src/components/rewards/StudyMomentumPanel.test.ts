import { describe, expect, it } from "vitest";
import { studyActivityLevel } from "../../lib/studyActivity";

describe("study activity intensity", () => {
  it("gets visibly stronger as tracked hours accumulate", () => {
    expect(studyActivityLevel(0, 0)).toBe(0);
    expect(studyActivityLevel(0, 20 * 60)).toBe(1);
    expect(studyActivityLevel(0, 60 * 60)).toBe(2);
    expect(studyActivityLevel(0, 2.5 * 3_600)).toBe(3);
    expect(studyActivityLevel(0, 4 * 3_600)).toBe(4);
  });

  it("still rewards meaningful completion without tracked time", () => {
    expect(studyActivityLevel(0.7, 0)).toBe(3);
    expect(studyActivityLevel(1, 0)).toBe(4);
  });
});
