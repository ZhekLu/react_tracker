import { describe, expect, it } from "vitest";
import type { Annotation } from "../../types/tracker";
import { annotationIsScreenshot } from "./annotationDisplay";

function capture(origin: string, metadata: Record<string, unknown>): Annotation {
  return { origin, anchor: { anchorType: "pdf_rect", metadata } } as Annotation;
}

describe("screenshot capture presentation", () => {
  it("recognizes local PDF handwriting and shapes", () => {
    expect(annotationIsScreenshot(capture("pdf_import", { sourceVisual: true }))).toBe(true);
  });
  it("preserves cloud handwriting presentation", () => {
    expect(annotationIsScreenshot(capture("drawboard_cloud_ink", {}))).toBe(true);
  });
  it("keeps searchable highlights as text even when they have a preview", () => {
    expect(annotationIsScreenshot(capture("pdf_import", {
      sourceVisual: false, contextImageUrl: "/image.png",
    }))).toBe(false);
  });
});
