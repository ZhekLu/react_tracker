import type { CSSProperties, ReactNode } from "react";
import type { Annotation } from "../../types/tracker";
import { annotationRgbCss } from "./annotationDisplay";
import { paragraphHighlightRanges } from "./paragraphHighlightRanges";

export function ParagraphHighlights({ paragraph, annotations, onSelect }: {
  paragraph: string; annotations: Annotation[]; onSelect?: (annotationIds: string[]) => void;
}) {
  const ranges = paragraphHighlightRanges(paragraph, annotations);
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
    const colors = [...new Set(uniqueAnnotations.map(annotationRgbCss).filter(Boolean))];
    const rgb = colors.reduce((mixed, color, index) => index === 0 ? color :
      `color-mix(in srgb, ${mixed} ${100 * index / (index + 1)}%, ${color})`, "");
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
        style={{
          ...(rgb ? {"--capture-color": rgb} : {}),
          background: "color-mix(in srgb, var(--capture-color, #f3dc79) 32%, transparent)",
          boxShadow: "none",
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        } as CSSProperties}
        title={`${uniqueAnnotations.length} capture${uniqueAnnotations.length === 1 ? "" : "s"}: ${uniqueAnnotations.map((annotation) => annotation.kind).join(", ")}`}
      >
        {paragraph.slice(start, end)}
      </mark>,
    );
  }
  return <>{nodes}</>;
}

