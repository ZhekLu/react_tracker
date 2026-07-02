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
    metadataText(annotation, "contextBefore") ||
      metadataText(annotation, "contextAfter") ||
      (annotation.anchor?.quote &&
        annotation.anchor.quote !== annotationDisplayText(annotation)),
  );
}
