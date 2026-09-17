// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import {createIntegrityEditor, editorDocumentFacts, inspectEditorMarkdown} from "./editorIntegrity";
import {importPastedMarkdown} from "./discussionImport";
import {repairHistoricalMarkdown} from "./repairHistoricalMarkdown";
import examples from "./editor-regressions.json";

document.elementFromPoint = () => null;

const fixtures = process.env.TRACKER_EDITOR_FIXTURES
  ? [...examples, ...JSON.parse(readFileSync(process.env.TRACKER_EDITOR_FIXTURES, "utf8")) as typeof examples]
  : examples;

describe("editor regression fixtures", () => {
  it("preserves overlapping bold, italic and highlight selections around atoms", () => {
    const available = [{type: "bold"}, {type: "italic"}, {type: "highlight", attrs: {color: "#cfe8ff"}}];
    const marks = (mask: number) => available.filter((_, bit) => mask & (1 << bit));
    for (let left = 0; left < 8; left++) for (let middle = 0; middle < 8; middle++) {
      const editor = createIntegrityEditor("");
      editor.commands.setContent({type: "doc", content: [{type: "paragraph", content: [
        {type: "text", text: "Before ", marks: marks(left)},
        {type: "inlineMath", attrs: {latex: "x"}, marks: marks(middle)},
        {type: "text", text: " after", marks: marks(left ^ middle)},
      ]}]});
      const saved = editor.getMarkdown(), reopened = createIntegrityEditor(saved);
      try {expect(editorDocumentFacts(reopened.getJSON()), saved).toEqual(editorDocumentFacts(editor.getJSON()));}
      finally {editor.destroy(); reopened.destroy();}
    }
  });
  for (const fixture of fixtures) it(fixture.title, () => {
    const parsed = fixture.kind === "paste" ? importPastedMarkdown(fixture.input) : fixture.input;
    const result = inspectEditorMarkdown(parsed);
    expect(result.checks).toEqual([]);
    const actual = createIntegrityEditor(result.serialized), expected = createIntegrityEditor(fixture.expected);
    try {expect(actual.getJSON()).toEqual(expected.getJSON());}
    finally {actual.destroy(); expected.destroy();}
  });
});

describe("historical repair boundaries", () => {
  it("repairs the confirmed signatures while protecting literal code and display math", () => {
    const literal = '```md\nY\n\nes. **value ****$x$**** here**\n```\n\n$$\n\\text{Y}\n\nes\n$$';
    const source = 'Y\n\nes. **value ****$x$**** here**\n\n' + literal;
    const repaired = repairHistoricalMarkdown(source);
    expect(repaired.markdown).toBe('Yes. **value $x$ here**\n\n' + literal);
    expect(repairHistoricalMarkdown(repaired.markdown).reasons).toEqual([]);
  });
  it("converts old HTML notes and retains their emphasis", () => {
    expect(repairHistoricalMarkdown('<p>Keep <strong>this</strong> note.</p>').markdown).toBe('Keep **this** note.');
  });
  it("reports unsupported content and malformed formulas", () => {
    expect(inspectEditorMarkdown('$\\notARealCommand$').checks).toContain('formula does not render');
  });
  it("repairs escaped list formulas and crossed closing marks", () => {
    const source = String.raw`1. \*\*Action $A\_t$ and $\\theta$.\*\*`;
    expect(repairHistoricalMarkdown(source).markdown).toBe('1. **Action $A_t$ and $\\theta$.**');
    const crossed = '^^Use **actual ^^****^^$G_t$^^**^^** for the action.^^**';
    const repaired = repairHistoricalMarkdown(crossed).markdown;
    expect(repaired).toBe('^^Use **actual $G_t$ for the action.**^^');
    expect(inspectEditorMarkdown(repaired).checks).toEqual([]);
    expect(repairHistoricalMarkdown(repaired).reasons).toEqual([]);
    for (const valid of [
      '**==First==**$n$**==part.==**',
      '==A **word**==$x$==**-suffix**.==',
      'But ==the **exact** ==$x$==**-return** here== is',
      String.raw`e\[a\]*e\[b\]=e\[ab\] only if independent`,
    ]) expect(repairHistoricalMarkdown(valid).markdown).toBe(valid);
  });
  it("repairs invalid matrix rows and text percentages without touching valid math", () => {
    const source = String.raw`$$
\begin{bmatrix}w_1\w_2\end{bmatrix}
$$

$$
\text{80% of samples}
$$`;
    const repaired = repairHistoricalMarkdown(source);
    expect(repaired.markdown).toContain(String.raw`w_1\\w_2`);
    expect(repaired.markdown).toContain(String.raw`80\%`);
    expect(inspectEditorMarkdown(repaired.markdown).checks).toEqual([]);
    expect(repairHistoricalMarkdown(repaired.markdown).reasons).toEqual([]);
  });
});
