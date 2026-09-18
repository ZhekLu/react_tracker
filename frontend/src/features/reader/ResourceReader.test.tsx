// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceReader } from "./ResourceReader";
import type { Resource } from "../../types/tracker";

vi.mock("../../api/trackerApi", () => ({
  fetchPdfReaderMetadata: async () => ({pageCount: 2, pages: [{title: "Policy gradients"}, {title: "Baseline"}]}),
  fetchResourceContent: vi.fn(), pdfReaderPageUrl: () => "/slide.png",
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const save = vi.fn();
const resource = {id: "slides", title: "Lecture", kind: "slides", progress: 0,
  localFiles: [], version: {localPath: "lecture.pdf"}} as unknown as Resource;
beforeEach(async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  save.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ResourceReader accent="#123" resource={resource} onClose={vi.fn()}
    onCreateAnnotation={vi.fn()} onCreatePageAnnotation={save} onOpenExternal={vi.fn()}/>));
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
async function start(key: string) {
  await act(async () => host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true})));
  return host.querySelector<HTMLTextAreaElement>("textarea")!;
}
async function type(input: HTMLTextAreaElement, text: string, caret = text.length) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
}
function saveButton() {return [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Save to slide"))!;}

it("starts a slide question with the screenshot template and the caret after it", async () => {
  const input = await start("?");
  expect(input.value).toBe("/screen ");
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(input.value.length);
  expect(saveButton().disabled).toBe(true);
  await type(input, "/screen Why this baseline?");
  await act(async () => saveButton().click());
  expect(save).toHaveBeenCalledWith("question", "Why this baseline?", 1, "Policy gradients", true);
});

it("retains the first typed letter and never moves the caret before it", async () => {
  const input = await start("W");
  expect(input.value).toBe("/screen W");
  expect(input.selectionStart).toBe(9);
  await type(input, "/screen Why??");
  expect(input.selectionStart).toBe(13);
  await act(async () => saveButton().click());
  expect(save).toHaveBeenCalledWith("question", "Why??", 1, "Policy gradients", true);
});

it("keeps the editing position on rerender and allows text-only captures", async () => {
  const input = await start("n");
  await type(input, "A plain note", 2);
  expect(input.selectionStart).toBe(2);
  await act(async () => saveButton().click());
  expect(save).toHaveBeenCalledWith("note", "A plain note", 1, "Policy gradients", false);
});

it("creates a fresh screenshot template for the next capture", async () => {
  const input = await start("!");
  await type(input, "/screen Revisit this");
  await act(async () => saveButton().click());
  expect(save).toHaveBeenCalledWith("todo", "Revisit this", 1, "Policy gradients", true);
  const next = await start("?");
  expect(next.value).toBe("/screen ");
  expect(next.selectionStart).toBe(8);
});
