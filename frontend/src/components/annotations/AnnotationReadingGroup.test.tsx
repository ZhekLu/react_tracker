// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../types/tracker";
import { AnnotationChapterGroups } from "./AnnotationChapterGroups";
import { annotationReadingTop } from "./annotationDisplay";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

const capture = (id: string, quote: string): Annotation => ({id, resourceId: "paper", notes: [],
  kind: "highlight", priority: "normal", status: "open", createdAt: id, revision: 1,
  anchor: {pageNumber: 3, quote, metadata: {contextGroupId: "paragraph", contextParagraph: "The café has useful context and two highlights."}},
} as unknown as Annotation);

describe("annotation reading", () => {
  it("normalizes Drawboard bottom-origin and local top-origin geometry", () => {
    const cloud = {...capture("cloud", "text"), origin: "drawboard_cloud", anchor: {rect: [10, 480, 30, 500], metadata: {pageHeight: 648}}} as Annotation;
    const local = {...capture("local", "text"), origin: "pdf", anchor: {rect: [10, 200, 30, 220]}} as Annotation;
    expect(annotationReadingTop(cloud)).toBe(148);
    expect(annotationReadingTop(local)).toBe(200);
  });
  it("reads one paragraph, reveals selected overlapping highlights by keyboard, and preserves the card view", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); const change = vi.fn();
    try {
      await act(async () => root.render(<AnnotationChapterGroups flat annotations={[capture("a", "cafe has useful"), capture("b", "useful context")]}
        onAnnotationChange={change}/>));
      const group = host.querySelector(".annotationReadingGroup")!;
      expect(host.querySelectorAll(".annotationReadingGroup")).toHaveLength(1);
      expect(group.querySelector("p")?.textContent).toBe("The café has useful context and two highlights.");
      const controls = group.querySelector<HTMLElement>(".annotationReadingControls")!;
      expect(controls.hidden).toBe(true);
      const overlap = [...group.querySelectorAll<HTMLElement>('mark[role="button"]')].find(e => e.textContent?.trim() === "useful")!;
      await act(async () => overlap.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})));
      expect(controls.hidden).toBe(false);
      expect(controls.querySelectorAll(".compactCaptureCard")).toHaveLength(2);
      await act(async () => controls.querySelector<HTMLButtonElement>('[aria-label="Mark capture important"]')!.click());
      expect(change).toHaveBeenCalledWith(expect.objectContaining({id: "a"}), {priority: "high"});
      await act(async () => controls.querySelector<HTMLButtonElement>('[aria-label="Archive capture"]')!.click());
      expect(change).toHaveBeenCalledWith(expect.objectContaining({id: "a"}), {status: "archived"});
      await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Cards")!.click());
      expect(group.parentElement?.hidden).toBe(true);
      await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Reading")!.click());
      expect(controls.hidden).toBe(false);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it("keeps standalone paragraph context and unmatched captures accessible", async () => {
    const host = document.createElement("div"); const root = createRoot(host);
    try {
      await act(async () => root.render(<AnnotationChapterGroups flat annotations={[capture("a", "not found")]}
        onAnnotationChange={vi.fn()}/>));
      expect(host.querySelector(".annotationReadingText > p")?.textContent).toContain("useful context");
      await act(async () => host.querySelector<HTMLButtonElement>(".annotationReadingMargin button")!.click());
      expect(host.querySelector<HTMLElement>(".annotationReadingControls")!.hidden).toBe(false);
    } finally { await act(async () => root.unmount()); }
  });
});
