import {
  Archive,
  CheckCircle2,
  ChevronDown,
  Circle,
  MessageSquareText,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import { MarkdownMath } from "../content/MarkdownMath";
import { EntityNoteEditor } from "../notes/EntityNoteEditor";
import type {
  Annotation,
  AnnotationStatus,
  EntityNoteSaveInput,
} from "../../types/tracker";
import {
  annotationDisplayText,
  annotationHasExtendedContext,
  annotationRgbCss,
  annotationSubchapter,
  metadataText,
} from "./annotationDisplay";

type CompactAnnotationCardProps = {
  annotation: Annotation;
  onAnnotationChange: (
    annotation: Annotation,
    changes: { status?: AnnotationStatus },
  ) => void;
  onDiscuss?: (annotation: Annotation) => void;
  onNoteSave?: (input: EntityNoteSaveInput) => void;
};

export function CompactAnnotationCard({
  annotation,
  onAnnotationChange,
  onDiscuss,
  onNoteSave,
}: CompactAnnotationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = annotation.anchor?.color || "none";
  const rgb = annotationRgbCss(annotation);
  const subchapter = annotationSubchapter(annotation);
  const contextBefore = metadataText(annotation, "contextBefore");
  const contextAfter = metadataText(annotation, "contextAfter");
  const contextImageUrl = metadataText(annotation, "contextImageUrl");
  const displayText = annotationDisplayText(annotation);
  const canAnswer =
    annotation.kind === "question" || annotation.kind === "todo";
  const hasContext = annotationHasExtendedContext(annotation);
  const canExpand = hasContext || Boolean(onNoteSave);

  return (
    <article
      className={`compactCaptureCard kind-${annotation.kind} status-${annotation.status} color-${color}`}
      style={
        rgb
          ? ({ "--capture-color": rgb } as CSSProperties)
          : undefined
      }
    >
      <span
        aria-label={color === "none" ? "No capture colour" : `${color} capture`}
        className="captureColorMark"
      />
      <button
        className="compactCaptureMain"
        disabled={!canExpand}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="compactCaptureMeta">
          <strong>{annotation.kind}</strong>
          {annotation.anchor?.pageNumber ? (
            <span>p. {annotation.anchor.pageNumber}</span>
          ) : null}
          {subchapter ? <span>{subchapter}</span> : null}
        </span>
        <MarkdownMath>{displayText}</MarkdownMath>
        {canExpand ? (
          <ChevronDown className={expanded ? "expanded" : ""} size={13} />
        ) : null}
      </button>
      <div className="compactCaptureActions">
        {canAnswer ? (
          <button
            aria-label={
              annotation.status === "answered"
                ? "Reopen capture"
                : "Mark capture answered"
            }
            onClick={() =>
              onAnnotationChange(annotation, {
                status:
                  annotation.status === "answered" ? "open" : "answered",
              })
            }
            title={
              annotation.status === "answered" ? "Reopen" : "Mark answered"
            }
            type="button"
          >
            {annotation.status === "answered" ? (
              <Circle size={12} />
            ) : (
              <CheckCircle2 size={12} />
            )}
          </button>
        ) : null}
        {onDiscuss ? (
          <button
            aria-label="Discuss capture"
            onClick={() => onDiscuss(annotation)}
            title="Discuss"
            type="button"
          >
            <MessageSquareText size={12} />
          </button>
        ) : null}
        <button
          aria-label="Archive capture"
          onClick={() =>
            onAnnotationChange(annotation, { status: "archived" })
          }
          title="Archive"
          type="button"
        >
          <Archive size={12} />
        </button>
      </div>
      {expanded ? (
        <div className="compactCaptureContext">
          {contextImageUrl ? (
            <img
              alt={`Page ${annotation.anchor?.pageNumber ?? ""} around handwritten question`}
              className="compactCaptureImage"
              src={contextImageUrl}
            />
          ) : null}
          {contextBefore ? <p>{contextBefore}</p> : null}
          {annotation.anchor?.quote ? (
            <blockquote>{annotation.anchor.quote}</blockquote>
          ) : null}
          {contextAfter ? <p>{contextAfter}</p> : null}
          {onNoteSave ? (
            <EntityNoteEditor
              label="My note"
              note={annotation.notes[0]}
              onSave={(html) =>
                onNoteSave({
                  entityId: annotation.id,
                  entityType: "annotation",
                  html,
                  kind: "annotation",
                  note: annotation.notes[0],
                })
              }
              placeholder="Add your interpretation, confusion, or a useful answer..."
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
