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
  it("inlines compact boxed tuples without increasing the limit for other formulas", () => {
    const tuple = "\\boxed{ (s_t,a_t,r_{t+1},s_{t+1},d_{t+1},c_{t+1},\\pi_b(a_t|s_t),t) }";
    expect(tuple.length).toBeGreaterThan(56);
    expect(importPastedMarkdown(`Each record contains:\n\n$$\n${tuple}\n$$\n\nwhere these are observed values.`))
      .toBe(`Each record contains: $${tuple}$ where these are observed values.`);
    const long = `$$\n\\boxed{\\text{${"wide ".repeat(20).trim()}}}\n$$`;
    expect(importPastedMarkdown(long)).toBe(long);
    const unboxed = "$$\nY_t = R_{t+1} + \\gamma(1-\\texttt{terminated}) V_{t+1}(S_{t+1}).\n$$";
    expect(importPastedMarkdown(unboxed)).toBe(unboxed);
  });
  it("starts a compact versus comparison in its own paragraph", () => {
    const first = "\\boxed{ \\text{physical stopping} \\Rightarrow (1-D)=0 }";
    const second = "\\boxed{ \\text{time limit} \\Rightarrow V_H=0 }";
    const source = `These limits differ.\n\nThe comparison is:\n\n$$\n${first}\n$$\n\nversus\n\n$$\n${second}\n$$`;
    const result = importPastedMarkdown(source);
    expect(result).toBe(`These limits differ. The comparison is:\n\n$${first}$ versus $${second}$`);
    expect(importPastedMarkdown(result)).toBe(result);
  });
  it("inlines an introduced single-line code comparison and keeps its introduction separate", () => {
    const source = "The previous topic is complete.\n\nThe validator checks:\n\n```python\nsamples.count > 0\n```\n\nThis checks the observed count.";
    const result = importPastedMarkdown(source);
    expect(result).toBe("The previous topic is complete.\n\nThe validator checks: `samples.count > 0` This checks the observed count.");
    const draft = createSqueezeDraft(canonicalizePastedMarkdown(source));
    expect(draft.units[2]).toMatchObject({kind: "text", layout: "inline", join: true});
    expect(renderSqueezeUnits(decideSqueeze(draft, 2, "block").units)).toContain("```python\nsamples.count > 0\n```");
    expect(importPastedMarkdown(result)).toBe(result);
  });
  it.each(["print('x')", "x = 2", "def check(): return True", "x > 0\ny > 0"])("keeps the program %s fenced", program => {
    const source = `Run this:\n\n\`\`\`python\n${program}\n\`\`\``;
    expect(importPastedMarkdown(source)).toBe(source);
  });
  it("keeps unintroduced code comparisons fenced", () => {
    const source = "```python\nx > 0\n```";
    expect(importPastedMarkdown(source)).toBe(source);
  });
  it("also preserves a comparison introduction when its original fence was text", () => {
    const source = "That completes the topic.\n\nThe check is:\n\n```text\ncount > 0\n```";
    const result = importPastedMarkdown(source);
    expect(result).toBe("That completes the topic.\n\nThe check is: `count > 0`");
    expect(importPastedMarkdown(result)).toBe(result);
  });
  it("starts a next-step introduction separately while allowing ordinary short transitions", () => {
    const source = "That completes this topic.\n\nNext should be the collection step:\n\n$$\nx=2\n$$";
    const result = importPastedMarkdown(source);
    expect(result).toBe("That completes this topic.\n\nNext should be the collection step: $x=2$");
    expect(importPastedMarkdown(result)).toBe(result);
    expect(importPastedMarkdown("First example.\n\nNow suppose it continues.\n\nNext comes another sentence."))
      .toBe("First example. Now suppose it continues. Next comes another sentence.");
  });
  it("allows a short formula explanation to finish just beyond the paragraph budget", () => {
    const prefix = `${"a".repeat(620)}.`;
    const shortTail = `${"b".repeat(75)}.`;
    expect(importPastedMarkdown(`${prefix}\n\n$$\nx=2\n$$\n\n${shortTail}`)).toBe(`${prefix} $x=2$ ${shortTail}`);
    const longTail = `${"b".repeat(90)}.`;
    expect(importPastedMarkdown(`${prefix}\n\n$$\nx=2\n$$\n\n${longTail}`)).toBe(`${prefix} $x=2$\n\n${longTail}`);
    const overBudget = `${"a".repeat(710)}.`;
    expect(importPastedMarkdown(`${overBudget}\n\n${shortTail}`)).toBe(`${overBudget}\n\n${shortTail}`);
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
