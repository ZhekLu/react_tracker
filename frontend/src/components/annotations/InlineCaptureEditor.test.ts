import { describe, expect, it } from "vitest";
import { normalizedCaptureInput } from "../../lib/captureMarkers";

describe("inline capture markers", () => {
  it("turns double-question notes into red questions", () => {
    expect(
      normalizedCaptureInput({
        kind: "note",
        markdown: "Why is this stable??",
        priority: "normal",
      }),
    ).toMatchObject({ kind: "question", color: "rgb(226, 82, 117)" });
  });

  it("turns todo markers into the configured green todo", () => {
    expect(
      normalizedCaptureInput({
        kind: "note",
        markdown: "todo! rerun all seeds",
        priority: "normal",
      }),
    ).toMatchObject({ kind: "todo", color: "rgb(147, 178, 80)" });
  });

  it("preserves an explicitly chosen colour", () => {
    expect(
      normalizedCaptureInput({
        color: "cyan",
        kind: "question",
        markdown: "Question",
        priority: "normal",
      }).color,
    ).toBe("cyan");
  });
});
