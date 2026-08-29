import type { Annotation } from "../types/tracker";

/**
 * Question identity is immutable even when the source mark is recoloured.
 *
 * Drawboard colour decides what a newly imported mark means. Once a capture has
 * received a stable question identity, later colour refreshes must not remove it
 * from question queues or QA scopes.
 */
export function isTrackedQuestion(
  annotation: Pick<Annotation, "kind" | "stableLabel">,
): boolean {
  return (
    annotation.kind === "question" ||
    annotation.kind === "todo" ||
    Boolean(annotation.stableLabel)
  );
}

/** A logical key shared by every visual capture of the same question. */
export function trackedQuestionKey(
  annotation: Pick<Annotation, "id" | "stableLabel">,
): string {
  return annotation.stableLabel
    ? `stable:${annotation.stableLabel}`
    : `annotation:${annotation.id}`;
}
