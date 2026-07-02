import type { Annotation, AnnotationStatus } from "../../types/tracker";
import { annotationChapter } from "./annotationDisplay";
import { CompactAnnotationCard } from "./CompactAnnotationCard";

type AnnotationChapterGroupsProps = {
  annotations: Annotation[];
  onAnnotationChange: (
    annotation: Annotation,
    changes: { status?: AnnotationStatus },
  ) => void;
  onDiscuss?: (annotation: Annotation) => void;
};

export function AnnotationChapterGroups({
  annotations,
  onAnnotationChange,
  onDiscuss,
}: AnnotationChapterGroupsProps) {
  const groups = [...annotations.reduce((items, annotation) => {
    const chapter = annotationChapter(annotation);
    const group = items.get(chapter) ?? [];
    group.push(annotation);
    items.set(chapter, group);
    return items;
  }, new Map<string, Annotation[]>()).entries()];

  return (
    <div className="annotationChapterGroups">
      {groups.map(([chapter, captures]) => (
        <details
          className="annotationChapterGroup"
          key={chapter}
          open={groups.length === 1}
        >
          <summary>
            <span>{chapter}</span>
            <strong>{captures.length}</strong>
          </summary>
          <div>
            {captures
              .sort(
                (left, right) =>
                  (left.anchor?.pageNumber ?? 0) -
                  (right.anchor?.pageNumber ?? 0),
              )
              .map((annotation) => (
                <CompactAnnotationCard
                  annotation={annotation}
                  key={`${annotation.id}:${annotation.revision}`}
                  onAnnotationChange={onAnnotationChange}
                  onDiscuss={onDiscuss}
                />
              ))}
          </div>
        </details>
      ))}
    </div>
  );
}
