// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import type * as TiptapReact from '@tiptap/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscussionMarkdownSurfaceImpl } from './DiscussionMarkdownSurfaceImpl';
import { NoteWorkspace } from '../notes/NoteWorkspace';
import { MarkdownMathRenderer } from '../content/MarkdownMathRenderer';

const state = vi.hoisted(() => ({editor: null as Editor | null}));
vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = await importOriginal<typeof TiptapReact>();
  return {...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args);
    state.editor = editor;
    return editor;
  }};
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function Controlled() {
  const [markdown, setMarkdown] = useState('Before $Q_\\theta$ changes.');
  return <DiscussionMarkdownSurfaceImpl editable markdown={markdown} onChange={setMarkdown} />;
}

describe('controlled editor lifecycle', () => {
  it('can switch an existing reader to edit mode without recursively comparing editor schemas', async () => {
    const markdown = 'Instructions\n\n$$\n\\boxed{x=1}\n$$\n\nContinue here.';
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl markdown={markdown} />));
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown={markdown} onChange={() => {}} />));
    expect(host.querySelector('.ProseMirror[contenteditable="true"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLElement>('.ProseMirror')!.click());
    expect(host.querySelector('.discussionMarkdownSurface')).not.toBeNull();
  });
  it('refuses a stale formula dialog after the document is replaced externally', async () => {
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown={'Before $x$ after.'}/>));
    await act(async () => host.querySelector('[data-type="inline-math"]')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true})));
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown={'$y$'}/>));
    expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('document changed');
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    expect(buttons.find(button => button.textContent === 'Apply')?.disabled).toBe(true);
    expect(buttons.find(button => button.textContent === 'Delete formula')?.disabled).toBe(true);
    expect(state.editor!.getMarkdown()).toBe('$y$');
  });
  it('selects a clicked formula, highlights its rendered box, and deletes it with the keyboard', async () => {
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown={'Before $x$ after.'} />));
    const formula = host.querySelector<HTMLElement>('[data-type="inline-math"]')!;
    await act(async () => formula.click());
    expect(host.querySelector('[aria-label="Selected formula"]')).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Yellow highlight"]')!.click());
    expect(host.querySelector<HTMLElement>('[data-type="inline-math"]')!.style.backgroundColor).toBe('rgb(255, 240, 168)');
    await act(async () => host.querySelector('.ProseMirror')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Backspace', bubbles: true, cancelable: true})));
    expect(host.querySelector('[data-type="inline-math"]')).toBeNull();
    expect(state.editor!.state.doc.textContent).toBe('Before  after.');
    await act(async () => state.editor!.commands.undo());
    expect(host.querySelector('[data-type="inline-math"]')).not.toBeNull();
  });

  it('changes formula layout from its attached button and keyboard shortcut', async () => {
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown={'Before.\n\n$$\nx=1\n$$'} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Convert formula to inline"]')!.click());
    expect(state.editor!.getMarkdown()).toBe('Before. $x=1$');
    await act(async () => host.querySelector<HTMLElement>('[data-type="inline-math"]')!.click());
    await act(async () => host.querySelector('.ProseMirror')!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'M', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    })));
    expect(state.editor!.getMarkdown()).toMatch(/^Before\.\n\n\$\$\nx=1\n\$\$/);
  });

  it('saves every converted multiline formula on one source line and renders the result', async () => {
    const formulaBodies = [
      '\\boxed{\n\\frac{(r_a-\\hat\\rho_a(x)) I[\\pi(x)=a]}{\\hat p(a|x,h)}\n+ \\hat\\rho_{\\pi(x)}(x)\n}',
      '\\boxed{\n\\text{prediction for target action}\n+ \\text{correction if observed}\n}',
      '\\hat\\rho_{\\pi(x)}(x)',
      '\\boxed{\n\\Delta_a\n=\n\\hat\\rho_a-\\rho_a\n}',
      'r_a-\\hat\\rho_a\n=\nr_a-\\rho_a-\\Delta_a',
      'E[r_a-\\rho_a\\mid x,a]=0',
      'a=\\pi(x)',
      'E_a\\left[\\frac{I[a=\\pi(x)]}{\\hat p(a|x,h)}\\right]\n=\n\\frac{p(\\pi(x)|x,h)}{\\hat p(\\pi(x)|x,h)}',
      '\\delta=1-\\frac{p}{\\hat p}',
      '\\boxed{\nE[\\text{DR estimate}]\n=\nV^\\pi+E[\\Delta\\delta]\n}',
      '\\boxed{\nV^\\pi\n=\nE_x[\\rho_{\\pi(x)}(x)]\n}',
      '\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}',
    ];
    const markdown = [
      ...formulaBodies.flatMap((body, index) => [
        `Formula ${index + 1}`,
        '',
        '$$',
        body,
        '$$',
        '',
      ]),
      'Continue.',
    ].join('\n');
    const save = vi.fn();
    await act(async () => root.render(
      <DiscussionMarkdownSurfaceImpl editable markdown={markdown} onSave={save} />,
    ));
    while (host.querySelector('[aria-label="Convert formula to inline"]')) {
      await act(async () => host.querySelector<HTMLButtonElement>(
        '[aria-label="Convert formula to inline"]',
      )!.click());
    }
    const saved = state.editor!.getMarkdown();
    expect(saved).not.toContain('$$');
    expect([...saved.matchAll(/(?<!\$)\$(?!\$)((?:\\.|[^$\n\\])+)\$(?!\$)/g)])
      .toHaveLength(formulaBodies.length);
    expect(saved.match(/\$/g)).toHaveLength(formulaBodies.length * 2);
    expect(host.querySelectorAll('[data-type="inline-math"]')).toHaveLength(formulaBodies.length);
    await act(async () => [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Save')!.click());
    expect(save).toHaveBeenCalledWith(saved, []);

    await act(async () => root.render(
      <MarkdownMathRenderer>{saved}</MarkdownMathRenderer>,
    ));
    expect(host.querySelectorAll('.katex')).toHaveLength(formulaBodies.length);
    expect(host.textContent).not.toContain('$r_a');
    expect(host.textContent).toContain('Continue.');
  });

  it('edits by double-click, previews conversion, cancels safely, applies and deletes from the dialog', async () => {
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown={'$$\nx=1\n$$'} />));
    async function open() {await act(async () => host.querySelector('[data-type="block-math"]')!.dispatchEvent(new MouseEvent('dblclick', {bubbles: true})));}
    async function click(label: string) {await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === label)!.click());}
    await open();
    expect(host.querySelector('[aria-label="Formula preview"] .katex')).not.toBeNull();
    await click('To inline'); await click('Cancel');
    expect(host.querySelector('[data-type="block-math"]')).not.toBeNull();
    await open(); await click('To inline'); await click('Apply');
    expect(host.querySelector('[data-type="block-math"]')).toBeNull();
    expect(host.querySelector('[data-type="inline-math"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLElement>('[data-type="inline-math"]')!.click());
    await act(async () => host.querySelector('.ProseMirror')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})));
    await click('Delete formula');
    expect(host.querySelector('[data-type="inline-math"]')).toBeNull();
  });

  it('pastes plain-text formulas directly into a note and reopens each formula once', async () => {
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown="" />));
    const paste = new Event('paste', {bubbles: true, cancelable: true});
    Object.defineProperty(paste, 'clipboardData', {value: {getData: (type: string) => type === 'text/plain' ? 'Compare $G_1$.\n\n$$\n\\gamma=0.9\n$$' : ''}});
    await act(async () => host.querySelector('.ProseMirror')!.dispatchEvent(paste));
    const saved = state.editor!.getMarkdown();
    expect(host.querySelectorAll('[data-type="inline-math"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-type="block-math"]')).toHaveLength(0);
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl key="reopened" markdown={saved} />));
    expect(host.querySelectorAll('[data-type="inline-math"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-type="block-math"]')).toHaveLength(0);
  });

  it('keeps drafts and undo when resizing the note workspace', async () => {
    await act(async () => root.render(<NoteWorkspace editing onEdit={() => {}}><Controlled /></NoteWorkspace>));
    const editor = state.editor!;
    const original = editor.getMarkdown();
    await act(async () => editor.commands.insertContent('Draft '));
    const draft = editor.getMarkdown();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Larger note text"]')!.click();
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('More space'))!.click();
    });
    expect(state.editor).toBe(editor);
    expect(editor.getMarkdown()).toBe(draft);
    expect(host.querySelector('.noteWorkspace.expanded')).not.toBeNull();
    await act(async () => editor.commands.undo());
    expect(editor.getMarkdown()).toBe(original);
  });

  it('keeps cursor, formula nodes and undo history across parent echoes', async () => {
    await act(async () => root.render(<Controlled />));
    const editor = state.editor!;
    const initial = editor.state.doc.toJSON();
    await act(async () => {
      editor.commands.setTextSelection(7);
      editor.commands.insertContent(' stable');
    });
    expect(state.editor).toBe(editor);
    expect(editor.state.selection.from).toBe(14);
    await act(async () => editor.commands.undo());
    expect(editor.state.doc.toJSON()).toEqual(initial);
    await act(async () => {
      editor.commands.setTextSelection({from:1,to:editor.state.doc.content.size - 1});
      editor.commands.toggleHighlight({color:'#fff0a8'});
    });
    expect(editor.state.doc.toJSON().content[0].content.find((n: {type: string}) => n.type === 'inlineMath').marks[0].type).toBe('highlight');
    await act(async () => editor.commands.undo());
    expect(editor.state.doc.toJSON()).toEqual(initial);
  });

  it('retains the exact original on a no-op save and keeps failed drafts visible', async () => {
    const original = 'Original  spacing.\n\n$$\nx*{y}\n$$';
    const save = vi.fn().mockResolvedValue(false);
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown={original} onSave={save} />));
    const button = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Save')!;
    await act(async () => button.click());
    expect(save).toHaveBeenCalledWith(original, []);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Your draft is still here');
    expect(host.querySelector('.ProseMirror')).not.toBeNull();
  });

  it('uses the same asynchronous save path for the keyboard shortcut', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Connection interrupted'));
    await act(async () => root.render(<DiscussionMarkdownSurfaceImpl editable markdown="Day note" onSave={save} />));
    await act(async () => host.querySelector('.ProseMirror')!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', metaKey: true, bubbles: true, cancelable: true,
    })));
    expect(save).toHaveBeenCalledWith('Day note', []);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Connection interrupted');
    expect(host.querySelector('.ProseMirror')?.textContent).toBe('Day note');
  });

  it('colours the source passage when a follow-up is queued', async () => {
    const reviewItemsChanged = vi.fn();
    await act(async () => root.render(
      <DiscussionMarkdownSurfaceImpl
        editable
        markdown="Alpha beta."
        onReviewItemsChange={reviewItemsChanged}
        reviewMode
      />,
    ));
    await act(async () => {
      state.editor!.commands.setTextSelection({from: 1, to: 6});
      host.querySelector<HTMLButtonElement>('button[title^="Select text"]')!.click();
    });
    const draft = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="What should the tutor clarify?"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(draft, 'Why is this important?');
      draft.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === 'Queue follow-up')!
        .click();
    });
    expect(state.editor!.getMarkdown()).toContain('!!Alpha!!');
    expect(reviewItemsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({kind: 'question', markdown: 'Why is this important?', quote: 'Alpha'}),
    ]);
  });
});
