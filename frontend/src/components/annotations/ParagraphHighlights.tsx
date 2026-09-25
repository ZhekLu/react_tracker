import type { CSSProperties, ReactNode } from "react";
import type { Annotation } from "../../types/tracker";
import { annotationRgbCss, metadataText } from "./annotationDisplay";

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

export function ParagraphHighlights({ paragraph, annotations, onSelect }: {
  paragraph: string; annotations: Annotation[]; onSelect?: (annotationIds: string[]) => void;
}) {
  const ranges = highlightRanges(paragraph, annotations);
  if (!ranges.length) return <>{paragraph}</>;

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
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? 0 : undefined}
        aria-label={onSelect ? `Show capture controls: ${paragraph.slice(start, end)}` : undefined}
        onClick={onSelect ? () => onSelect(uniqueAnnotations.map(a => a.id)) : undefined}
        onKeyDown={onSelect ? event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault(); onSelect(uniqueAnnotations.map(a => a.id));
          }
        } : undefined}
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
  return <>{nodes}</>;
}

