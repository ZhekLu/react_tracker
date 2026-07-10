import { useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  CheckCircle2,
  CircleHelp,
  ClipboardPaste,
  Copy,
  GraduationCap,
  Highlighter,
  MessageSquarePlus,
  MessageSquareText,
  MessageCircleQuestion,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Timer,
  Trash2,
  UserRound,
  X,
  FileOutput,
} from "lucide-react";
import type { DiscussionMessageInput } from "../../api/trackerApi";
import { AnnotationChapterGroups } from "../../components/annotations/AnnotationChapterGroups";
import {
  InlineCaptureEditor,
  type ResourceCaptureInput,
} from "../../components/annotations/InlineCaptureEditor";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { DiscussionMarkdownSurface } from "../../components/editor/DiscussionMarkdownSurface";
import type { DiscussionReviewItem } from "../../components/editor/DiscussionMarkdownSurface";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  Discussion,
  DiscussionMessage,
  DiscussionQuestionRelation,
  EntityNoteSaveInput,
  Resource,
} from "../../types/tracker";
import {
  discussionAnswerSections,
  discussionFollowups,
  matchAnswerSectionsToQuestions,
  normalizeDiscussionMarkdown,
} from "../../lib/discussionText";
import { importPastedMarkdown } from "../../lib/discussionImport";
import {
  discussionHighlights,
  discussionHeadingAt,
  type DiscussionHighlightExcerpt,
} from "../../lib/discussionHighlights";
import { discussionExportSegments } from "../../lib/discussionExports";

type DiscussionsViewProps = {
  course: Course;
  focusedResourceId: string;
  focusedTaskId: string;
  onAddMessage: (discussionId: string, input: DiscussionMessageInput) => void;
  onUpdateMessage: (
    message: DiscussionMessage,
    markdown: string,
    reviewItems?: DiscussionReviewItem[],
  ) => void;
  onAnnotationChange: (
    annotation: Annotation,
    changes: {
      kind?: AnnotationKind;
      status?: AnnotationStatus;
      priority?: Annotation["priority"];
      markdown?: string;
      plainText?: string;
      documentRevision?: number;
    },
  ) => void;
  onAskMessageQuestion: (
    discussionResourceId: string,
    messageId: string,
    messagePreview: string,
  ) => void;
  onCreateCapture: (resourceId: string, input: ResourceCaptureInput) => void;
  onCreateDiscussion: (resourceId: string) => void;
  onDeleteDiscussion: (discussion: Discussion) => void;
  onDiscussionStatusChange: (
    discussion: Discussion,
    status: Discussion["status"],
  ) => void;
  onDiscussionAttentionChange: (
    discussion: Discussion,
    attention: Discussion["attention"],
  ) => void;
  onFocusResource: (resourceId: string) => void;
  onExtractQuestions: (
    discussionResourceId: string,
    message: DiscussionMessage,
  ) => void;
  onImportClipboard: (resourceId: string) => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onCopy: (text: string, label: string) => void;
  onOpenResource: (resourceId: string) => void;
  onQuestionLink: (
    messageId: string,
    annotationId: string,
    relation: DiscussionQuestionRelation,
  ) => void;
};

function messageRoleLabel(role: Discussion["messages"][number]["role"]): string {
  if (role === "assistant") return "Tutor";
  if (role === "personal_note") return "Personal note";
  return role[0].toUpperCase() + role.slice(1);
}

function questionText(annotation: Annotation): string {
  return (
    annotation.body?.markdown ||
    annotation.body?.plainText ||
    annotation.anchor?.quote ||
    "Question without text"
  );
}

function compactResourceLabel(resource?: Resource): string {
  if (!resource) return "Source";
  if (resource.kind === "book") return "Book";
  if (resource.kind === "slides") {
    const lecture = resource.title.match(/(?:lecture|lc)\s*(\d+)/i)?.[1];
    return lecture ? `LC${lecture}` : "Slides";
  }
  if (resource.kind === "paper") return "Paper";
  return resource.kind.replaceAll("_", " ");
}

function contextSentence(value: unknown, edge: "first" | "last"): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const sentences = value
    .trim()
    .match(/\S(?:.*?)(?:[.!?]+(?=\s|$)|$)/g);
  if (!sentences?.length) return value.trim();
  return (edge === "first" ? sentences[0] : sentences.at(-1))?.trim() ?? "";
}

function reviewHighlightExcerpts(
  annotations: Annotation[],
  markdown: string,
): DiscussionHighlightExcerpt[] {
  const excerpts = annotations
    .filter(
      (annotation) =>
        annotation.kind === "highlight" &&
        annotation.origin === "discussion_review_highlight",
    )
    .map((annotation) => {
      const metadata = annotation.anchor?.metadata ?? {};
      const selectedMarkdown =
        annotation.body?.markdown ||
        annotation.anchor?.quote ||
        "Saved structured highlight";
      const position =
        typeof metadata.from_position === "number"
          ? metadata.from_position
          : 0;
      return {
        color:
          annotation.anchor?.color === "secondary"
            ? ("secondary" as const)
            : ("primary" as const),
        contextMarkdown: selectedMarkdown,
        heading: discussionHeadingAt(markdown, position),
        markdown: selectedMarkdown,
        nextMarkdown: contextSentence(metadata.context_after, "first"),
        previousMarkdown: contextSentence(metadata.context_before, "last"),
        position,
      };
    })
    .sort((left, right) => left.position - right.position);
  return excerpts.filter(
    (excerpt, index) =>
      !excerpts.slice(0, index).some(
        (candidate) =>
          candidate.markdown === excerpt.markdown &&
          Math.abs(candidate.position - excerpt.position) < 96,
      ),
  );
}

function HighlightOnlyExcerptList({
  excerpts,
}: {
  excerpts: DiscussionHighlightExcerpt[];
}) {
  if (!excerpts.length) return null;
  return (
    <div className="discussionHighlightExcerptList">
      {excerpts.map((excerpt, index) => (
        <section
          className={`discussionHighlightExcerpt color-${excerpt.color}`}
          key={`${excerpt.heading}-${excerpt.markdown}-${index}`}
        >
          <span className="discussionHighlightHeading">{excerpt.heading}</span>
          {excerpt.previousMarkdown ? (
            <div className="discussionHighlightContext">
              <MarkdownMath>{excerpt.previousMarkdown}</MarkdownMath>
            </div>
          ) : null}
          <div className="discussionHighlightSelection">
            <MarkdownMath>{excerpt.contextMarkdown}</MarkdownMath>
          </div>
          {excerpt.nextMarkdown ? (
            <div className="discussionHighlightContext">
              <MarkdownMath>{excerpt.nextMarkdown}</MarkdownMath>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function DiscussionMessageContent({
  annotationById,
  message,
  editing,
  highlightsOnly,
  onCancelEditing,
  onQuestionLink,
  onAnnotationChange,
  onNoteSave,
  questionLabelsAreOrdered,
  questionOrderIds,
  resourceById,
  reviewHighlights,
  onSaveEditing,
}: {
  annotationById: Map<string, Annotation>;
  message: DiscussionMessage;
  editing: boolean;
  highlightsOnly: boolean;
  onCancelEditing: () => void;
  onQuestionLink: DiscussionsViewProps["onQuestionLink"];
  onAnnotationChange: DiscussionsViewProps["onAnnotationChange"];
  onNoteSave: DiscussionsViewProps["onNoteSave"];
  questionLabelsAreOrdered: boolean;
  questionOrderIds: string[];
  resourceById: Map<string, Resource>;
  reviewHighlights: Annotation[];
  onSaveEditing: (
    markdown: string,
    reviewItems: DiscussionReviewItem[],
  ) => void;
}) {
  const [editingSectionKey, setEditingSectionKey] = useState("");
  const markdown = normalizeDiscussionMarkdown(
    message.body.markdown || message.body.plainText,
  );
  if (highlightsOnly && !editing) {
    return (
      <HighlightOnlyExcerptList
        excerpts={[
          ...discussionHighlights(markdown),
          ...reviewHighlightExcerpts(reviewHighlights, markdown),
        ]}
      />
    );
  }
  const linkedQuestionIds = new Set(
    message.annotationLinks.map((link) => link.annotationId),
  );
  const orderedQuestionIds = [
    ...questionOrderIds.filter((id) => linkedQuestionIds.has(id)),
    ...message.annotationLinks
      .map((link) => link.annotationId)
      .filter((id) => !questionOrderIds.includes(id)),
  ];
  const linkedQuestions = orderedQuestionIds
    .map((id) => annotationById.get(id))
    .filter((item): item is Annotation =>
      Boolean(item && ["question", "todo"].includes(item.kind)),
    );
  const questionCandidates = questionLabelsAreOrdered
    ? linkedQuestions
    : [...linkedQuestions].sort(
        (left, right) =>
          left.resourceId.localeCompare(right.resourceId) ||
          (left.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) -
            (right.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) ||
          (left.anchor?.rect?.[1] ?? Number.MAX_SAFE_INTEGER) -
            (right.anchor?.rect?.[1] ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAt.localeCompare(right.createdAt),
      );
  const parsed = discussionAnswerSections(markdown);
  if (message.role !== "assistant" || !parsed.sections.length) {
    if (editing) {
      return (
        <DiscussionMarkdownSurface
          className="discussionMessageEditor"
          editable
          markdown={markdown}
          onCancel={onCancelEditing}
          onSave={onSaveEditing}
          reviewMode
        />
      );
    }
    return <ExportAwareDiscussionMarkdown markdown={markdown} />;
  }
  const sectionMatches = new Map(
    matchAnswerSectionsToQuestions(
      parsed.sections,
      questionCandidates.map((question) => ({
        id: question.id,
        text: questionText(question),
      })),
      questionLabelsAreOrdered && parsed.sections.every(
        (section) => section.labels.length > 0,
      ),
    ).map((match) => [match.sectionLabel, match.questionIds]),
  );
  return (
    <div className={`discussionStructuredAnswer ${editing ? "isEditing" : ""}`}>
      {parsed.preamble ? (
        <details
          className="discussionAnswerSection discussionAnswerPreamble"
          open={editingSectionKey === "preamble" || undefined}
        >
          <summary>
            <strong>Introduction</strong>
            {editing ? (
              <button
                className="discussionSectionEdit"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setEditingSectionKey((current) =>
                    current === "preamble" ? "" : "preamble",
                  );
                }}
                type="button"
              >
                <Pencil size={10} />
                {editingSectionKey === "preamble" ? "Close editor" : "Edit"}
              </button>
            ) : (
              <span>context</span>
            )}
          </summary>
          {editing && editingSectionKey === "preamble" ? (
            <DiscussionMarkdownSurface
              className="discussionMessageEditor discussionSectionEditor"
              editable
              markdown={parsed.preamble}
              onCancel={() => setEditingSectionKey("")}
              onSave={(updatedMarkdown, reviewItems) => {
                onSaveEditing(
                  `${updatedMarkdown.trim()}\n\n${markdown.slice(parsed.preamble.length).trimStart()}`,
                  reviewItems,
                );
                setEditingSectionKey("");
              }}
              reviewMode
            />
          ) : (
            <ExportAwareDiscussionMarkdown markdown={parsed.preamble} />
          )}
        </details>
      ) : null}
      {parsed.sections.map((section) => {
        const questions = (sectionMatches.get(section.label) ?? [])
          .map((questionId) => annotationById.get(questionId))
          .filter((item): item is Annotation => Boolean(item));
        const headingLine = section.markdown.match(/^#{1,6}\s+.+$/m)?.[0] ?? "";
        const sectionBody = section.markdown.replace(/^#{1,6}\s+.+(?:\n+|$)/, "");
        const sectionKey = section.label;
        const sectionEditing = editing && editingSectionKey === sectionKey;
        const sectionEditor = sectionEditing ? (
          <DiscussionMarkdownSurface
            className="discussionMessageEditor discussionSectionEditor"
            editable
            markdown={sectionBody}
            onCancel={() => setEditingSectionKey("")}
            onSave={(updatedMarkdown, reviewItems) => {
              const sectionStart = markdown.indexOf(section.markdown);
              const reconstructed = [headingLine, updatedMarkdown.trim()]
                .filter(Boolean)
                .join("\n\n");
              const updatedDiscussion =
                sectionStart < 0
                  ? markdown
                  : `${markdown.slice(0, sectionStart)}${reconstructed}${markdown.slice(sectionStart + section.markdown.length)}`;
              const editorOffset = Math.max(
                0,
                sectionStart + headingLine.length + 2,
              );
              onSaveEditing(
                updatedDiscussion,
                reviewItems.map((item) => ({
                  ...item,
                  fromPosition:
                    item.fromPosition === undefined
                      ? undefined
                      : item.fromPosition + editorOffset,
                  toPosition:
                    item.toPosition === undefined
                      ? undefined
                      : item.toPosition + editorOffset,
                })),
              );
              setEditingSectionKey("");
            }}
            reviewMode
          />
        ) : null;
        return (
          <details
            className="discussionAnswerSection"
            key={section.label}
            open={
              sectionEditing ||
              questions.some((question) => question.status === "open") ||
              undefined
            }
          >
            <summary>
              <strong>
                {section.markdown.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? section.label}
              </strong>
              {editing ? (
                <button
                  className="discussionSectionEdit"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingSectionKey((current) =>
                      current === sectionKey ? "" : sectionKey,
                    );
                  }}
                  type="button"
                >
                  <Pencil size={10} />
                  {sectionEditing ? "Close editor" : "Edit"}
                </button>
              ) : (
                <span>
                  {questions.filter((question) => question.status === "open").length
                    ? `${questions.filter((question) => question.status === "open").length} open`
                    : questions.length
                      ? "answered"
                      : "section"}
                </span>
              )}
            </summary>
            {sectionEditor}
            {questions.map((question, questionIndex) => {
              const relation = message.annotationLinks.find(
                (link) => link.annotationId === question.id,
              )?.relation;
              const source = resourceById.get(question.resourceId);
              return (
                <aside
                  className={`inlineAnsweredQuestion status-${question.status}`}
                  id={`discussion-answer-${message.id}-${question.id}`}
                  key={question.id}
                >
                  <header>
                    <span>
                      {section.labels[questionIndex] ?? section.label} · linked
                      question
                    </span>
                    <strong>{relation ?? question.status}</strong>
                  </header>
                  <AnnotationChapterGroups
                    annotations={[question]}
                    flat
                    onAnnotationChange={onAnnotationChange}
                    onNoteSave={onNoteSave}
                  />
                  <footer>
                    <span>
                      {source?.title ?? "Source"}
                      {question.anchor?.pageNumber
                        ? ` · p. ${question.anchor.pageNumber}`
                        : ""}
                    </span>
                    <div>
                      <button
                        className={relation === "references" ? "active" : ""}
                        onClick={() =>
                          onQuestionLink(
                            message.id,
                            question.id,
                            "references",
                          )
                        }
                        type="button"
                      >
                        Referenced
                      </button>
                      <button
                        className={
                          relation === "partially_answers" ? "active" : ""
                        }
                        onClick={() =>
                          onQuestionLink(
                            message.id,
                            question.id,
                            "partially_answers",
                          )
                        }
                        type="button"
                      >
                        Partial
                      </button>
                      <button
                        className={relation === "answers" ? "active" : ""}
                        onClick={() =>
                          onQuestionLink(message.id, question.id, "answers")
                        }
                        type="button"
                      >
                        <CheckCircle2 size={12} />
                        Done
                      </button>
                    </div>
                  </footer>
                </aside>
              );
            })}
            {!sectionEditing ? (
              <ExportAwareDiscussionMarkdown markdown={sectionBody} />
            ) : null}
          </details>
        );
      })}
    </div>
  );
}

function ExportAwareDiscussionMarkdown({ markdown }: { markdown: string }) {
  return (
    <>
      {discussionExportSegments(markdown).map((segment, index) =>
        segment.kind === "markdown" ? (
          <DiscussionMarkdownSurface
            className="discussionMessageBody"
            key={`markdown-${index}`}
            markdown={segment.markdown}
          />
        ) : (
          <details className="discussionExportBlock" key={`${segment.tag}-${index}`}>
            <summary>
              <FileOutput size={13} />
              <strong>{segment.tag}.md</strong>
              <span>coding instructions · exported on save</span>
            </summary>
            <DiscussionMarkdownSurface
              className="discussionMessageBody"
              markdown={segment.markdown}
            />
          </details>
        ),
      )}
    </>
  );
}

type DiscussionWorkshopPanelProps = {
  activeCaptures: Annotation[];
  allCapturesCount: number;
  answeredCount: number;
  captureEditorOpen: boolean;
  coverageQuestions: Annotation[];
  discussion?: Discussion;
  latestAssistantMessage?: DiscussionMessage;
  onAnnotationChange: DiscussionsViewProps["onAnnotationChange"];
  onCaptureEditorOpenChange: (open: boolean) => void;
  onCreateCapture: DiscussionsViewProps["onCreateCapture"];
  onNoteSave: DiscussionsViewProps["onNoteSave"];
  onQuestionLink: DiscussionsViewProps["onQuestionLink"];
  resource: Resource;
  resourceById: Map<string, Resource>;
  showHighlights: boolean;
  studyCaptureCount: number;
  onShowHighlightsChange: (show: boolean) => void;
};

function DiscussionWorkshopPanel({
  activeCaptures,
  allCapturesCount,
  answeredCount,
  captureEditorOpen,
  coverageQuestions,
  discussion,
  latestAssistantMessage,
  onAnnotationChange,
  onCaptureEditorOpenChange,
  onCreateCapture,
  onNoteSave,
  onQuestionLink,
  resource,
  resourceById,
  showHighlights,
  studyCaptureCount,
  onShowHighlightsChange,
}: DiscussionWorkshopPanelProps) {
  const [openQuestionsOnly, setOpenQuestionsOnly] = useState(true);
  const visibleCoverageQuestions = openQuestionsOnly
    ? coverageQuestions.filter((question) => question.status === "open")
    : coverageQuestions;
  return (
    <aside className="discussionQuestionPanel discussionWorkshopPanel">
      <header>
        <div>
          <p className="eyebrow">Active notes & questions</p>
          <h3>
            {activeCaptures.length}
            {showHighlights && allCapturesCount !== activeCaptures.length
              ? `/${allCapturesCount}`
              : ""}{" "}
            capture{activeCaptures.length === 1 ? "" : "s"}
          </h3>
        </div>
        <button
          aria-label={captureEditorOpen ? "Close capture editor" : "Add resource capture"}
          className={captureEditorOpen ? "captureIconButton active" : "captureIconButton"}
          onClick={() => onCaptureEditorOpenChange(!captureEditorOpen)}
          title={captureEditorOpen ? "Close editor" : "Add note or question"}
          type="button"
        >
          {captureEditorOpen ? <X size={14} /> : <Plus size={14} />}
        </button>
      </header>
      {captureEditorOpen ? (
        <InlineCaptureEditor
          onCancel={() => onCaptureEditorOpenChange(false)}
          onSubmit={(input) => {
            onCreateCapture(resource.id, input);
            onCaptureEditorOpenChange(false);
          }}
          resourceTitle={resource.title}
        />
      ) : null}
      {allCapturesCount > studyCaptureCount ? (
        <div
          aria-label="Visible capture types"
          className="workshopCaptureFilter"
          role="group"
        >
          <button
            className={!showHighlights ? "active" : ""}
            onClick={() => onShowHighlightsChange(false)}
            type="button"
          >
            Notes & questions · {studyCaptureCount}
          </button>
          <button
            className={showHighlights ? "active" : ""}
            onClick={() => onShowHighlightsChange(true)}
            type="button"
          >
            All captures · {allCapturesCount}
          </button>
        </div>
      ) : null}
      {activeCaptures.length ? (
        <AnnotationChapterGroups
          annotations={activeCaptures}
          onAnnotationChange={onAnnotationChange}
          onNoteSave={onNoteSave}
        />
      ) : (
        <div className="emptyInline">
          No active notes or questions yet. Add one without leaving the workshop.
        </div>
      )}
      {discussion && coverageQuestions.length ? (
        <details className="discussionCoverage">
          <summary>
            <span>
              <CircleHelp size={13} />
              Answer coverage
            </span>
            <strong>
              {answeredCount}/{coverageQuestions.length}
            </strong>
          </summary>
          <div className="discussionCoverageList">
            <div className="discussionCoverageFilter">
              <button
                className={openQuestionsOnly ? "active" : ""}
                onClick={() => setOpenQuestionsOnly(!openQuestionsOnly)}
                type="button"
              >
                {openQuestionsOnly ? "Open only" : "All questions"}
              </button>
            </div>
            {visibleCoverageQuestions.map((question) => {
              const linkedMessage = [...discussion.messages]
                .reverse()
                .find((message) =>
                  message.annotationLinks.some(
                    (link) => link.annotationId === question.id,
                  ),
                );
              const linkedRelation = linkedMessage?.annotationLinks.find(
                (link) => link.annotationId === question.id,
              )?.relation;
              const source = resourceById.get(question.resourceId);
              return (
                <article
                  className={`discussionQuestion status-${question.status}`}
                  key={question.id}
                >
                  <header>
                    <strong>{compactResourceLabel(source)}</strong>
                    <span>{linkedRelation ?? question.status}</span>
                  </header>
                  <MarkdownMath>{questionText(question)}</MarkdownMath>
                  <div>
                    {linkedMessage ? (
                      <button
                        onClick={() =>
                          document
                            .getElementById(
                              `discussion-answer-${linkedMessage.id}-${question.id}`,
                            )
                            ?.scrollIntoView({ behavior: "smooth", block: "center" })
                        }
                        type="button"
                      >
                        Go to answer
                      </button>
                    ) : null}
                    <button
                      disabled={!latestAssistantMessage}
                      onClick={() =>
                        latestAssistantMessage &&
                        onQuestionLink(
                          latestAssistantMessage.id,
                          question.id,
                          "references",
                        )
                      }
                      type="button"
                    >
                      Referenced
                    </button>
                    <button
                      disabled={!latestAssistantMessage}
                      onClick={() =>
                        latestAssistantMessage &&
                        onQuestionLink(
                          latestAssistantMessage.id,
                          question.id,
                          "partially_answers",
                        )
                      }
                      type="button"
                    >
                      Partial
                    </button>
                    <button
                      disabled={!latestAssistantMessage}
                      onClick={() =>
                        latestAssistantMessage &&
                        onQuestionLink(
                          latestAssistantMessage.id,
                          question.id,
                          "answers",
                        )
                      }
                      type="button"
                    >
                      <CheckCircle2 size={12} /> Answered
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </details>
      ) : null}
    </aside>
  );
}

export function DiscussionsView({
  course,
  focusedResourceId,
  focusedTaskId,
  onAddMessage,
  onUpdateMessage,
  onAnnotationChange,
  onAskMessageQuestion,
  onCreateCapture,
  onCreateDiscussion,
  onDeleteDiscussion,
  onDiscussionStatusChange,
  onDiscussionAttentionChange,
  onExtractQuestions,
  onFocusResource,
  onImportClipboard,
  onNoteSave,
  onCopy,
  onOpenResource,
  onQuestionLink,
}: DiscussionsViewProps) {
  const [pendingDelete, setPendingDelete] = useState<Discussion | null>(null);
  const [captureEditorResourceId, setCaptureEditorResourceId] = useState("");
  const [allCaptureResourceId, setAllCaptureResourceId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [highlightOnlyDiscussionId, setHighlightOnlyDiscussionId] =
    useState("");
  const sourceResources = course.resources.filter(
    (resource) =>
      !["discussion", "exam_question"].includes(resource.kind),
  );
  const focusedDiscussion =
    course.discussions.find(
      (item) =>
        item.id === focusedResourceId ||
        item.resourceId === focusedResourceId,
    ) ??
    course.discussions.find((item) =>
      item.sourceResourceIds.includes(focusedResourceId),
    );
  const discussion =
    focusedDiscussion ??
    (focusedResourceId ? undefined : course.discussions[0]);
  const selectedSourceId =
    discussion
      ? discussion.sourceResourceIds.includes(focusedResourceId)
        ? focusedResourceId
        : discussion.sourceResourceIds[0] ?? ""
      : sourceResources.some((resource) => resource.id === focusedResourceId)
        ? focusedResourceId
        : sourceResources[0]?.id ?? "";
  const selectedSource = course.resources.find(
    (resource) => resource.id === selectedSourceId,
  );
  const captureEditorOpen = captureEditorResourceId === selectedSourceId;
  const followups = discussion
    ? discussionFollowups(discussion, course.annotations)
    : "";
  const annotationById = useMemo(
    () => new Map(course.annotations.map((annotation) => [annotation.id, annotation])),
    [course.annotations],
  );
  const resourceById = useMemo(
    () => new Map(course.resources.map((resource) => [resource.id, resource])),
    [course.resources],
  );
  const linkedQuestions = (discussion?.questionIds ?? [])
    .map((id) => annotationById.get(id))
    .filter((item): item is Annotation => Boolean(item));
  const allActiveCaptures = (selectedSource?.annotations ?? [])
    .filter((annotation) => annotation.status !== "archived")
    .sort((left, right) => {
      const leftOpenQuestion =
        ["question", "todo"].includes(left.kind) && left.status === "open";
      const rightOpenQuestion =
        ["question", "todo"].includes(right.kind) && right.status === "open";
      if (leftOpenQuestion !== rightOpenQuestion) {
        return leftOpenQuestion ? -1 : 1;
      }
      return left.createdAt.localeCompare(right.createdAt);
    });
  const studyCaptures = allActiveCaptures.filter((annotation) =>
    ["note", "question", "todo"].includes(annotation.kind),
  );
  const showHighlights = allCaptureResourceId === selectedSourceId;
  const activeCaptures = showHighlights ? allActiveCaptures : studyCaptures;
  const coverageQuestions = [
    ...new Map(
      [
        ...linkedQuestions,
        ...allActiveCaptures.filter((annotation) =>
          ["question", "todo"].includes(annotation.kind),
        ),
      ].map((annotation) => [annotation.id, annotation]),
    ).values(),
  ];
  const taskContext = (() => {
    if (!focusedTaskId || !selectedSourceId) return null;
    for (const day of course.days) {
      for (const section of day.sections) {
        const task = section.tasks.find((item) => item.id === focusedTaskId);
        if (!task) continue;
        const linkedResourceIds = new Set(task.resourceIds);
        if (
          !linkedResourceIds.has(selectedSourceId) &&
          !(
            selectedSource?.parentResourceId &&
            linkedResourceIds.has(selectedSource.parentResourceId)
          )
        ) {
          return null;
        }
        return { day, section, task };
      }
    }
    return null;
  })();
  const latestAssistantMessage = [...(discussion?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");
  const answeredCount = coverageQuestions.filter(
    (question) => question.status === "answered",
  ).length;
  const highlightsOnly = highlightOnlyDiscussionId === discussion?.id;
  const reviewAnnotationsByMessage = useMemo(
    () =>
      course.annotations.reduce((items, annotation) => {
        const messageId = annotation.anchor?.discussionMessageId;
        if (!messageId) return items;
        const current = items.get(messageId) ?? [];
        current.push(annotation);
        items.set(messageId, current);
        return items;
      }, new Map<string, Annotation[]>()),
    [course.annotations],
  );
  const visibleMessages = (discussion?.messages ?? []).filter(
    (message) =>
      !highlightsOnly ||
      discussionHighlights(
        message.body.markdown || message.body.plainText,
      ).length > 0 ||
      (reviewAnnotationsByMessage.get(message.id) ?? []).some(
        (annotation) =>
          annotation.kind === "highlight" &&
          annotation.origin === "discussion_review_highlight",
      ),
  );
  const highlightCount = (discussion?.messages ?? []).reduce(
    (count, message) =>
      count +
      discussionHighlights(
        message.body.markdown || message.body.plainText,
      ).length +
      (reviewAnnotationsByMessage.get(message.id) ?? []).filter(
        (annotation) =>
          annotation.kind === "highlight" &&
          annotation.origin === "discussion_review_highlight",
      ).length,
    0,
  );

  function handleCaptureEditorOpenChange(open: boolean) {
    setCaptureEditorResourceId(open ? selectedSourceId : "");
  }

  const workshop = selectedSource ? (
    <DiscussionWorkshopPanel
      activeCaptures={activeCaptures}
      allCapturesCount={allActiveCaptures.length}
      answeredCount={answeredCount}
      captureEditorOpen={captureEditorOpen}
      coverageQuestions={coverageQuestions}
      discussion={discussion}
      latestAssistantMessage={latestAssistantMessage}
      onAnnotationChange={onAnnotationChange}
      onCaptureEditorOpenChange={handleCaptureEditorOpenChange}
      onCreateCapture={onCreateCapture}
      onNoteSave={onNoteSave}
      onQuestionLink={onQuestionLink}
      resource={selectedSource}
      resourceById={resourceById}
      showHighlights={showHighlights}
      studyCaptureCount={studyCaptures.length}
      onShowHighlightsChange={(show) =>
        setAllCaptureResourceId(show ? selectedSourceId : "")
      }
    />
  ) : null;

  return (
    <div className="discussionLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Tutor conversations</p>
          <h2>
            {course.discussions.length} discussion
            {course.discussions.length === 1 ? "" : "s"} · {answeredCount}/
            {coverageQuestions.length} resource questions answered
          </h2>
        </div>
        <label className="discussionResourceSelect">
          <span>Source resource</span>
          <select
            onChange={(event) => onFocusResource(event.target.value)}
            value={selectedSourceId}
          >
            <option value="">Course-wide / prompt batch</option>
            {sourceResources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="discussionWorkspace">
        <aside className="discussionIndex">
          <header>
            <MessageSquareText size={16} />
            <strong>Conversations</strong>
          </header>
          {course.discussions.map((item) => (
            <button
              className={item.id === discussion?.id ? "active" : ""}
              key={item.id}
              onClick={() => onFocusResource(item.resourceId)}
              type="button"
            >
              <strong>{item.title}</strong>
              <span>
                {item.messages.length} messages · {item.questionIds.length} questions ·{" "}
                {item.status}
              </span>
            </button>
          ))}
          {!course.discussions.length ? <p>No discussions yet.</p> : null}
          {selectedSource ? (
            <button
              className="newDiscussionButton"
              onClick={() => onCreateDiscussion(selectedSource.id)}
              type="button"
            >
              <Plus size={14} /> New discussion
            </button>
          ) : null}
          {workshop}
        </aside>

        <section className="discussionMain">
          <header className="discussionHeader">
            <div>
              <p className="eyebrow">Linked source</p>
              <h2>{discussion?.title ?? selectedSource?.title ?? "Choose a resource"}</h2>
              {selectedSource ? <span>{selectedSource.title}</span> : null}
            </div>
            {discussion || selectedSource ? (
              <div className="discussionHeaderActions">
                {selectedSource ? (
                  <button
                    className="commandButton subtle"
                    onClick={() => onOpenResource(selectedSource.id)}
                    type="button"
                  >
                    <BookOpen size={15} />
                    <span>Open source</span>
                  </button>
                ) : null}
                {discussion && followups ? (
                  <button
                    className="commandButton subtle"
                    onClick={() =>
                      onCopy(followups, "Discussion follow-ups copied")
                    }
                    type="button"
                  >
                    <Copy size={14} />
                    <span>Copy follow-ups</span>
                  </button>
                ) : null}
                {discussion ? (
                  <button
                    className={
                      discussion.attention === "professor"
                        ? "commandButton professorAttention active"
                        : "commandButton professorAttention subtle"
                    }
                    onClick={() =>
                      onDiscussionAttentionChange(
                        discussion,
                        discussion.attention === "professor"
                          ? "none"
                          : "professor",
                      )
                    }
                    title="Keep this thread in the professor discussion queue"
                    type="button"
                  >
                    <GraduationCap size={14} />
                    <span>
                      {discussion.attention === "professor"
                        ? "Professor ✓"
                        : "Professor"}
                    </span>
                  </button>
                ) : null}
                {discussion ? (
                  <button
                    className="commandButton subtle"
                    onClick={() =>
                      onDiscussionStatusChange(
                        discussion,
                        discussion.status === "archived" ? "active" : "archived",
                      )
                    }
                    type="button"
                  >
                    {discussion.status === "archived" ? (
                      <RotateCcw size={14} />
                    ) : (
                      <Archive size={14} />
                    )}
                    <span>
                      {discussion.status === "archived" ? "Restore" : "Archive"}
                    </span>
                  </button>
                ) : null}
                {discussion ? (
                  <button
                    className={
                      highlightsOnly
                        ? "commandButton discussionHighlightMode active"
                        : "commandButton discussionHighlightMode subtle"
                    }
                    onClick={() =>
                      setHighlightOnlyDiscussionId(
                        highlightsOnly ? "" : discussion.id,
                      )
                    }
                    type="button"
                  >
                    <Highlighter size={14} />
                    <span>
                      {highlightsOnly
                        ? "Full dialogue"
                        : `Highlights${highlightCount ? ` · ${highlightCount}` : ""}`}
                    </span>
                  </button>
                ) : null}
                {discussion ? (
                  <button
                    className="commandButton dangerGhost"
                    onClick={() => setPendingDelete(discussion)}
                    type="button"
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </button>
                ) : null}
                <button
                  className="commandButton"
                  onClick={() =>
                    onImportClipboard(
                      discussion?.resourceId ?? selectedSource?.id ?? "",
                    )
                  }
                  type="button"
                >
                  <ClipboardPaste size={14} />
                  <span>Paste response</span>
                </button>
              </div>
            ) : null}
          </header>

          {taskContext ? (
            <section className="discussionTaskPin">
              <Pin aria-hidden="true" size={16} />
              <div className="discussionTaskPinBody">
                <p className="eyebrow">
                  Pinned task · Day {taskContext.day.number} ·{" "}
                  {taskContext.section.title}
                </p>
                <h3>{taskContext.task.title}</h3>
                <div className="discussionTaskMeta">
                  <span className={`status-${taskContext.task.status}`}>
                    {taskContext.task.status.replaceAll("_", " ")}
                  </span>
                  {taskContext.task.estimatedMinutes ? (
                    <span>
                      <Timer size={11} />
                      {taskContext.task.estimatedMinutes}m planned
                    </span>
                  ) : null}
                  {selectedSource ? <span>{selectedSource.title}</span> : null}
                </div>
                {taskContext.task.rationale?.plainText ? (
                  <details>
                    <summary>Why this task</summary>
                    <MarkdownMath>
                      {taskContext.task.rationale.markdown ??
                        taskContext.task.rationale.plainText}
                    </MarkdownMath>
                  </details>
                ) : null}
              </div>
            </section>
          ) : null}

          {discussion ? (
            <div className="discussionContentGrid">
              <div>
                <div className="messageStream">
                  {visibleMessages.map((message, messageIndex) => (
                    <details
                      className={`discussionMessage role-${message.role}`}
                      key={message.id}
                      open={
                        highlightsOnly ||
                        editingMessageId === message.id ||
                        messageIndex === visibleMessages.length - 1
                          ? true
                          : undefined
                      }
                    >
                      <summary>
                        {message.role === "assistant" ? (
                          <Bot size={15} />
                        ) : (
                          <UserRound size={15} />
                        )}
                        <strong>{messageRoleLabel(message.role)}</strong>
                        <span>
                          #{message.sequenceNumber}
                          {message.importedFromClipboard ? " · pasted" : ""}
                        </span>
                        <button
                          aria-label={
                            editingMessageId === message.id
                              ? "Cancel editing message"
                              : "Edit message"
                          }
                          className="messageEditButton"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (editingMessageId === message.id) {
                              setEditingMessageId("");
                              return;
                            }
                            setEditingMessageId(message.id);
                          }}
                          title={
                            editingMessageId === message.id
                              ? "Cancel editing"
                              : "Edit message"
                          }
                          type="button"
                        >
                          {editingMessageId === message.id ? (
                            <X size={12} />
                          ) : (
                            <Pencil size={12} />
                          )}
                          <span>
                            {editingMessageId === message.id ? "Cancel" : "Edit"}
                          </span>
                        </button>
                      </summary>
                      <DiscussionMessageContent
                          annotationById={annotationById}
                          editing={editingMessageId === message.id}
                          highlightsOnly={highlightsOnly}
                          message={message}
                          onCancelEditing={() => setEditingMessageId("")}
                          onAnnotationChange={onAnnotationChange}
                          onNoteSave={onNoteSave}
                          onQuestionLink={onQuestionLink}
                          questionLabelsAreOrdered={Boolean(
                            discussion.initialPromptBatchId,
                          )}
                          questionOrderIds={discussion.questionIds}
                          resourceById={resourceById}
                          reviewHighlights={
                            reviewAnnotationsByMessage.get(message.id) ?? []
                          }
                          onSaveEditing={(updatedMarkdown, reviewItems) => {
                            onUpdateMessage(message, updatedMarkdown, reviewItems);
                            setEditingMessageId("");
                          }}
                        />
                      {message.annotationLinks.length ||
                      message.role === "assistant" ? (
                        <footer>
                          {message.annotationLinks.length ? (
                            <span>
                              {message.annotationLinks.length} linked question
                              {message.annotationLinks.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {message.role === "assistant" ? (
                            <span className="messageQuestionActions">
                              <button
                                onClick={() =>
                                  onExtractQuestions(
                                    discussion.resourceId,
                                    message,
                                  )
                                }
                                type="button"
                              >
                                <Sparkles size={12} /> Extract questions
                              </button>
                              <button
                                onClick={() =>
                                  onAskMessageQuestion(
                                    discussion.resourceId,
                                    message.id,
                                    message.body.plainText,
                                  )
                                }
                                type="button"
                              >
                                <MessageCircleQuestion size={12} /> Ask follow-up
                              </button>
                            </span>
                          ) : null}
                        </footer>
                      ) : null}
                    </details>
                  ))}
                  {!discussion.messages.length ? (
                    <div className="emptyInline">
                      The thread is ready for its first message.
                    </div>
                  ) : null}
                  {highlightsOnly && !visibleMessages.length ? (
                    <div className="emptyInline discussionHighlightEmpty">
                      No highlights yet. Edit a message and use ⌘H or
                      ⌘⇧H on selected text.
                    </div>
                  ) : null}
                </div>
                <DiscussionComposer
                  onSubmit={(input) => onAddMessage(discussion.id, input)}
                />
              </div>
            </div>
          ) : selectedSource ? (
            <div className="discussionContentGrid">
              <div className="discussionEmpty">
                <MessageSquarePlus size={28} />
                <h3>No discussion for this resource yet</h3>
                <p>
                  Create a thread, or use “Discuss questions” in Notes to preserve a
                  complete prompt/question snapshot.
                </p>
                <button
                  className="commandButton"
                  onClick={() => onCreateDiscussion(selectedSource.id)}
                  type="button"
                >
                  <Plus size={15} />
                  <span>Create discussion</span>
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          confirmLabel="Delete discussion"
          description={`“${pendingDelete.title}” and its messages will disappear from the workspace. The database keeps soft-deleted rows for recovery and audit history.`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            onDeleteDiscussion(pendingDelete);
            setPendingDelete(null);
          }}
          title="Delete this discussion?"
        />
      ) : null}
    </div>
  );
}

function DiscussionComposer({
  onSubmit,
}: {
  onSubmit: (input: DiscussionMessageInput) => void;
}) {
  const [draft, setDraft] = useState("");
  const [importedFromClipboard, setImportedFromClipboard] = useState(false);
  const [role, setRole] = useState<DiscussionMessageInput["role"]>("assistant");

  function submit() {
    if (!draft.trim()) return;
    onSubmit({
      markdown: draft,
      plainText: draft,
      role,
      importedFromClipboard,
    });
    setDraft("");
    setImportedFromClipboard(false);
  }

  return (
    <section className="discussionComposer">
      <header>
        <label>
          <span>Message type</span>
          <select
            onChange={(event) =>
              setRole(event.target.value as DiscussionMessageInput["role"])
            }
            value={role}
          >
            <option value="assistant">Tutor response</option>
            <option value="user">My prompt</option>
            <option value="personal_note">Personal note</option>
          </select>
        </label>
      </header>
      <textarea
        aria-label="Discussion message in Markdown"
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text/plain");
          if (!pasted) return;
          event.preventDefault();
          const start = event.currentTarget.selectionStart;
          const end = event.currentTarget.selectionEnd;
          const imported = importPastedMarkdown(pasted);
          setDraft(
            `${draft.slice(0, start)}${imported}${draft.slice(end)}`,
          );
          setImportedFromClipboard(true);
        }}
        placeholder="Paste or write Markdown. Use $...$ or $$...$$ for formulas."
        rows={8}
        value={draft}
      />
      {draft.trim() ? (
        <MarkdownMath className="discussionComposerPreview">
          {draft}
        </MarkdownMath>
      ) : null}
      <div className="noteActions">
        <button
          className="commandButton"
          disabled={!draft.trim()}
          onClick={submit}
          type="button"
        >
          <Send size={14} />
          <span>Add message</span>
        </button>
      </div>
    </section>
  );
}
