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

  it("preserves math, tables, headings and list structure", () => {
    const source = "## Why??\n\n- Why $Q_\\theta$ changes??\n\n$$\n\\text{todo! ??}\n$$\n\n| What?? | Value |\n| --- | --- |\n| test | 2 |\n\n`todo! ??` and $\\text{??}$";
    const marked = highlightNoteMarkers(source);
    expect(marked).toBe(source.replace("- Why $Q_\\theta$ changes??", "- !!Why $Q_\\theta$ changes??!!"));
    expect(highlightNoteMarkers(marked)).toBe(marked);
  });
});
