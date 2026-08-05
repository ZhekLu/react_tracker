import {
  Copy,
  MessageSquarePlus,
  NotebookPen,
} from "lucide-react";
import type {
  Annotation,
  AnnotationStatus,
  EntityNoteSaveInput,
  Resource,
} from "../../types/tracker";
import { AnnotationChapterGroups } from "./AnnotationChapterGroups";

type ResourceCaptureShelfProps = {
  onAnnotationChange: (
    annotation: Annotation,
    changes: { status?: AnnotationStatus; postponed?: boolean },
  ) => void;
  onCopyQuestions: (resource: Resource) => void;
  onCreateRequest: () => void;
  onDiscuss: () => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  resource: Resource;
};

export function ResourceCaptureShelf({
  onAnnotationChange,
  onCopyQuestions,
  onCreateRequest,
  onDiscuss,
  onNoteSave,
  onOpenChange,
  open,
  resource,
}: ResourceCaptureShelfProps) {
  const captures = resource.annotations.filter(
    (annotation) => annotation.status !== "archived",
  );
  const activeCount = captures.filter(
    (annotation) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open" &&
      !annotation.postponed,
  ).length;

  return (
    <details
      className="resourceCaptureShelf"
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <span>
          <NotebookPen size={14} />
          Captures
        </span>
        <strong>
          {activeCount ? `${activeCount} active · ` : ""}
          {captures.length} saved
        </strong>
      </summary>
      <div className="resourceCaptureShelfBody">
        <header>
          <button onClick={onCreateRequest} type="button">
            <MessageSquarePlus size={13} /> New capture
          </button>
          {resource.openQuestionCount ? (
            <button
              onClick={() => onCopyQuestions(resource)}
              type="button"
            >
              <Copy size={13} /> Copy questions
            </button>
          ) : null}
        </header>
        <AnnotationChapterGroups
          annotations={captures}
          onAnnotationChange={onAnnotationChange}
          onDiscuss={onDiscuss}
          onNoteSave={onNoteSave}
        />
        {!captures.length ? (
          <p className="emptyInline">
            No captures yet. Save the first idea while the source is fresh.
          </p>
        ) : null}
      </div>
    </details>
  );
}
