import { CircleHelp, Clock3, Layers3 } from "lucide-react";
import { ParagraphHighlights } from "./ParagraphHighlights";
import type {
  Annotation,
  AnnotationStatus,
  EntityNoteSaveInput,
} from "../../types/tracker";
import { CompactAnnotationCard } from "./CompactAnnotationCard";
import {
  annotationParagraphPageRange,
  annotationIsScreenshot,
  annotationParagraphText,
  metadataBoolean,
  metadataText,
} from "./annotationDisplay";

type ParagraphAnnotationGroupCardProps = {
  annotations: Annotation[];
  onAnnotationChange: (
    annotation: Annotation,
    changes: {
      status?: AnnotationStatus;
      postponed?: boolean;
      skipped?: boolean;
    },
  ) => void;
  onDiscuss?: (annotation: Annotation) => void;
  onNoteSave?: (input: EntityNoteSaveInput) => void;
  expandCaptures?: boolean;
};

export function ParagraphAnnotationGroupCard({
  annotations,
  onAnnotationChange,
  onDiscuss,
  onNoteSave,
  expandCaptures = false,
}: ParagraphAnnotationGroupCardProps) {
  const first = annotations[0];
  const paragraph = annotationParagraphText(first);
  const screenshotsOnly = annotations.every(annotationIsScreenshot);
  const pageRange = annotationParagraphPageRange(first);
  const contextImages = [
    ...new Set(
      annotations
        .map((annotation) => metadataText(annotation, "contextImageUrl"))
        .filter(Boolean),
    ),
  ];
  const activeQuestions = annotations.filter(
    (annotation) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open" &&
      !annotation.postponed &&
      !annotation.skipped,
  ).length;
  const postponableQuestions = annotations.filter(
    (annotation) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open",
  );
  const postponedQuestions = postponableQuestions.filter(
    (annotation) => annotation.postponed,
  ).length;
  const wholeGroupPostponed =
    postponableQuestions.length > 0 &&
    postponedQuestions === postponableQuestions.length;
  const pageLabel =
    pageRange.start && pageRange.end && pageRange.start !== pageRange.end
      ? `pp. ${pageRange.start}–${pageRange.end}`
      : pageRange.start
        ? `p. ${pageRange.start}`
        : first.anchor?.pageNumber
          ? `p. ${first.anchor.pageNumber}`
          : "";

  return (
    <article className="paragraphCaptureGroup">
      <header>
        <span>
          <Layers3 size={13} />
          {screenshotsOnly ? "Screenshot group" : "One paragraph"} · {annotations.length} capture
          {annotations.length === 1 ? "" : "s"}
        </span>
        <span>
          {activeQuestions ? (
            <strong className="question">
              <CircleHelp size={12} /> {activeQuestions}
            </strong>
          ) : null}
          {postponedQuestions ? (
            <strong className="later">
              <Clock3 size={12} /> {postponedQuestions}
            </strong>
          ) : null}
          {postponableQuestions.length > 1 ? (
            <button
              aria-label={
                wholeGroupPostponed
                  ? "Return question group to active review"
                  : "Review question group later"
              }
              className={wholeGroupPostponed ? "groupLater active" : "groupLater"}
              onClick={() =>
                postponableQuestions
                  .filter(
                    (annotation) =>
                      annotation.postponed === wholeGroupPostponed,
                  )
                  .forEach((annotation) =>
                    onAnnotationChange(annotation, {
                      postponed: !wholeGroupPostponed,
                    }),
                  )
              }
              title={
                wholeGroupPostponed
                  ? "Make unresolved questions in this group active"
                  : "Review unresolved questions in this group later"
              }
              type="button"
            >
              <Clock3 size={12} /> Group
            </button>
          ) : null}
          {pageLabel ? <em>{pageLabel}</em> : null}
        </span>
      </header>
      {contextImages.length ? (
        <div className="paragraphCaptureImages">
          {contextImages.map((source, index) => (
            <img
              alt={`Handwritten capture ${index + 1} for this paragraph`}
              key={source}
              src={source}
            />
          ))}
        </div>
      ) : null}
      {paragraph && !screenshotsOnly ? (
        <p className="paragraphCaptureContext">
          <ParagraphHighlights paragraph={paragraph} annotations={annotations}/>
          {metadataBoolean(first, "contextParagraphTruncated") ? (
            <small> Context shortened around the captured sentences.</small>
          ) : null}
        </p>
      ) : null}
      <div className="paragraphCaptureItems">
        {annotations.map((annotation) => (
          <CompactAnnotationCard
            annotation={annotation}
            initiallyExpanded={expandCaptures}
            key={`${annotation.id}:${annotation.revision}`}
            onAnnotationChange={onAnnotationChange}
            onDiscuss={onDiscuss}
            onNoteSave={onNoteSave}
            showExtendedContext={false}
          />
        ))}
      </div>
    </article>
  );
}
