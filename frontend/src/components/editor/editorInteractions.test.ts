// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { discussionEditorExtensions } from "./discussionEditorExtensions";
import { changeFormula, highlightSelection } from "./editorInteractions";

document.elementFromPoint = () => null;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const yellow = "#fff0a8", blue = "#cfe8ff";
function editor(content: string) {return new Editor({extensions: discussionEditorExtensions(), content, contentType: "markdown"});}
function nodes(node: JSONContent, type: string): JSONContent[] {return [...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap(child => nodes(child, type))];}
function pos(e: Editor, type: string) {let found = -1; e.state.doc.descendants((node, position) => {if (node.type.name === type && found < 0) found = position;}); return found;}
function reopen(e: Editor) {
  const expected = e.getJSON();
  for (let i = 0; i < 3; i++) {const next = editor(e.getMarkdown()); e.destroy(); e = next; expect(e.getJSON()).toEqual(expected);}
  return e;
}

describe("formula and boxed-content interactions", () => {
  it("highlights text, inline code, inline math, display math, and fenced code together without losing spaces or content", () => {
    let e = editor('Before $Q_\\theta$ and `buffer` after.\n\n$$\n\\boxed{a=b}\n$$\n\n```python\nx = 1\n```');
    e.commands.selectAll();
    const original = e.getJSON();
    highlightSelection(e, yellow);
    expect(nodes(e.getJSON(), "inlineMath")[0].marks).toContainEqual({type: "highlight", attrs: {color: yellow}});
    expect(e.getHTML()).toContain('<mark data-color="#fff0a8"');
    expect(nodes(e.getJSON(), "blockMath")[0].attrs?.blockHighlight).toBe(yellow);
    expect(nodes(e.getJSON(), "codeBlock")[0].attrs?.blockHighlight).toBe(yellow);
    expect(nodes(e.getJSON(), "text").find(n => n.text === "buffer")?.marks).toContainEqual({type: "highlight", attrs: {color: yellow}});
    e = reopen(e);
    e.commands.selectAll(); highlightSelection(e, yellow);
    expect(e.getJSON()).toEqual(original);
    e.destroy();
  });
  it("highlights a selected formula, recolours it, toggles off and undoes atomically", () => {
    let e = editor('Before.\n\n$$\nx=1\n$$\n\nAfter.');
    e.commands.setNodeSelection(pos(e, "blockMath"));
    highlightSelection(e, yellow);
    const marked = e.getJSON();
    highlightSelection(e, blue);
    expect(nodes(e.getJSON(), "blockMath")[0].attrs?.blockHighlight).toBe(blue);
    e = reopen(e);
    e.commands.setNodeSelection(pos(e, "blockMath")); highlightSelection(e, yellow);
    expect(e.getJSON()).toEqual(marked);
    e.commands.undo();
    expect(nodes(e.getJSON(), "blockMath")[0].attrs?.blockHighlight).toBe(blue);
    e.destroy();
  });
  it.each(['- First\n\n  ```text\n  a ``` b\n  ```', '> $$\n> x=1\n> $$', '```text\n<!-- note-highlight:blue -->\n```'])('round-trips nested or literal highlight comments: %s', source => {
    let e = editor(source);
    e.commands.selectAll(); highlightSelection(e, yellow);
    e = reopen(e); e.destroy();
  });
  it("a code-block cursor highlights the whole box, preserving its literal contents", () => {
    let e = editor('```text\na $x$ ==example==\n```');
    e.commands.setTextSelection(3); highlightSelection(e, yellow);
    e = reopen(e);
    expect(nodes(e.getJSON(), "codeBlock")[0].content?.[0].text).toBe('a $x$ ==example==');
    e.destroy();
  });
  it.each(['Before ==$x$== after.', '- Before ==$x$== after.'])('converts in place without losing neighbouring prose or highlights: %s', source => {
    const e = editor(source);
    e.commands.setNodeSelection(pos(e, 'inlineMath'));
    const original = e.getJSON();
    expect(changeFormula(e, pos(e, 'inlineMath'), 'block', 'x')).toBe(true);
    expect(nodes(e.getJSON(), 'blockMath')[0].attrs?.blockHighlight).toBe(yellow);
    expect(e.getMarkdown()).toContain('Before');
    expect(e.getMarkdown()).toContain('after.');
    e.commands.undo(); expect(e.getJSON()).toEqual(original);
    e.destroy();
  });
  it('moves display math into the preceding sentence with one space', () => {
    const e = editor('Before sentence.\n\n$$\nx=1\n$$\n\nAfter sentence.');
    expect(changeFormula(e, pos(e, 'blockMath'), 'inline', 'x=1')).toBe(true);
    expect(e.getMarkdown()).toBe('Before sentence. $x=1$\n\nAfter sentence.');
    e.destroy();
  });
  it('moves inline math onto its own line and trims the surrounding spaces', () => {
    const e = editor('Before sentence $x=1$ after sentence.');
    expect(changeFormula(e, pos(e, 'inlineMath'), 'block', 'x=1')).toBe(true);
    expect(e.getMarkdown()).toBe('Before sentence\n\n$$\nx=1\n$$\n\nafter sentence.');
    e.destroy();
  });
  it('rejects display conversion in a Markdown table without changing its document', () => {
    const e = editor('| Value |\n| --- |\n| $x$ |');
    const before = e.getJSON();
    expect(changeFormula(e, pos(e, 'inlineMath'), 'block', 'x')).toBe(false);
    expect(e.getJSON()).toEqual(before); e.destroy();
  });
  it("converts multiline display LaTeX to inline without changing comments or row separators", () => {
    let e = editor('$$\n\\begin{aligned}\na &= b \\\\\nc &= d % keep this comment\n\\end{aligned}\n$$');
    const latex = nodes(e.getJSON(), 'blockMath')[0].attrs?.latex as string;
    e.commands.setNodeSelection(pos(e, 'blockMath')); highlightSelection(e, blue);
    changeFormula(e, pos(e, 'blockMath'), 'inline', latex);
    e = reopen(e);
    expect(nodes(e.getJSON(), 'inlineMath')[0].attrs?.latex).toBe(latex);
    expect(nodes(e.getJSON(), 'inlineMath')[0].marks).toContainEqual({type: 'highlight', attrs: {color: blue}});
    e.destroy();
  });
});
