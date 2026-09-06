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

export type TrackedQuestionGroup = {
  annotations: Annotation[];
  key: string;
};

/** Group visual captures that belong to one immutable logical question. */
export function trackedQuestionGroups(
  annotations: readonly Annotation[],
): TrackedQuestionGroup[] {
  const groups = new Map<string, TrackedQuestionGroup>();
  for (const annotation of annotations) {
    if (!isTrackedQuestion(annotation)) continue;
    const key = trackedQuestionKey(annotation);
    const existing = groups.get(key);
    if (existing) {
      existing.annotations.push(annotation);
    } else {
      groups.set(key, { annotations: [annotation], key });
    }
  }
  return [...groups.values()];
}

/** A logical question is queued only while none of its captures has an answer. */
export function queuedTrackedQuestionGroups(
  annotations: readonly Annotation[],
): TrackedQuestionGroup[] {
  return trackedQuestionGroups(annotations).filter((group) =>
    group.annotations.every(
      (annotation) =>
        annotation.status === "open" &&
        !annotation.postponed &&
        !annotation.skipped &&
        (annotation.discussionResponseCount ?? 0) === 0,
    ),
  );
}

/** Mirror the prompt packager's inexpensive attachment eligibility check. */
export function questionCaptureHasAttachment(annotation: Annotation): boolean {
  const metadata = annotation.anchor?.metadata ?? {};
  return Boolean(
    metadata.contextImageUrl ||
      metadata.includeSlideScreenshot ||
      /(?:ink|image)/i.test(annotation.origin) ||
      /(?:ink|image)/i.test(annotation.anchor?.anchorType ?? ""),
  );
}
