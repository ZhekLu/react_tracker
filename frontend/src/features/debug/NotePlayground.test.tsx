// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotePlayground } from "./NotePlayground";
import { createIntegrityEditor, inspectEditorMarkdown } from "../../lib/editorIntegrity";
import example from "../../../../docs/course-note-example.md?raw";
import guide from "../../../../docs/editor-guide.md?raw";

vi.mock("../../components/editor/DiscussionMarkdownSurface", () => ({DiscussionMarkdownSurface: ({markdown, onChange}: {markdown: string; onChange?: (value: string) => void}) => <button data-visual={Boolean(onChange)} onClick={() => onChange?.(`${markdown}\n\nVisual edit.`)}>{markdown}</button>}));
vi.mock("../../lib/checkEditorInWorker", () => ({checkEditorInWorker: async (markdown: string) => inspectEditorMarkdown(markdown)}));
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value)});
});
describe("note playground", () => {
  it('keeps the guide’s math syntax examples literal on their first parse', () => {
    const editor = createIntegrityEditor(guide);
    const formulas: string[] = [];
    editor.state.doc.descendants(node => {if (['inlineMath', 'blockMath'].includes(node.type.name)) formulas.push(node.attrs.latex);});
    expect(formulas).toEqual([]);
    expect(editor.state.doc.child(1).textContent.replace(/\s+/g, ' ')).toContain('inside $…$ or $$…$$. Do not add');
    editor.destroy();
  });
  it.each([["example", example], ["guide", guide]])("round-trips the actual downloadable %s with no integrity failures", (_name, source) => {
    const result = inspectEditorMarkdown(source);
    expect(result.checks).toEqual([]);
    expect(inspectEditorMarkdown(result.reopened).checks).toEqual([]);
  });
  it("keeps source drafts until Apply, echoes visual edits, restores resets, and retains a draft across remount", async () => {
    const host = document.createElement("div"); document.body.append(host);
    let root = createRoot(host);
    await act(async () => root.render(<NotePlayground/>));
    const source = host.querySelector<HTMLTextAreaElement>('[aria-label="Playground Markdown"]')!;
    async function click(text: string) {await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click());}
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, 'Draft $x$.');
      source.dispatchEvent(new Event('input', {bubbles: true}));
    });
    expect(host.querySelector('[data-visual="true"]')?.textContent).toBe(example);
    expect(host.querySelector('.playgroundVisual')?.hasAttribute('inert')).toBe(true);
    await click('Apply Markdown');
    expect(host.querySelector('[data-visual="true"]')?.textContent).toBe('Draft $x$.');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-visual="true"]')!.click());
    expect(source.value).toBe('Draft $x$.\n\nVisual edit.');
    await click('Start blank'); await click('Undo reset');
    expect(source.value).toBe('Draft $x$.\n\nVisual edit.');
    await click('Check save/reopen');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Passed:');
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(<NotePlayground/>));
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Playground Markdown"]')?.value).toBe('Draft $x$.\n\nVisual edit.');
    await act(async () => root.unmount()); host.remove();
  });
});
