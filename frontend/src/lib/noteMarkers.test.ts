import { describe, expect, it } from "vitest";
import { highlightNoteMarkers } from "./noteMarkers";

describe("note marker highlights", () => {
  it("adds stable question and todo colours on save", () => {
    expect(
      highlightNoteMarkers(
        "Why is this contraction valid??\n\ntodo! verify the seed table",
      ),
    ).toBe(
      "!!Why is this contraction valid??!!\n\n%%todo! verify the seed table%%",
    );
  });

  it("does not classify markers inside code fences", () => {
    const markdown = "```python\nprint('todo! ??')\n```";
    expect(highlightNoteMarkers(markdown)).toBe(markdown);
  });
});
