import { describe, expect, it } from "vitest";
import { canonicalizePastedMarkdown, importPastedMarkdown } from "./discussionImport";
import { canAttachUnit, createSqueezeDraft, decideSqueeze, renderSqueezeUnits } from "./squeezeMarkdown";
import { normalizeDiscussionMarkdown } from "./discussionText";
import { inspectEditorMarkdown } from "./editorIntegrity";

describe("source-preserving automatic squeeze", () => {
  it("automatically inlines short formulas and attaches separated short fragments", () => {
    const raw = "Use this value:\n\n[\nx_t=2\n]\n\nfor the next step.";
    expect(importPastedMarkdown(raw)).toBe("Use this value: $x_t=2$ for the next step.");
  });
  it.each(["frac", "dfrac", "tfrac", "cfrac", "genfrac"])("keeps even short %s formulas as displays", command => {
    const source = `Before.\n\n$$\n\\${command}{1}{2}\n$$\n\nAfter.`;
    expect(importPastedMarkdown(source)).toBe(source);
  });
  it("preserves matrices, continuation derivations, long formulas and programming fences", () => {
    const source = "Before.\n\n$$\n= 1.\n$$\n\n$$\n\\begin{matrix}a\\\\b\\end{matrix}\n$$\n\n```python\nprint('x')\n```";
    expect(importPastedMarkdown(source)).toBe(source);
  });
  it("keeps unbraced fractions as displays too", () => {
    const source = "Before.\n\n$$\n\\frac12 x^2\n$$";
    expect(importPastedMarkdown(source)).toBe(source);
  });
  it("keeps custom marks, repeated content, hard breaks, quotes, links and table structure", () => {
    const source = "==A $x$==\n\nRepeat.\n\nRepeat.\n\nHard  \nbreak.\n\n> A quotation.\n\n[Read](https://example.org/a_b)\n\n| Key | Value |\n| --- | --- |\n| x | 2 |";
    const parsed = importPastedMarkdown(source);
    expect(parsed).toContain("==A $x$== Repeat. Repeat.");
    expect(parsed).toContain("Hard  \nbreak.");
    expect(parsed).toContain("> A quotation.");
    expect(parsed).toContain("[Read](https://example.org/a_b)");
    expect(parsed).toContain("| Key | Value |\n| --- | --- |\n| x | 2 |");
    expect(inspectEditorMarkdown(parsed).checks).toEqual([]);
  });
  it("inlines a single text field while retaining multiline diagrams", () => {
    expect(importPastedMarkdown("Use\n\n```text\nepsilon\n```\n\nhere.")).toBe("Use `epsilon` here.");
    const diagram = "```text\n+---+\n| x |\n+---+\n```";
    expect(importPastedMarkdown(diagram)).toBe(diagram);
  });
  it("reviews fragments inside lists without ever combining separate bullet items", () => {
    const raw = "- Use this:\n\n  $$\n  x=2\n  $$\n\n  Here.\n\n- Keep another item.\n\n## Q-002\n\nNext answer.";
    const parsed = importPastedMarkdown(raw);
    expect(parsed).toContain("- Use this: $x=2$ Here.");
    expect(parsed).toContain("\n\n- Keep another item.");
    expect(parsed).toContain("\n\n## Q-002\n\nNext answer.");
    const draft = createSqueezeDraft(canonicalizePastedMarkdown(raw));
    expect(canAttachUnit(draft.units, 3)).toBe(false);
    expect(inspectEditorMarkdown(parsed).checks).toEqual([]);
    expect(importPastedMarkdown(parsed)).toBe(parsed);
  });
  it("is idempotent and respects paragraphs deliberately separated on manual saves", () => {
    const source = "First.\n\n$$x=1$$\n\nSecond.\n\n```text\nvalue\n```";
    const parsed = importPastedMarkdown(source);
    expect(importPastedMarkdown(parsed)).toBe(parsed);
    expect(normalizeDiscussionMarkdown("First.\n\nSecond.")).toBe("First.\n\nSecond.");
  });
});

describe("review labels", () => {
  it("logs explicit choices with context and keeps navigation separate from labels", () => {
    const draft = createSqueezeDraft("First.\n\n$$\nx=2\n$$\n\nLast.");
    expect(draft.actions).toEqual([]);
    const separated = decideSqueeze(draft, 1, "separate");
    expect(renderSqueezeUnits(separated.units)).toBe("First.\n\n$x=2$ Last.");
    const blocked = decideSqueeze(separated, 1, "block");
    expect(renderSqueezeUnits(blocked.units)).toBe("First.\n\n$$\nx=2\n$$\n\nLast.");
    const attached = decideSqueeze(blocked, 1, "join");
    expect(renderSqueezeUnits(attached.units)).toBe("First. $x=2$\n\nLast.");
    expect(attached.actions.at(-1)).toMatchObject({command: "join", previous: "First.", before: {layout: "block"}, after: {layout: "inline", join: true}});
    expect(attached.units[1]).toMatchObject({reviewedJoin: true, reviewedLayout: true, suggestedJoin: true});
    expect(draft.units[1].reviewedJoin).toBe(false);
  });
  it("joins with exactly one space and does not cross a heading", () => {
    const draft = createSqueezeDraft("First.\n\nSecond.\n\n## Heading\n\nLast.");
    expect(renderSqueezeUnits(decideSqueeze(draft, 1, "join").units)).toContain("First. Second.");
    expect(decideSqueeze(draft, 3, "join")).toBe(draft);
  });
});
