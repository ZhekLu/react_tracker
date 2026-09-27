// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotationCollectionItem } from "../../api/trackerApi";
import { CaptureRegionReviewDialog } from "./CaptureRegionReviewDialog";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const reviewItem: PdfAnnotationCollectionItem = {
  outcome: "created",
  kind: "question",
  text: "Why is the estimator stationary?",
  page: 3,
  sectionTitle: "",
  sourceDayId: "day-17",
  sourceFingerprint: "duplicate",
  contextImageUrl: "/capture.png",
  annotatedPageImageUrl: "/page.png",
  proposedCaptureRect: [300, 320, 610, 520],
  captureRect: [300, 320, 610, 520],
  pageWidth: 612,
  pageHeight: 792,
  layoutMode: "two_column",
  layoutColumn: "right",
  requiresCaptureReview: true,
  attachmentCandidates: [
    {
      sourceFingerprint: "canonical",
      page: 3,
      layoutColumn: "right",
      text: "Existing question group",
      existing: true,
    },
  ],
};

describe("CaptureRegionReviewDialog duplicate decisions", () => {
  it("rejects a screenshot, optionally attaches it, and omits its crop override", async () => {
    const onCollect = vi.fn();
    await act(async () => root.render(
      <CaptureRegionReviewDialog
        items={[reviewItem]}
        onClose={() => {}}
        onCollect={onCollect}
        resourceTitle="Doubly Robust Policy Evaluation"
      />,
    ));

    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Screenshot should not exist"))!
        .click();
    });
    expect(host.textContent).toContain("This capture will not be created.");

    const select = host.querySelector<HTMLSelectElement>(
      '[aria-label="Duplicate target question group"]',
    )!;
    await act(async () => {
      select.value = "canonical";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Save regions"))!
        .click();
    });

    expect(onCollect).toHaveBeenCalledWith({
      overrides: {},
      rejections: {
        duplicate: { targetSourceFingerprint: "canonical" },
      },
    });
  });
});
