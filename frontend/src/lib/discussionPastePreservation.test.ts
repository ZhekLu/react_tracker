import { describe, it, expect } from 'vitest';
import { importPastedMarkdown } from './discussionImport';
import { normalizeDiscussionMarkdown, discussionAnswerSections } from './discussionText';
import { responseQuestionIds, normalizeTutorAnswerInstances } from './discussionQa';
import type { Discussion, Annotation } from '../types/tracker';

describe('non-destructive Markdown boundaries', () => {
  it('offers an unsqueezed import and preserves authored layout on saves', () => {
    const source = 'Before.\n\n$$\nx*{y}\n$$\n\n> A quotation.\n\nRepeat.\n\nRepeat.\n\nHard  \nbreak.';
    const imported = importPastedMarkdown(source, {squeeze: false});
    expect(imported).toContain('$$\nx*{y}\n$$');
    expect(imported).toContain('> A quotation.');
    expect(imported).toContain('Repeat.\n\nRepeat.');
    expect(imported).toMatch(/Hard(?: {2}|\\)\nbreak\./);
    expect(importPastedMarkdown(imported, {squeeze: false})).toBe(imported);
    expect(normalizeDiscussionMarkdown(source)).toBe(source);
  });
  it('protects URLs, code and explicit formulas from legacy math repair', () => {
    const source = '[Read](https://example.org/file_name)\n\n`target$Q$changes`\n\n$$\nx*{y}+\\begin{matrix}a\\\\b\\end{matrix}\n$$\n\n```md\n[label][1]\n[1]: https://example.org/file_name\n```';
    const imported = importPastedMarkdown(source);
    expect(imported).toContain('[Read](https://example.org/file_name)');
    expect(imported).toContain('`target$Q$changes`');
    expect(imported).toContain('x*{y}+\\begin{matrix}a\\\\b\\end{matrix}');
    expect(imported).toContain('[label][1]\n[1]: https://example.org/file_name');
  });
  it('does not split answer sections on headings inside code or math', () => {
    expect(discussionAnswerSections('## Q-001\n\n```md\n## Q-999\n```\n\n$$\n# Q-777\n$$\n\n## Q-002\n\nSecond.').sections.map(s => s.label)).toEqual(['Q-001', 'Q-002']);
  });
  it('does not split code examples into exercise answers, including unfinished fences', () => {
    const note = '## Explanation\n\n```md\n## Exercise 5.1\n\n## Exercise 5.2';
    expect(discussionAnswerSections(note).sections).toHaveLength(1);
    expect(normalizeTutorAnswerInstances(undefined, [], note).map(answer => answer.markdown)).toEqual([note]);
  });
  it('does not associate an unlabeled tutor note with unrelated open questions', () => {
    const discussion = {questionIds:['q'], questionLabels:[], messages:[]} as unknown as Discussion;
    expect(responseQuestionIds(discussion, '## Day 10\n\nReview this note.', [{id:'q',status:'open'}] as Annotation[], [])).toEqual([]);
  });

  it('does not repair authored bracket text during saves and preserves nested explicit displays', () => {
    const brackets = 'Literal notation:\n\n[\nx_y\n]';
    expect(normalizeDiscussionMarkdown(brackets)).toBe(brackets);
    expect(normalizeDiscussionMarkdown('1. Target\n\n   \\[\n   x_y\n   \\]')).toBe('1. Target\n\n   $$\n   x_y\n   $$');
  });
});
