import { Ban, Check, ChevronLeft, ChevronRight, RotateCcw, Undo2, X } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PdfAnnotationCollectionItem } from "../../api/trackerApi";

type CaptureRegionReviewDialogProps = {
  items: PdfAnnotationCollectionItem[];
  onClose: () => void;
  onCollect: (decision: {
    overrides: Record<string, number[]>;
    rejections: Record<string, { targetSourceFingerprint: string | null }>;
  }) => void;
  resourceTitle: string;
};

type DragState = {
  kind: "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se";
  pointerX: number;
  pointerY: number;
  rect: number[];
};

const MINIMUM_CROP_SIZE = 24;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedRect(rect: number[]) {
  return rect.map((value) => Math.round(value * 10) / 10);
}

export function CaptureRegionReviewDialog({
  items,
  onClose,
  onCollect,
  resourceTitle,
}: CaptureRegionReviewDialogProps) {
  const reviewItems = useMemo(
    () => items.filter((item) => item.requiresCaptureReview),
    [items],
  );
  const [index, setIndex] = useState(0);
  const [rects, setRects] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(
      reviewItems.map((item) => [
        item.sourceFingerprint,
        [...item.captureRect],
      ]),
    ),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rejections, setRejections] = useState<
    Record<string, { targetSourceFingerprint: string | null }>
  >({});
  const stageRef = useRef<HTMLDivElement>(null);
  const item = reviewItems[index];

  if (!item) return null;
  const rect = rects[item.sourceFingerprint] ?? item.captureRect;
  const [x0, y0, x1, y1] = rect;
  const width = Math.max(1, item.pageWidth);
  const height = Math.max(1, item.pageHeight);
  const rejection = rejections[item.sourceFingerprint];

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    kind: DragState["kind"],
  ) {
    if (rejection) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      kind,
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect: [...rect],
    });
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!drag || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    const dx = ((event.clientX - drag.pointerX) / bounds.width) * width;
    const dy = ((event.clientY - drag.pointerY) / bounds.height) * height;
    let [nextX0, nextY0, nextX1, nextY1] = drag.rect;
    if (drag.kind === "move") {
      const cropWidth = nextX1 - nextX0;
      const cropHeight = nextY1 - nextY0;
      nextX0 = clamp(nextX0 + dx, 0, width - cropWidth);
      nextY0 = clamp(nextY0 + dy, 0, height - cropHeight);
      nextX1 = nextX0 + cropWidth;
      nextY1 = nextY0 + cropHeight;
    } else {
      if (drag.kind.endsWith("w")) {
        nextX0 = clamp(nextX0 + dx, 0, nextX1 - MINIMUM_CROP_SIZE);
      } else {
        nextX1 = clamp(nextX1 + dx, nextX0 + MINIMUM_CROP_SIZE, width);
      }
      if (drag.kind.includes("n")) {
        nextY0 = clamp(nextY0 + dy, 0, nextY1 - MINIMUM_CROP_SIZE);
      } else {
        nextY1 = clamp(nextY1 + dy, nextY0 + MINIMUM_CROP_SIZE, height);
      }
    }
    setRects((current) => ({
      ...current,
      [item.sourceFingerprint]: roundedRect([
        nextX0,
        nextY0,
        nextX1,
        nextY1,
      ]),
    }));
  }

  function updateNumber(position: number, value: number) {
    const next = [...rect];
    next[position] = value;
    const normalized = [
      clamp(Math.min(next[0], next[2] - MINIMUM_CROP_SIZE), 0, width),
      clamp(Math.min(next[1], next[3] - MINIMUM_CROP_SIZE), 0, height),
      clamp(Math.max(next[2], next[0] + MINIMUM_CROP_SIZE), 0, width),
      clamp(Math.max(next[3], next[1] + MINIMUM_CROP_SIZE), 0, height),
    ];
    setRects((current) => ({
      ...current,
      [item.sourceFingerprint]: roundedRect(normalized),
    }));
  }

  return (
    <div className="questionDialogBackdrop" role="presentation">
      <section
        aria-labelledby="capture-region-review-title"
        aria-modal="true"
        className="questionDialog captureRegionReviewDialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">Capture debug mode</p>
            <h2 id="capture-region-review-title">Check the screenshot region</h2>
            <small>{resourceTitle}</small>
          </div>
          <button aria-label="Close region review" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="captureReviewToolbar">
          <span>
            Capture {index + 1} of {reviewItems.length} · page {item.page ?? "?"}
          </span>
          <strong>
            {item.layoutMode === "two_column" ? "Two-column" : "Full-page"}
            {item.layoutColumn !== "full" ? ` · ${item.layoutColumn}` : ""}
          </strong>
          <button
            onClick={() =>
              setRects((current) => ({
                ...current,
                [item.sourceFingerprint]: [...item.proposedCaptureRect],
              }))
            }
            type="button"
          >
            <RotateCcw size={14} /> Reset suggestion
          </button>
          <button
            className={rejection ? "captureKeepButton" : "captureRejectButton"}
            onClick={() =>
              setRejections((current) => {
                if (current[item.sourceFingerprint]) {
                  const next = { ...current };
                  delete next[item.sourceFingerprint];
                  return next;
                }
                return {
                  ...current,
                  [item.sourceFingerprint]: { targetSourceFingerprint: null },
                };
              })
            }
            type="button"
          >
            {rejection ? <Undo2 size={14} /> : <Ban size={14} />}
            {rejection ? "Keep screenshot" : "Screenshot should not exist"}
          </button>
        </div>

        {rejection ? (
          <div className="captureRejectionPanel">
            <strong>This capture will not be created.</strong>
            <span>
              It will be recorded in the capture bug log so the same decision is
              reused on later collections.
            </span>
            <label>
              <span>Attach its source marks to an existing question group (optional)</span>
              <select
                aria-label="Duplicate target question group"
                onChange={(event) =>
                  setRejections((current) => ({
                    ...current,
                    [item.sourceFingerprint]: {
                      targetSourceFingerprint: event.target.value || null,
                    },
                  }))
                }
                value={rejection.targetSourceFingerprint ?? ""}
              >
                <option value="">No target — suppress this capture</option>
                {item.attachmentCandidates.map((candidate) => (
                  <option
                    key={candidate.sourceFingerprint}
                    value={candidate.sourceFingerprint}
                  >
                    {`Page ${candidate.page} · ${candidate.layoutColumn}${
                      candidate.existing ? " · existing" : " · new"
                    } · ${candidate.text || "Screenshot"}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div
          className={`captureReviewStage${rejection ? " rejected" : ""}`}
          ref={stageRef}
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <img alt={`Annotated PDF page ${item.page ?? ""}`} src={item.annotatedPageImageUrl} />
          <div className="captureReviewShade" />
          <div
            aria-label="Screenshot crop. Drag to move; use corner handles to resize."
            className="captureReviewCrop"
            onPointerDown={(event) => beginDrag(event, "move")}
            onPointerMove={moveDrag}
            onPointerUp={() => setDrag(null)}
            style={{
              height: `${((y1 - y0) / height) * 100}%`,
              left: `${(x0 / width) * 100}%`,
              top: `${(y0 / height) * 100}%`,
              width: `${((x1 - x0) / width) * 100}%`,
            }}
          >
            {(["nw", "ne", "sw", "se"] as const).map((corner) => (
              <button
                aria-label={`Resize ${corner} corner`}
                className={`captureResizeHandle ${corner}`}
                key={corner}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginDrag(event, `resize-${corner}`);
                }}
                onPointerMove={moveDrag}
                onPointerUp={() => setDrag(null)}
                type="button"
              />
            ))}
          </div>
        </div>

        <div className="captureCoordinateFields">
          {[
            ["Left", 0],
            ["Top", 1],
            ["Right", 2],
            ["Bottom", 3],
          ].map(([label, position]) => (
            <label key={String(label)}>
              <span>{label}</span>
              <input
                disabled={Boolean(rejection)}
                max={position === 0 || position === 2 ? width : height}
                min={0}
                onChange={(event) =>
                  updateNumber(Number(position), Number(event.target.value))
                }
                step="0.1"
                type="number"
                value={Math.round(rect[Number(position)] * 10) / 10}
              />
            </label>
          ))}
        </div>

        <footer>
          <button
            className="commandButton subtle"
            disabled={index === 0}
            onClick={() => setIndex((current) => current - 1)}
            type="button"
          >
            <ChevronLeft size={15} /> Previous
          </button>
          {index < reviewItems.length - 1 ? (
            <button
              className="commandButton"
              onClick={() => setIndex((current) => current + 1)}
              type="button"
            >
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button
              className="commandButton"
              onClick={() =>
                onCollect({
                  overrides: Object.fromEntries(
                    Object.entries(rects).filter(
                      ([fingerprint]) => !rejections[fingerprint],
                    ),
                  ),
                  rejections,
                })
              }
              type="button"
            >
              <Check size={15} /> Save regions &amp; collect
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
