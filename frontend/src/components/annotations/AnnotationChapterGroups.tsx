import type {
  Annotation,
  AnnotationStatus,
  EntityNoteSaveInput,
} from "../../types/tracker";
import {
  annotationChapter,
  annotationSubchapter,
} from "./annotationDisplay";
import { CompactAnnotationCard } from "./CompactAnnotationCard";

type AnnotationChapterGroupsProps = {
  annotations: Annotation[];
  onAnnotationChange: (
    annotation: Annotation,
    changes: { status?: AnnotationStatus },
  ) => void;
  onDiscuss?: (annotation: Annotation) => void;
  onNoteSave?: (input: EntityNoteSaveInput) => void;
};

export function AnnotationChapterGroups({
  annotations,
  onAnnotationChange,
  onDiscuss,
  onNoteSave,
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
          <div className="annotationSubchapterList">
            {[
              ...captures
                .sort(
                  (left, right) =>
                    (left.anchor?.pageNumber ?? 0) -
                    (right.anchor?.pageNumber ?? 0),
                )
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
              <section className="annotationSubchapterGroup" key={subchapter}>
                <div className="annotationSubchapterSeparator">
                  <span>{subchapter}</span>
                  <strong>{subchapterCaptures.length}</strong>
                </div>
                {subchapterCaptures.map((annotation) => (
                  <CompactAnnotationCard
                    annotation={annotation}
                    key={`${annotation.id}:${annotation.revision}`}
                    onAnnotationChange={onAnnotationChange}
                    onDiscuss={onDiscuss}
                    onNoteSave={onNoteSave}
                  />
                ))}
              </section>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
