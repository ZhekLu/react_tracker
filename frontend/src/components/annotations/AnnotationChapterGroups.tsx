import { useState, type ReactNode } from "react";
import type {
  Annotation,
  AnnotationStatus,
  EntityNoteSaveInput,
} from "../../types/tracker";
import {
  annotationChapter,
  annotationChapterNumber,
  annotationContextGroupId,
  annotationParagraphText,
  annotationSubchapter,
} from "./annotationDisplay";
import { CompactAnnotationCard } from "./CompactAnnotationCard";
import { ParagraphAnnotationGroupCard } from "./ParagraphAnnotationGroupCard";

type AnnotationChapterGroupsProps = {
  annotations: Annotation[];
  flat?: boolean;
  preferredChapterNumbers?: number[];
  initiallyOpenAll?: boolean;
  initiallyExpandCaptures?: boolean;
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
};

type LogicalCaptureGroup = {
  id: string;
  annotations: Annotation[];
  paragraph: boolean;
};

function annotationOrder(left: Annotation, right: Annotation): number {
  return (
    (left.anchor?.pageNumber ?? 0) - (right.anchor?.pageNumber ?? 0) ||
    (left.anchor?.sourceLineStart ?? 0) -
      (right.anchor?.sourceLineStart ?? 0) ||
    left.createdAt.localeCompare(right.createdAt)
  );
}

function logicalCaptureGroups(
  annotations: Annotation[],
): LogicalCaptureGroup[] {
  const grouped = new Map<string, Annotation[]>();
  const order: string[] = [];

  for (const annotation of [...annotations].sort(annotationOrder)) {
    const contextGroupId = annotationContextGroupId(annotation);
    const hasParagraph = Boolean(annotationParagraphText(annotation));
    const key =
      contextGroupId && hasParagraph
        ? `paragraph:${contextGroupId}`
        : `annotation:${annotation.id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(annotation);
    } else {
      grouped.set(key, [annotation]);
      order.push(key);
    }
  }

  return order.map((id) => {
    const captures = grouped.get(id) ?? [];
    return {
      annotations: captures,
      id,
      paragraph: id.startsWith("paragraph:") && captures.length > 1,
    };
  });
}

function LogicalCaptureList({
  annotations,
  onAnnotationChange,
  onDiscuss,
  onNoteSave,
  initiallyExpandCaptures = false,
}: Omit<AnnotationChapterGroupsProps, "annotations" | "flat" | "preferredChapterNumbers"> & {
  annotations: Annotation[];
}) {
  return logicalCaptureGroups(annotations).map((group) =>
    group.paragraph ? (
      <ParagraphAnnotationGroupCard
        annotations={group.annotations}
        expandCaptures={initiallyExpandCaptures}
        key={`${group.id}:${initiallyExpandCaptures ? "expanded" : "compact"}`}
        onAnnotationChange={onAnnotationChange}
        onDiscuss={onDiscuss}
        onNoteSave={onNoteSave}
      />
    ) : (
      <CompactAnnotationCard
        annotation={group.annotations[0]}
        initiallyExpanded={initiallyExpandCaptures}
        key={`${group.annotations[0].id}:${group.annotations[0].revision}:${initiallyExpandCaptures ? "expanded" : "compact"}`}
        onAnnotationChange={onAnnotationChange}
        onDiscuss={onDiscuss}
        onNoteSave={onNoteSave}
      />
    ),
  );
}


function AnnotationChapterDetails({
  children,
  className,
  initiallyOpen,
  summary,
}: {
  children: ReactNode;
  className: string;
  initiallyOpen: boolean;
  summary: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <details
      className={className}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export function AnnotationChapterGroups({
  annotations,
  flat = false,
  preferredChapterNumbers = [],
  initiallyOpenAll = false,
  initiallyExpandCaptures = false,
  onAnnotationChange,
  onDiscuss,
  onNoteSave,
}: AnnotationChapterGroupsProps) {
  if (flat) {
    return (
      <div className="annotationFlatList">
        <LogicalCaptureList
          annotations={annotations}
          initiallyExpandCaptures={initiallyExpandCaptures}
          onAnnotationChange={onAnnotationChange}
          onDiscuss={onDiscuss}
          onNoteSave={onNoteSave}
        />
      </div>
    );
  }

  const preferredChapters = new Set(preferredChapterNumbers);
  const groups = [
    ...annotations
      .reduce((items, annotation) => {
        const chapter = annotationChapter(annotation);
        const group = items.get(chapter) ?? [];
        group.push(annotation);
        items.set(chapter, group);
        return items;
      }, new Map<string, Annotation[]>())
      .entries(),
  ].sort((left, right) => {
    const leftNumber = annotationChapterNumber(left[1][0]);
    const rightNumber = annotationChapterNumber(right[1][0]);
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber - rightNumber;
    }
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left[0].localeCompare(right[0]);
  });

  return (
    <div className="annotationChapterGroups">
      {groups.map(([chapter, captures]) => {
        const chapterNumber = annotationChapterNumber(captures[0]);
        const isPreferred =
          chapterNumber !== null && preferredChapters.has(chapterNumber);
        const logicalCount = logicalCaptureGroups(captures).length;

        return (
          <AnnotationChapterDetails
            className={`annotationChapterGroup ${isPreferred ? "preferred" : ""}`}
            initiallyOpen={
              initiallyOpenAll ||
              (preferredChapters.size > 0 ? isPreferred : groups.length === 1)
            }
            key={`${chapter}:${initiallyOpenAll ? "open" : "scoped"}`}
            summary={
              <>
                <span>{chapter}</span>
                <strong>{logicalCount}</strong>
              </>
            }
          >
            <div className="annotationSubchapterList">
              {[
                ...[...captures]
                  .sort(annotationOrder)
                  .reduce((items, annotation) => {
                    const subchapter =
                      annotationSubchapter(annotation) || "General";
                    const group = items.get(subchapter) ?? [];
                    group.push(annotation);
                    items.set(subchapter, group);
                    return items;
                  }, new Map<string, Annotation[]>())
                  .entries(),
              ].map(([subchapter, subchapterCaptures]) => (
                <section
                  className="annotationSubchapterGroup"
                  key={subchapter}
                >
                  <div className="annotationSubchapterSeparator">
                    <span>{subchapter}</span>
                    <strong>
                      {logicalCaptureGroups(subchapterCaptures).length}
                    </strong>
                  </div>
                  <LogicalCaptureList
                    annotations={subchapterCaptures}
                    initiallyExpandCaptures={initiallyExpandCaptures}
                    onAnnotationChange={onAnnotationChange}
                    onDiscuss={onDiscuss}
                    onNoteSave={onNoteSave}
                  />
                </section>
              ))}
            </div>
          </AnnotationChapterDetails>
        );
      })}
    </div>
  );
}
