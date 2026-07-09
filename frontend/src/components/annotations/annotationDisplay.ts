import type { Annotation } from "../../types/tracker";

type AnnotationMetadata = Record<string, unknown>;

function isMetadata(value: unknown): value is AnnotationMetadata {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function annotationMetadata(annotation: Annotation): AnnotationMetadata {
  const metadata = annotation.anchor?.metadata ?? {};
  const selector = metadata.selector;
  return isMetadata(selector) ? { ...metadata, ...selector } : metadata;
}

export function metadataText(
  annotation: Annotation,
  key: string,
): string {
  const value = annotationMetadata(annotation)[key];
  return typeof value === "string" ? value.trim() : "";
}


export function metadataNumber(
  annotation: Annotation,
  key: string,
): number | null {
  const value = annotationMetadata(annotation)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function metadataBoolean(
  annotation: Annotation,
  key: string,
): boolean {
  return annotationMetadata(annotation)[key] === true;
}

export function annotationDisplayText(annotation: Annotation): string {
  return (
    annotation.body?.plainText ||
    metadataText(annotation, "contextSentence") ||
    annotation.anchor?.quote ||
    "Capture without text"
  );
}

export function annotationChapter(annotation: Annotation): string {
  return (
    metadataText(annotation, "chapterTitle") ||
    metadataText(annotation, "chapterLabel") ||
    "Ungrouped"
  );
}

export function annotationSubchapter(annotation: Annotation): string {
  return (
    metadataText(annotation, "subchapterTitle") ||
    annotation.anchor?.sectionTitle ||
    ""
  );
}

export function annotationHasExtendedContext(annotation: Annotation): boolean {
  return Boolean(
    metadataText(annotation, "contextImageUrl") ||
    metadataText(annotation, "contextBefore") ||
      metadataText(annotation, "contextAfter") ||
      (annotation.anchor?.quote &&
        annotation.anchor.quote !== annotationDisplayText(annotation)),
  );
}

export function annotationRgbCss(annotation: Annotation): string {
  if (annotation.kind === "question" && annotation.status === "answered") {
    return "rgb(248 194 207)";
  }
  if (annotation.kind === "todo" && annotation.status === "open") {
    return "rgb(147 178 80)";
  }
  const value = annotationMetadata(annotation).rgb;
  if (!Array.isArray(value) || value.length < 3) {
    if (annotation.kind === "question") return "rgb(222 91 105)";
    if (annotation.kind === "note") return "rgb(166 208 236)";
    return "";
  }
  const channels = value.slice(0, 3).map((channel) => {
    const numeric = typeof channel === "number" ? channel : Number(channel);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(Math.max(0, Math.min(1, numeric)) * 255);
  });
  return `rgb(${channels.join(" ")})`;
}
export function annotationChapterNumber(annotation: Annotation): number | null {
  const direct = metadataNumber(annotation, "chapterNumber");
  if (direct !== null) return Math.trunc(direct);
  const labels = [
    metadataText(annotation, "chapterTitle"),
    metadataText(annotation, "chapterLabel"),
    metadataText(annotation, "subchapterTitle"),
    annotation.anchor?.sectionTitle ?? "",
  ];
  for (const label of labels) {
    const match = label.match(/(?:chapter\s+)?(\d{1,3})(?:\.\d+)?/i);
    if (match) return Number(match[1]);
  }
  return null;
}

export function annotationContextGroupId(annotation: Annotation): string {
  return metadataText(annotation, "contextGroupId");
}

export function annotationParagraphText(annotation: Annotation): string {
  return metadataText(annotation, "contextParagraph");
}

export function annotationParagraphPageRange(
  annotation: Annotation,
): { start: number | null; end: number | null } {
  return {
    start: metadataNumber(annotation, "contextParagraphStartPage"),
    end: metadataNumber(annotation, "contextParagraphEndPage"),
  };
}
