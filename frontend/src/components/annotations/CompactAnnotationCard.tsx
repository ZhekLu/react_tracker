import {
  Archive,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
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
  annotationIsScreenshot,
  annotationRgbCss,
  annotationSubchapter,
  metadataText,
} from "./annotationDisplay";
import { QuestionAnswerReferences } from "./QuestionAnswerReferences";

type CompactAnnotationCardProps = {
  annotation: Annotation;
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
  showExtendedContext?: boolean;
  initiallyExpanded?: boolean;
};

export function CompactAnnotationCard({
  annotation,
  onAnnotationChange,
  onDiscuss,
  onNoteSave,
  showExtendedContext = true,
  initiallyExpanded = false,
}: CompactAnnotationCardProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const isScreenshot = annotationIsScreenshot(annotation);
  const color = annotation.anchor?.color || "none";
  const rgb = annotationRgbCss(annotation);
  const sectionTitle = annotationSubchapter(annotation);
  const contextBefore = metadataText(annotation, "contextBefore");
  const contextAfter = metadataText(annotation, "contextAfter");
  const contextImageUrl = metadataText(annotation, "contextImageUrl");
  const displayText = annotationDisplayText(annotation);
  const canAnswer =
    annotation.kind === "question" || annotation.kind === "todo";
  const canPostpone = canAnswer && annotation.status === "open";
  const hasContext =
    showExtendedContext && annotationHasExtendedContext(annotation);
  const canExpand =
    hasContext ||
    Boolean(onNoteSave) ||
    Boolean(annotation.answerReferences?.length);

  return (
    <article
      className={`compactCaptureCard kind-${annotation.kind} status-${annotation.status} color-${color} ${annotation.postponed ? "postponed" : ""} ${expanded ? "expanded" : ""}`}
      style={
        rgb
          ? ({ "--capture-color": rgb } as CSSProperties)
          : undefined
      }
    >
      <span
        aria-label={`${annotation.kind}; ${
          color === "none" ? "no capture colour" : `${color} capture`
        }`}
        className="captureColorMark"
      />
      <button
        className="compactCaptureMain"
        disabled={!canExpand}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="compactCaptureMeta">
          {annotation.anchor?.pageNumber ? (
            <span>p. {annotation.anchor.pageNumber}</span>
          ) : null}
          {canAnswer && annotation.discussionResponseCount ? (
            <span
              className="compactCaptureDiscussionBadge"
              title={`${annotation.discussionResponseCount} mapped tutor ${annotation.discussionResponseCount === 1 ? "response" : "responses"}`}
            >
              <MessageSquareText aria-hidden="true" size={9} />
              mapped
            </span>
          ) : null}
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
        {canPostpone ? (
          <button
            aria-label={
              annotation.postponed
                ? "Return capture to active questions"
                : "Review capture later"
            }
            className={annotation.postponed ? "later active" : "later"}
            onClick={() =>
              onAnnotationChange(annotation, {
                postponed: !annotation.postponed,
              })
            }
            title={annotation.postponed ? "Make active" : "Review later"}
            type="button"
          >
            <Clock3 size={12} />
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
          {showExtendedContext && sectionTitle ? (
            <p className="compactCaptureSectionTitle">{sectionTitle}</p>
          ) : null}
          {showExtendedContext && contextImageUrl ? (
            <img
              alt={`Page ${annotation.anchor?.pageNumber ?? ""} around handwritten question`}
              className="compactCaptureImage"
              src={contextImageUrl}
            />
          ) : null}
          {showExtendedContext && !isScreenshot && contextBefore ? <p>{contextBefore}</p> : null}
          {showExtendedContext && !isScreenshot && annotation.anchor?.quote ? (
            <blockquote>{annotation.anchor.quote}</blockquote>
          ) : null}
          {showExtendedContext && !isScreenshot && contextAfter ? <p>{contextAfter}</p> : null}
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
          <QuestionAnswerReferences references={annotation.answerReferences} />
        </div>
      ) : null}
    </article>
  );
}
