// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../../types/tracker";
import { EntityNoteEditor } from "./EntityNoteEditor";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

const note = {
  id: "note-1",
  kind: "task",
  attention: "none",
  document: { markdown: "Context before ==remember this== context after." },
} as unknown as Note;

function renderEditor() {
  return act(async () => root.render(
    <EntityNoteEditor
      defaultOpen
      label="Task note"
      note={note}
      onSave={() => {}}
      placeholder="Write"
    />,
  ));
}

describe("EntityNoteEditor reading preference", () => {
  it("keeps highlights-only mode for this note across remounts until Show full note is chosen", async () => {
    await renderEditor();
    await act(async () => host.querySelector<HTMLButtonElement>(
      '[aria-label="Show note highlights only"]',
    )!.click());
    expect(host.querySelector(".entityNoteEditor.highlightsOnly")).not.toBeNull();
    expect(localStorage.getItem("tracker.note.note-1.highlights-only")).toBe("true");

    await act(async () => root.unmount());
    root = createRoot(host);
    await renderEditor();
    expect(host.querySelector(".entityNoteEditor.highlightsOnly")).not.toBeNull();

    await act(async () => host.querySelector<HTMLButtonElement>(
      '[aria-label="Show full note"]',
    )!.click());
    expect(localStorage.getItem("tracker.note.note-1.highlights-only")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await renderEditor();
    expect(host.querySelector(".entityNoteEditor.highlightsOnly")).toBeNull();
  });
});
