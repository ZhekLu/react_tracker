// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'katex';
import { discussionEditorExtensions, PRIMARY_DISCUSSION_HIGHLIGHT } from './discussionEditorExtensions';
import { importPastedMarkdown } from '../../lib/discussionImport';
import day10Note from '../../lib/day10TutorNote.raw.fixture.md?raw';

document.elementFromPoint = () => null;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function nodes(doc: JSONContent, type: string): JSONContent[] {
  return [...(doc.type === type ? [doc] : []), ...(doc.content ?? []).flatMap(n => nodes(n, type))];
}
function editor(markdown: string) {
  return new Editor({ extensions: discussionEditorExtensions(), content: markdown, contentType: 'markdown' });
}

describe('editor document integrity', () => {
  it('does not let block-token hints break paragraphs containing literal formula or metadata syntax', () => {
    const source = 'Write `$x$` or `$$x$$` in source. Keep `<!-- note-highlight:yellow -->` and `<!-- tutor-review:abc -->` literal.\n\n$$\nx=1\n$$';
    const e = editor(source);
    expect(nodes(e.getJSON(), 'blockMath')).toHaveLength(1);
    expect(nodes(e.getJSON(), 'inlineMath')).toHaveLength(0);
    expect(nodes(e.getJSON(), 'tutorReviewBoundary')).toHaveLength(0);
    expect(e.getJSON().content?.[0].type).toBe('paragraph');
    expect(e.state.doc.child(0).textContent).toBe('Write $x$ or $$x$$ in source. Keep <!-- note-highlight:yellow --> and <!-- tutor-review:abc --> literal.');
    e.destroy();
  });
  it('parses marks in loose lists instead of escaping their literal source on every save', () => {
    const source = '1. **Why $\\pi_\\theta$ matters.**\n\n   Another paragraph.\n\n2. **Next** $G_t$.\n\n   $$\n   x=1\n   $$';
    let e = editor(source);
    expect(e.getHTML()).toContain('<strong>Why ');
    expect(nodes(e.getJSON(), 'inlineMath')).toHaveLength(2);
    const expected = e.getJSON();
    for (let i = 0; i < 3; i++) {
      const next = editor(e.getMarkdown()); e.destroy(); e = next;
      expect(e.getJSON()).toEqual(expected);
    }
    e.destroy();
  });
  it('parses a single numbered item before an unindented formula', () => {
    const e = editor('1. **Why $\\pi$ matters**.\n\n$$\nx=1\n$$');
    expect(nodes(e.getJSON(), 'inlineMath')).toHaveLength(1);
    expect(e.getHTML()).toContain('<strong>Why ');
    const reopened = editor(e.getMarkdown());
    expect(reopened.getJSON()).toEqual(e.getJSON());
    e.destroy(); reopened.destroy();
  });
  it('escapes literal dollars without changing code or turning prose into formulas', () => {
    const e = editor('A damaged closing pair: TD(λ)$$ and $x$.\n\n```text\n$$ ==literal==\n```');
    const reopened = editor(e.getMarkdown());
    expect(reopened.getJSON()).toEqual(e.getJSON());
    e.destroy(); reopened.destroy();
  });
  it('keeps bold prose and inline formulas in a single mark run across reloads', () => {
    const source = 'Use **reward-to-go $G_t$ for action at time** $t$.\n\n## **Total return of $\\tau$, for example**';
    let e = editor(source);
    const expected = e.getJSON();
    for (let i = 0; i < 4; i++) {
      const saved = e.getMarkdown();
      expect(saved).not.toContain('****');
      const next = editor(saved); e.destroy(); e = next;
      expect(e.getJSON()).toEqual(expected);
    }
    e.destroy();
  });
  it('preserves task-review boundaries as labelled atoms through editing and reopening', () => {
    const markdown = 'My $G_t$ answer.\n\n<!-- tutor-review:123-abc -->\n\n## Feedback\n\nUse $Q_\\theta$.\n\n<!-- /tutor-review:123-abc -->';
    const e = editor(markdown);
    expect(nodes(e.getJSON(), 'tutorReviewBoundary')).toHaveLength(2);
    const saved = e.getMarkdown();
    expect(saved).toContain('<!-- tutor-review:123-abc -->');
    expect(saved).toContain('<!-- /tutor-review:123-abc -->');
    const reopened = editor(saved);
    expect(nodes(reopened.getJSON(), 'tutorReviewBoundary').map(n => n.attrs)).toEqual([
      {reviewId: '123-abc', end: false}, {reviewId: '123-abc', end: true},
    ]);
    e.destroy(); reopened.destroy();
  });
  it('imports the full Day 10 note with five list items and every display formula', () => {
    const imported = importPastedMarkdown(day10Note);
    const e = editor(imported);
    const json: JSONContent = e.getJSON();
    expect(json.content?.[0].type).toBe('paragraph');
    expect(json.content?.[0].content?.[0].text).toMatch(/^Yes\. Day 8–9/);
    const expected = [...day10Note.matchAll(/\$\$([\s\S]*?)\$\$/g)].map(m => m[1].trim());
    const math = nodes(json, 'blockMath').map(n => String(n.attrs?.latex));
    expect(math.map(value => value.replace(/\n[ \t]+/g, "\n"))).toEqual(expected.map(value => value.replace(/\n[ \t]+/g, "\n")));
    expect(nodes(json, 'orderedList')[0]?.content).toHaveLength(5);
    expect(nodes(json, 'blockquote')).toHaveLength(1);
    for (const latex of math) expect(() => renderToString(latex, {throwOnError:true})).not.toThrow();
    const reopened = editor(e.getMarkdown());
    expect(nodes(reopened.getJSON(), 'blockMath').map(n => n.attrs?.latex)).toEqual(math);
    expect(nodes(reopened.getJSON(), 'orderedList')[0]?.content).toHaveLength(5);
    e.destroy(); reopened.destroy();
  });

  it('retains spaces and highlighted formula atoms through repeated save/reopen and undo', () => {
    let e = editor('Before $Q_\\theta$ changes and $w$ follows.');
    const text = e.state.doc.textBetween(0, e.state.doc.content.size, '\n', n => `$${n.attrs.latex}$`);
    e.commands.setTextSelection({from: 1, to: e.state.doc.content.size - 1});
    e.commands.toggleHighlight({color: PRIMARY_DISCUSSION_HIGHLIGHT});
    for (let i=0; i<4; i++) {
      const next = editor(e.getMarkdown()); e.destroy(); e=next;
      expect(e.state.doc.textBetween(0, e.state.doc.content.size, '\n', n => `$${n.attrs.latex}$`)).toBe(text);
      expect(nodes(e.getJSON(), 'inlineMath').every(n => n.marks?.some(m => m.type === 'highlight'))).toBe(true);
    }
    e.commands.setTextSelection({from: 1, to: e.state.doc.content.size - 1});
    e.commands.unsetHighlight();
    expect(nodes(e.getJSON(), 'inlineMath').every(n => !n.marks?.length)).toBe(true);
    e.commands.undo();
    expect(nodes(e.getJSON(), 'inlineMath').every(n => n.marks?.length)).toBe(true);
    e.destroy();
  });

  it('keeps tables, images, deep headings, code and valid LaTeX row separators', () => {
    const source = '###### Details\n\n| Value | Meaning |\n| --- | --- |\n| $w$ | weight |\n\n![diagram](https://example.org/image.png)\n\n$$\n\\begin{matrix}a\\\\b\\end{matrix}\n$$\n\n```text\nkeep  two spaces\n```';
    const e = editor(importPastedMarkdown(source));
    expect(nodes(e.getJSON(), 'table')).toHaveLength(1);
    expect(nodes(e.getJSON(), 'image')).toHaveLength(1);
    expect(nodes(e.getJSON(), 'heading')[0].attrs?.level).toBe(6);
    expect(nodes(e.getJSON(), 'blockMath')[0].attrs?.latex).toContain('a\\\\b');
    expect(nodes(e.getJSON(), 'codeBlock')[0].content?.[0].text).toBe('keep  two spaces');
    e.destroy();
  });
});
