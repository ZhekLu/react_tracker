import { CircleHelp, Clock3, Layers3 } from "lucide-react";
import { type CSSProperties, type ReactNode } from "react";
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
  annotationRgbCss,
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

type HighlightRange = {
  start: number;
  end: number;
  annotation: Annotation;
};

type NormalizedSearchText = {
  indexes: number[];
  text: string;
};

function normalizedSearchText(value: string): NormalizedSearchText {
  const indexes: number[] = [];
  let text = "";
  let offset = 0;

  for (const character of value) {
    const expanded = character
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[‐‑‒–—−]/g, "-")
      .toLocaleLowerCase();
    if (/^[\p{L}\p{N}]+$/u.test(expanded)) {
      for (const item of expanded) {
        text += item;
        indexes.push(offset);
      }
    } else if (text && !text.endsWith(" ")) {
      text += " ";
      indexes.push(offset);
    }
    offset += character.length;
  }
  return { indexes, text: text.trimEnd() };
}

function normalizedRanges(
  paragraph: string,
  phrase: string,
): Array<{ start: number; end: number }> {
  const haystack = normalizedSearchText(paragraph);
  const needle = normalizedSearchText(phrase).text;
  if (needle.length < 2) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let normalizedStart = haystack.text.indexOf(needle);
  while (normalizedStart >= 0) {
    const normalizedEnd = normalizedStart + needle.length - 1;
    const start = haystack.indexes[normalizedStart] ?? 0;
    const lastSourceIndex = haystack.indexes[normalizedEnd] ?? start;
    const nextSourceIndex = haystack.indexes
      .slice(normalizedEnd + 1)
      .find((index) => index > lastSourceIndex);
    ranges.push({
      end: nextSourceIndex ?? paragraph.length,
      start,
    });
    normalizedStart = haystack.text.indexOf(
      needle,
      normalizedStart + Math.max(needle.length, 1),
    );
  }
  return ranges;
}

function highlightRanges(
  paragraph: string,
  annotations: Annotation[],
): HighlightRange[] {
  const candidates: HighlightRange[] = [];

  for (const annotation of annotations) {
    const quote = annotation.anchor?.quote?.trim();
    if (!quote || quote.length < 2) continue;
    const exactRanges = normalizedRanges(paragraph, quote);
    const ranges = exactRanges.length
      ? exactRanges
      : normalizedRanges(
          paragraph,
          metadataText(annotation, "contextSentence"),
        );
    for (const range of ranges) {
      candidates.push({
        annotation,
        ...range,
      });
    }
  }
  return candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );
}

function highlightedParagraph(
  paragraph: string,
  annotations: Annotation[],
): ReactNode[] {
  const ranges = highlightRanges(paragraph, annotations);
  if (!ranges.length) return [paragraph];

  const boundaries = [
    ...new Set([0, paragraph.length, ...ranges.flatMap((range) => [range.start, range.end])]),
  ].sort((left, right) => left - right);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const active = ranges.filter(
      (range) => range.start < end && range.end > start,
    );
    if (!active.length) {
      nodes.push(paragraph.slice(start, end));
      continue;
    }
    const uniqueAnnotations = [
      ...new Map(
        active.map((range) => [range.annotation.id, range.annotation]),
      ).values(),
    ];
    const colors = uniqueAnnotations
      .map(annotationRgbCss)
      .filter(Boolean);
    const rgb = colors[0] ?? "";
    const gradient =
      colors.length > 1
        ? `linear-gradient(to bottom, ${colors
            .map(
              (color, colorIndex) =>
                `${color} ${(colorIndex / colors.length) * 100}% ${((colorIndex + 1) / colors.length) * 100}%`,
            )
            .join(", ")})`
        : undefined;
    nodes.push(
      <mark
        className={`paragraphCaptureHighlight color-${uniqueAnnotations[0].anchor?.color ?? "none"}`}
        key={`${start}:${end}`}
        style={
          rgb
            ? ({
                "--capture-color": rgb,
                background: gradient,
              } as CSSProperties)
            : undefined
        }
        title={`${uniqueAnnotations.length} capture${uniqueAnnotations.length === 1 ? "" : "s"}: ${uniqueAnnotations.map((annotation) => annotation.kind).join(", ")}`}
      >
        {paragraph.slice(start, end)}
      </mark>,
    );
  }
  return nodes;
}

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
          {highlightedParagraph(paragraph, annotations)}
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
