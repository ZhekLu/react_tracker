import { QuestionFinder } from "./QuestionFinder";
import { DiscussionStudyOverview } from "./DiscussionStudyOverview";
import type { FinderEntry } from "./questionSearchModel";
import { useMemo, useState, type CSSProperties } from "react";
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
import {
  annotationChapter,
  annotationChapterNumber,
} from "../../components/annotations/annotationDisplay";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  Discussion,
  DiscussionMessage,
  DiscussionQaViewInput,
  DiscussionQuestionRelation,
  EntityNoteSaveInput,
  ExerciseSolutionMappingInput,
  ImportantAnswerInput,
  Resource,
} from "../../types/tracker";
import {
  discussionAnswerSections,
  discussionFollowups,
  normalizeDiscussionMarkdown,
} from "../../lib/discussionText";
import { importWithDebug } from "../../lib/insertDebug";
import {
  discussionQaSections,
  discussionQuestionIdsByLabel,
  responseQuestionIds,
} from "../../lib/discussionQa";
import {
  discussionPriority,
  discussionPriorityLabel,
  discussionPriorityRank,
} from "../../lib/discussionPriority";
import {
  discussionHighlights,
  discussionHeadingAt,
  type DiscussionHighlightExcerpt,
} from "../../lib/discussionHighlights";
import { discussionExportSegments } from "../../lib/discussionExports";
import { DiscussionQaReview } from "./DiscussionQaReview";
import { discussionReviewPrompt } from "./discussionReviewExport";
import { resourceScopedAnnotations } from "../../lib/prompts";
import {
  isTrackedQuestion,
  queuedTrackedQuestionGroups,
  trackedQuestionGroups,
} from "../../lib/questionIdentity";

function useMappedQuestionCounts(course: Course, discussionId?: string) {
  return useMemo(() => {
    const selected = course.discussions.find(item => item.id === discussionId);
    return new Map((selected?.messages ?? []).map(message => [message.id, selected
      ? responseQuestionIds(selected, message.body.markdown || message.body.plainText, course.annotations, course.discussions).length : 0]));
  }, [course.annotations, course.discussions, discussionId]);
}

type DiscussionsViewProps = {
  course: Course;
  focusedResourceId: string;
  focusedTaskId: string;
  taskQaLaunch?: {
    discussionId: string;
    label: string;
    questionIds: string[];
    scopeKind?: "task" | "resource";
    initialFilter?: "all" | "open" | "new";
    token: number;
  } | null;
  onTaskQaClose?: () => void;
  onAddMessage: (discussionId: string, input: DiscussionMessageInput) => void | boolean | Promise<void | boolean>;
  onReviewSource: (message: DiscussionMessage) => Promise<string | null>;
  onUpdateMessage: (
    message: DiscussionMessage,
    markdown: string,
    reviewItems?: DiscussionReviewItem[],
  ) => void | boolean | Promise<void | boolean>;
  onAnnotationChange: (
    annotation: Annotation,
    changes: {
      kind?: AnnotationKind;
      status?: AnnotationStatus;
      postponed?: boolean;
      skipped?: boolean;
      priority?: Annotation["priority"];
      discussionPriority?: Annotation["discussionPriority"];
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
  onDeleteAnswer: (
    message: DiscussionMessage,
    markdown: string,
    questionIds: string[],
    archiveQuestions?: boolean,
  ) => void;
  onDeleteMessage: (message: DiscussionMessage) => void;
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
  onCopyResourceQuestions: (resource: Resource) => void;
  onOpenResource: (resourceId: string) => void;
  onQuestionLink: (
    messageId: string,
    annotationId: string,
    relation: DiscussionQuestionRelation,
  ) => void;
  onQaViewed: (views: DiscussionQaViewInput[]) => void;
  onMapExerciseSolution: (input: ExerciseSolutionMappingInput) => void;
  onToggleImportantAnswer: (input: ImportantAnswerInput) => void;
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
  annotationById, message, editing, visible, highlightsOnly, onCancelEditing,
  questionIdsByLabel, reviewHighlights, onSaveEditing, onDeleteSection,
  compactByResource, importantQuestionIds, resourceById,
}: {
  annotationById: Map<string, Annotation>;
  compactByResource: boolean;
  importantQuestionIds: ReadonlySet<string>;
  message: DiscussionMessage;
  editing: boolean;
  visible: boolean;
  highlightsOnly: boolean;
  onCancelEditing: () => void;
  questionIdsByLabel: Map<string, string[]>;
  reviewHighlights: Annotation[];
  resourceById: Map<string, Resource>;
  onSaveEditing: (markdown: string, reviewItems: DiscussionReviewItem[]) => void | boolean | Promise<void | boolean>;
  onDeleteSection: (markdown: string, questionIds: string[]) => void;
}) {
  const [editingSectionKey, setEditingSectionKey] = useState("");
  const [sectionDrafts, setSectionDrafts] = useState(new Map<string, string>());
  const [sectionItems, setSectionItems] = useState(new Map<string, DiscussionReviewItem[]>());
  const [pendingDelete, setPendingDelete] = useState<{index: number; label: string} | null>(null);
  if (!visible) return null;
  const markdown = normalizeDiscussionMarkdown(message.body.markdown || message.body.plainText);
  const parsed = discussionAnswerSections(markdown);
  const occurrences = new Map<string, number>();
  const sections = [
    ...(parsed.preamble ? [{label: "Introduction", labels: [] as string[], markdown: parsed.preamble}] : []),
    ...parsed.sections,
  ].map(section => {
    const occurrence = occurrences.get(section.label) ?? 0;
    occurrences.set(section.label, occurrence + 1);
    return {...section, key: `${section.label}:${occurrence}`};
  });
  function clearDraft(key: string) {
    setSectionDrafts(current => { const next = new Map(current); next.delete(key); return next; });
    setSectionItems(current => { const next = new Map(current); next.delete(key); return next; });
    setEditingSectionKey("");
  }
  if (highlightsOnly && !editing) return <HighlightOnlyExcerptList excerpts={[
    ...discussionHighlights(markdown), ...reviewHighlightExcerpts(reviewHighlights, markdown),
  ]} />;
  // Edit means edit immediately, including headings and the full document.
  if (editing) return <DiscussionMarkdownSurface className="discussionMessageEditor" editable
    markdown={sections.map(section => sectionDrafts.get(section.key) ?? section.markdown).join("\n\n")}
    initialReviewItems={[...sectionItems.values()].flat()}
    onCancel={() => { setSectionDrafts(new Map()); setSectionItems(new Map()); onCancelEditing(); }} reviewMode
    onSave={async (value, items) => {
      const result = await onSaveEditing(value, items);
      if (result !== false) { setSectionDrafts(new Map()); setSectionItems(new Map()); setEditingSectionKey(""); onCancelEditing(); }
      return result;
    }} />;
  if (message.role !== "assistant" || !parsed.sections.length) return <ExportAwareDiscussionMarkdown markdown={markdown} />;
  function replaceSection(index: number, value: string) {
    return sections.map((section, position) => position === index ? value.trim() : section.markdown).filter(Boolean).join("\n\n");
  }
  function sectionQuestionIds(index: number) {
    return sections[index].labels.flatMap(label => questionIdsByLabel.get(label) ?? []);
  }
  const sectionModels = sections.map((section, index) => {
    const questionIds = sectionQuestionIds(index);
    const questions = questionIds
      .map((id) => annotationById.get(id))
      .filter((item): item is Annotation => Boolean(item));
    const title = (section.markdown.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? section.label)
      .replace(/(?:\*\*|__|==|\^\^|!!|%%|`)/g, "");
    return {
      important: questionIds.some((id) => importantQuestionIds.has(id)),
      index,
      priority: discussionPriority(section.markdown, questions),
      questions,
      resourceId: questions[0]?.resourceId ?? "",
      section,
      title,
    };
  });
  const sortedSectionModels = [...sectionModels].sort(
    (left, right) =>
      Number(right.important) - Number(left.important) ||
      discussionPriorityRank(right.priority) - discussionPriorityRank(left.priority) ||
      left.index - right.index,
  );
  function renderSection(model: (typeof sectionModels)[number], compact: boolean) {
      const { index, important, priority, questions, section, title } = model;
      const key = section.key;
      const isEditing = editingSectionKey === key;
      const resourceTitle = resourceById.get(model.resourceId)?.title ?? "";
      const displayTitle = compact && resourceTitle
        ? title
            .replace(`${resourceTitle} · `, "")
            .replace(` · ${resourceTitle}`, "")
        : title;
      return <section className={`discussionDocumentSection priority-${priority}${important ? " important" : ""}${compact ? " compact" : ""}`} key={key}>
        <header className="discussionDocumentSectionHeader">
          <strong>{displayTitle}</strong>
          <span className={`discussionPriorityTag priority-${priority}`}>
            {discussionPriorityLabel(priority)}
          </span>
          {important ? <span className="discussionPinnedTag"><Pin size={11} /> Pinned</span> : null}
          {sectionDrafts.has(key) && sectionDrafts.get(key) !== section.markdown ? <span>Unsaved draft</span> : null}
          {questions.length ? <span>{questions.length} linked</span> : null}
          <div>
            <button type="button" onClick={() => isEditing ? clearDraft(key) : setEditingSectionKey(key)}>
              <Pencil size={12} /> {isEditing ? "Cancel" : "Edit section"}
            </button>
            <button type="button" className="danger" disabled={Boolean(editingSectionKey) || sectionDrafts.size > 0}
              title={editingSectionKey || sectionDrafts.size ? "Save or cancel section drafts before deleting" : undefined}
              onClick={() => setPendingDelete({index, label: title})}>
              <Trash2 size={12} /> Delete section
            </button>
          </div>
        </header>
        {isEditing ? <DiscussionMarkdownSurface editable reviewMode markdown={sectionDrafts.get(key) ?? section.markdown}
          initialReviewItems={sectionItems.get(key) ?? []}
          onChange={value => setSectionDrafts(current => new Map(current).set(key, value))}
          onReviewItemsChange={items => setSectionItems(current => new Map(current).set(key, items.map(item => ({
            ...item, sectionLabel: section.label, questionIds: sectionQuestionIds(index),
            fromPosition: undefined, toPosition: undefined,
          }))))}
          onCancel={() => clearDraft(key)}
          onSave={async (value, items) => {
            const result = await onSaveEditing(replaceSection(index, value), items.map(item => ({
              ...item, sectionLabel: section.label, questionIds: sectionQuestionIds(index),
              // ProseMirror positions belong to this editor, not Markdown offsets.
              fromPosition: undefined, toPosition: undefined,
            })));
            if (result !== false) clearDraft(key);
            return result;
          }} /> : <ExportAwareDiscussionMarkdown markdown={
            section.markdown.replace(/^#{1,6}\s+.+(?:\n+|$)/, "")
          } />}
      </section>;
  }
  const groupedSections = compactByResource
    ? [...sectionModels.reduce((groups, model) => {
        const key = model.resourceId || "other";
        const group = groups.get(key) ?? { id: key, items: [] as typeof sectionModels };
        group.items.push(model);
        groups.set(key, group);
        return groups;
      }, new Map<string, { id: string; items: typeof sectionModels }>()).values()]
        .map((group) => ({
          ...group,
          important: group.items.some((item) => item.important),
          priorityRank: Math.max(
            ...group.items.map((item) => discussionPriorityRank(item.priority)),
          ),
          items: [...group.items].sort(
            (left, right) =>
              Number(right.important) - Number(left.important) ||
              discussionPriorityRank(right.priority) - discussionPriorityRank(left.priority) ||
              left.index - right.index,
          ),
        }))
        .sort(
          (left, right) =>
            Number(right.important) - Number(left.important) ||
            right.priorityRank - left.priorityRank ||
            Math.min(...left.items.map((item) => item.index)) -
              Math.min(...right.items.map((item) => item.index)),
        )
    : [];
  return <div className={`discussionStructuredAnswer discussionReadableSections${compactByResource ? " dayResourceAnswers" : ""}`}>
    {compactByResource
      ? groupedSections.map((group) => {
          const resource = resourceById.get(group.id);
          return <section className={`discussionResourceAnswerGroup${group.important ? " important" : ""}`} key={group.id}>
            <header className="discussionResourceAnswerHeader">
              <BookOpen size={14} />
              <strong>{resource?.title ?? "General discussion"}</strong>
              <span>{group.items.length} answer{group.items.length === 1 ? "" : "s"}</span>
            </header>
            <div>{group.items.map((model) => renderSection(model, true))}</div>
          </section>;
        })
      : sortedSectionModels.map((model) => renderSection(model, false))}
    {pendingDelete ? <ConfirmDialog title="Delete this section?" confirmLabel="Delete section"
      description={`Remove “${pendingDelete.label}” and reopen questions linked only to this section. Other sections stay in the discussion.`}
      onCancel={() => setPendingDelete(null)} onConfirm={() => {
        const remainingIds = new Set(sections.flatMap((_section, index) => index === pendingDelete.index ? [] : sectionQuestionIds(index)));
        onDeleteSection(replaceSection(pendingDelete.index, ""), sectionQuestionIds(pendingDelete.index).filter(id => !remainingIds.has(id)));
        setEditingSectionKey(""); setPendingDelete(null);
      }} /> : null}
  </div>;
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
  onOpenQuestion: (questionId: string) => void;
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
  onOpenQuestion,
}: DiscussionWorkshopPanelProps) {
  const [openQuestionsOnly, setOpenQuestionsOnly] = useState(true);
  const visibleCoverageQuestions = openQuestionsOnly
    ? coverageQuestions.filter(
        (question) =>
          question.status === "open" &&
          !question.postponed &&
          !question.skipped,
      )
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
              Questions understood
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
                        onClick={() => onOpenQuestion(question.id)}
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
                      Link to latest response
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
                      Latest response: partial
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
  taskQaLaunch,
  onTaskQaClose,
  onAddMessage,
  onUpdateMessage,
  onReviewSource,
  onAnnotationChange,
  onAskMessageQuestion,
  onCreateCapture,
  onCreateDiscussion,
  onDeleteAnswer,
  onDeleteMessage,
  onDeleteDiscussion,
  onDiscussionStatusChange,
  onDiscussionAttentionChange,
  onExtractQuestions,
  onFocusResource,
  onImportClipboard,
  onMapExerciseSolution,
  onToggleImportantAnswer,
  onNoteSave,
  onCopy,
  onCopyResourceQuestions,
  onOpenResource,
  onQuestionLink,
  onQaViewed,
}: DiscussionsViewProps) {
  const [mode, setMode] = useState<"questions" | "conversations">("conversations");
  const [contentMode, setContentMode] = useState<"study" | "history">("study");
  const [conversationQuery, setConversationQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Discussion | null>(null);
  const [pendingMessageDelete, setPendingMessageDelete] =
    useState<DiscussionMessage | null>(null);
  const [captureEditorResourceId, setCaptureEditorResourceId] = useState("");
  const [allCaptureResourceId, setAllCaptureResourceId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [messageExpansion, setMessageExpansion] = useState(new Map<string, boolean>());
  const [qaReviewScope, setQaReviewScope] = useState<{
    discussionId: string;
    label?: string;
    questionIds?: string[];
    initialFilter?: "all" | "open" | "new";
    scopeKind?: "task" | "resource";
  } | null>(null);
  const [highlightOnlyDiscussionId, setHighlightOnlyDiscussionId] =
    useState("");
  const activeQaReviewDiscussionId =
    taskQaLaunch?.discussionId ?? qaReviewScope?.discussionId ?? "";
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
    course.discussions.find(
      (item) =>
        item.status !== "archived" && item.scopeType === "resource" &&
        item.sourceResourceIds.includes(focusedResourceId),
    ) ??
    course.discussions.find((item) =>
      item.status !== "archived" && item.sourceResourceIds.includes(focusedResourceId),
    );
  const discussion =
    focusedDiscussion ??
    (focusedResourceId ? undefined : course.discussions.find(item => item.status !== "archived"));
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
  const mappedAnswerIds = useMemo(
    () =>
      new Set(
        course.discussions.flatMap((item) =>
          discussionQaSections(item, course.annotations).flatMap(
            (section) => section.questionIds,
          ),
        ),
      ),
    [course.annotations, course.discussions],
  );
  const followups = discussion
    ? discussionFollowups(discussion, course.annotations, mappedAnswerIds)
    : "";
  const annotationById = useMemo(
    () => new Map(course.annotations.map((annotation) => [annotation.id, annotation])),
    [course.annotations],
  );
  const resourceById = useMemo(
    () => new Map(course.resources.map((resource) => [resource.id, resource])),
    [course.resources],
  );
  const importantQuestionIds = useMemo(
    () =>
      new Set(
        course.notes
          .filter((note) => note.kind === "important_answer")
          .flatMap((note) =>
            note.links
              .filter((link) => link.entityType === "annotation")
              .map((link) => link.entityId),
          ),
      ),
    [course.notes],
  );
  const linkedQuestions = (discussion?.questionIds ?? [])
    .map((id) => annotationById.get(id))
    .filter((item): item is Annotation => Boolean(item));
  const allActiveCaptures = (selectedSource
    ? resourceScopedAnnotations(course, selectedSource)
    : [])
    .filter((annotation) => annotation.status !== "archived")
    .sort((left, right) => {
      const leftOpenQuestion =
        isTrackedQuestion(left) &&
        left.status === "open" &&
        !left.postponed &&
        !left.skipped;
      const rightOpenQuestion =
        isTrackedQuestion(right) &&
        right.status === "open" &&
        !right.postponed &&
        !right.skipped;
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
          isTrackedQuestion(annotation),
        ),
      ].map((annotation) => [annotation.id, annotation]),
    ).values(),
  ].sort(
    (left, right) =>
      (annotationChapterNumber(left) ?? Number.MAX_SAFE_INTEGER) -
        (annotationChapterNumber(right) ?? Number.MAX_SAFE_INTEGER) ||
      (left.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const resourceChapterGroups = discussion?.scopeType === "resource"
    ? [
        ...coverageQuestions
          .filter(isTrackedQuestion)
          .reduce((groups, annotation) => {
            const chapterNumber = annotationChapterNumber(annotation);
            const key = chapterNumber === null ? "other" : String(chapterNumber);
            const current = groups.get(key) ?? {
              chapterNumber,
              label: annotationChapter(annotation),
              questions: [] as Annotation[],
            };
            current.questions.push(annotation);
            groups.set(key, current);
            return groups;
          }, new Map<string, { chapterNumber: number | null; label: string; questions: Annotation[] }>())
          .values(),
      ].sort(
        (left, right) =>
          (left.chapterNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.chapterNumber ?? Number.MAX_SAFE_INTEGER),
      )
    : [];
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
  const queuedResourceQuestionCount =
    discussion?.scopeType === "resource"
      ? queuedTrackedQuestionGroups(coverageQuestions).length
      : 0;
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
      Boolean((message.body.markdown || message.body.plainText).trim()) && (!highlightsOnly ||
      discussionHighlights(
        message.body.markdown || message.body.plainText,
      ).length > 0 ||
      (reviewAnnotationsByMessage.get(message.id) ?? []).some(
        (annotation) =>
          annotation.kind === "highlight" &&
          annotation.origin === "discussion_review_highlight",
      )),
  );
  const mappedQuestionCountByMessage = useMappedQuestionCounts(course, discussion?.id);
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

  function openQuestion(questionId: string) {
    if (!discussion) return;
    onTaskQaClose?.();
    onFocusResource(discussion.id);
    setQaReviewScope({discussionId: discussion.id, questionIds: [questionId], initialFilter: "all", label: "Question and all its answers"});
  }
  function openSearchResult(entry: FinderEntry) {
    const answer = entry.answers.at(-1);
    if (!answer) return;
    onTaskQaClose?.();
    onFocusResource(answer.discussion.id);
    if (entry.questions.length) {
      setQaReviewScope({discussionId: answer.discussion.id, questionIds: entry.questions.map(q => q.id), initialFilter: "all", label: entry.label});
    } else {
      setQaReviewScope(null);
      setMode("conversations");
      setContentMode("history");
      setMessageExpansion(previous => new Map(previous).set(answer.section.messageId, true));
      window.setTimeout(() => document.getElementById(`discussion-message-${answer.section.messageId}`)?.scrollIntoView({block: "center", behavior: "smooth"}), 100);
    }
  }
  const conversations = course.discussions.filter(item => (includeArchived || item.status !== "archived") &&
    [item.title, ...item.messages.map(m => m.body.markdown || m.body.plainText)].join(" ").toLowerCase().includes(conversationQuery.toLowerCase()))
    .sort((a,b) => (b.messages.at(-1)?.createdAt ?? "").localeCompare(a.messages.at(-1)?.createdAt ?? ""));

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
      onOpenQuestion={openQuestion}
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
      <nav className="discussionViewModes" aria-label="Discussion views">
        <button className="commandButton subtle" data-track="discussion.conversations" aria-pressed={mode === "conversations"} onClick={() => setMode("conversations")}>Study discussions</button>
        <button className="commandButton subtle" data-track="discussion.finder" aria-pressed={mode === "questions"} onClick={() => setMode("questions")}>Find questions & answers</button>
      </nav>
      <div hidden={mode !== "questions"}><QuestionFinder course={course} onOpen={openSearchResult} onOpenSource={id => {
        const target = course.discussions.find(d => d.resourceId === id);
        if (target) {onTaskQaClose?.(); setQaReviewScope(null); onFocusResource(target.id); setMode("conversations");}
        else onOpenResource(id);
      }} onPrepare={id => {
        const resource = course.resources.find(r => r.id === id);
        if (resource) { setMode("conversations"); onCopyResourceQuestions(resource); }
      }}/></div>
      <div hidden={mode !== "conversations"}>
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Tutor conversations</p>
          <h2>
            {course.discussions.length} discussion
            {course.discussions.length === 1 ? "" : "s"} in this course
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
          <div className="discussionIndexFilters">
            <input type="search" aria-label="Search conversations" placeholder="Search conversations…" value={conversationQuery} onChange={e => setConversationQuery(e.target.value)}/>
            <label><input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)}/> Include archived</label>
          </div>
          {conversations.map((item) => (
            <button
              className={item.id === discussion?.id ? "active" : ""}
              key={item.id}
              data-track="discussion.open" onClick={() => {onTaskQaClose?.(); setQaReviewScope(null); setContentMode("study"); onFocusResource(item.id);}}
              type="button"
            >
              <strong>{item.title}</strong>
              <span>
                {item.messages.filter(m => (m.body.markdown || m.body.plainText).trim()).length} messages · {item.scopeType} ·{" "}
                {item.status}
              </span>
            </button>
          ))}
          {!conversations.length ? <p>No conversations match this view.</p> : null}
          {selectedSource ? (
            <button
              className="newDiscussionButton"
              data-track="discussion.create" onClick={() => onCreateDiscussion(selectedSource.id)}
              type="button"
            >
              <Plus size={14} /> New discussion
            </button>
          ) : null}
          <details className="discussionCaptureTools"><summary>Questions & captures</summary>{workshop}</details>
        </aside>

        <section className="discussionMain">
          <header className="discussionHeader">
            <div>
              <p className="eyebrow">{discussion?.scopeType === "day" ? "Your daily study space" : "Your study collection"}</p>
              <h2>{discussion?.title ?? selectedSource?.title ?? "Choose a resource"}</h2>
              {discussion?.status === "archived" ? <span>Archived discussion</span> : null}
            </div>
            {discussion || selectedSource ? (
              <div className="discussionHeaderActions">
                {discussion ? (
                  <button
                    className="commandButton qaReviewLaunch"
                    onClick={() => {
                      onTaskQaClose?.();
                      const resourceQuestionIds =
                        discussion.scopeType === "resource"
                          ? coverageQuestions
                              .filter(
                                (annotation) =>
                                  isTrackedQuestion(annotation) &&
                                  annotation.status !== "archived",
                              )
                              .map((annotation) => annotation.id)
                          : undefined;
                      setQaReviewScope({
                        discussionId: discussion.id,
                        initialFilter:
                          discussion.scopeType === "resource" ? "new" : undefined,
                        label:
                          discussion.scopeType === "resource" && selectedSource
                            ? `${selectedSource.title} · all chapters`
                            : undefined,
                        questionIds: resourceQuestionIds,
                        scopeKind:
                          discussion.scopeType === "resource" ? "resource" : undefined,
                      });
                    }}
                    title="Review answers and open questions in a focused workspace"
                    type="button"
                  >
                    <Sparkles size={14} />
                    <span>Review in Q&A</span>
                  </button>
                ) : null}
                <button
                  className="commandButton"
                  data-track="discussion.import" onClick={() =>
                    onImportClipboard(
                      discussion?.id ?? selectedSource?.id ?? "",
                    )
                  }
                  type="button"
                >
                  <ClipboardPaste size={14} />
                  <span>Paste response</span>
                </button>
                <details className="discussionMoreActions"><summary>More ···</summary><div>
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
                {discussion?.scopeType === "resource" && selectedSource ? (
                  <button
                    className="commandButton subtle resourceCopyNextButton"
                    disabled={!queuedResourceQuestionCount}
                    onClick={() => onCopyResourceQuestions(selectedSource)}
                    title={
                      queuedResourceQuestionCount
                        ? "Copy the next unanswered questions from this resource in source order"
                        : "Every active resource question already has a mapped tutor response"
                    }
                    type="button"
                  >
                    <Copy size={14} />
                    <span>
                      {queuedResourceQuestionCount
                        ? `Copy next · ${queuedResourceQuestionCount}`
                        : "Queue clear"}
                    </span>
                  </button>
                ) : null}
                {discussion ? (
                  <button
                    className="commandButton subtle"
                    onClick={() =>
                      onCopy(
                        discussionReviewPrompt(course, discussion),
                        "Structured discussion review copied",
                      )
                    }
                    title="Copy question threads, tutor answers, notes, and follow-ups for an AI review"
                    type="button"
                  >
                    <FileOutput size={14} />
                    <span>Copy review</span>
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
                    onClick={() => {
                      setContentMode("history");
                      setHighlightOnlyDiscussionId(
                        highlightsOnly ? "" : discussion.id,
                      );
                    }}
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
                    data-track="discussion.delete" onClick={() => setPendingDelete(discussion)}
                    type="button"
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </button>
                ) : null}
                </div></details>
              </div>
            ) : null}
          </header>

          {discussion ? <nav className="discussionContentModes" aria-label="Discussion content">
            <button type="button" aria-pressed={contentMode === "study"} onClick={() => setContentMode("study")}><BookOpen size={15}/> Study overview</button>
            <button type="button" aria-pressed={contentMode === "history"} onClick={() => setContentMode("history")}><MessageSquareText size={15}/> Response history <span>{discussion.messages.length}</span></button>
          </nav> : null}

          {contentMode === "study" && discussion?.scopeType === "resource" && resourceChapterGroups.length ? (
            <section className="resourceDiscussionMap">
              <header>
                <div>
                  <p className="eyebrow">Pick a chapter</p>
                  <h3>One focused review at a time</h3>
                </div>
                <span>Open a tile to enter chapter Q&A</span>
              </header>
              <div className="resourceDiscussionChapterGrid">
                {resourceChapterGroups.map((group, index) => {
                  const logicalQuestions = trackedQuestionGroups(group.questions);
                  const reviewQuestionIds = logicalQuestions.flatMap((question) =>
                    question.annotations
                      .filter((annotation) => annotation.status !== "archived")
                      .map((annotation) => annotation.id),
                  );
                  const answeredCount = logicalQuestions.filter((question) =>
                    question.annotations.some(
                      (annotation) =>
                        annotation.status !== "archived" &&
                        (annotation.discussionResponseCount ?? 0) > 0,
                    ),
                  ).length;
                  const openCount = logicalQuestions.filter((question) =>
                    question.annotations.every(
                      (annotation) =>
                        annotation.status === "open" &&
                        !annotation.postponed &&
                        !annotation.skipped,
                    ),
                  ).length;
                  return (
                    <button
                      className="resourceDiscussionChapter"
                      disabled={!reviewQuestionIds.length}
                      key={`${group.chapterNumber ?? "other"}:${group.label}`}
                      onClick={() => {
                        onTaskQaClose?.();
                        setQaReviewScope({
                          discussionId: discussion.id,
                          initialFilter: "new",
                          label:
                            group.chapterNumber === null
                              ? `${selectedSource?.title ?? discussion.title} · other locations`
                              : `${selectedSource?.title ?? discussion.title} · Chapter ${group.chapterNumber}`,
                          questionIds: reviewQuestionIds,
                          scopeKind: "resource",
                        });
                      }}
                      style={{ "--chapter-tone": index % 6 } as CSSProperties}
                      type="button"
                    >
                      <span>
                        {group.chapterNumber === null
                          ? "Other"
                          : `Chapter ${group.chapterNumber}`}
                      </span>
                      <strong>{group.label}</strong>
                      <small>
                        {answeredCount} answered · {openCount} open
                      </small>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {contentMode === "history" && taskContext ? (
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

          {discussion ? <div hidden={contentMode !== "study"}>
            <DiscussionStudyOverview key={discussion.id} course={course} discussion={discussion}
              questionIds={discussion.scopeType === "resource" ? coverageQuestions.filter(q => isTrackedQuestion(q) && q.status !== "archived").map(q => q.id) : undefined}
              onToggleImportantAnswer={onToggleImportantAnswer}
              onReview={(questionIds, label) => {
                onTaskQaClose?.();
                setQaReviewScope({discussionId: discussion.id, questionIds, label, initialFilter: "all", scopeKind: "resource"});
              }}
              onHistory={(messageId, targetDiscussionId) => {
                if (targetDiscussionId && targetDiscussionId !== discussion.id) onFocusResource(targetDiscussionId);
                setContentMode("history"); setHighlightOnlyDiscussionId("");
                if (messageId) {
                  setMessageExpansion(previous => new Map(previous).set(messageId, true));
                  window.setTimeout(() => document.getElementById(`discussion-message-${messageId}`)?.scrollIntoView({block: "start", behavior: "smooth"}), 100);
                }
              }}/>
          </div> : null}

          {discussion ? (
            <div className="discussionContentGrid" hidden={contentMode !== "history"}>
              <div>
                <div className="messageStream">
                  {visibleMessages.map((message, messageIndex) => {
                    const messageOpen = highlightsOnly || editingMessageId === message.id ||
                      (messageExpansion.get(message.id) ?? messageIndex === visibleMessages.length - 1);
                    return (
                    <details
                      className={`discussionMessage role-${message.role}${discussion.scopeType === "day" ? " dayScope" : ""}`}
                      id={`discussion-message-${message.id}`}
                  key={message.id}
                      open={messageOpen}
                      onToggle={event => {
                        const nextOpen = event.currentTarget.open;
                        if (nextOpen !== messageOpen) setMessageExpansion(current => new Map(current).set(message.id, nextOpen));
                      }}
                    >
                      <summary>
                        {message.role === "assistant" ? (
                          <Bot size={15} />
                        ) : (
                          <UserRound size={15} />
                        )}
                        <strong className="discussionMessageTitle">{(message.body.markdown?.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? (message.body.plainText || message.body.markdown || messageRoleLabel(message.role)).slice(0, 105)).replace(/(?:\*\*|__|==|\^\^|!!|%%|`)/g, "")}</strong>
                        <span>
                          {messageRoleLabel(message.role)} · #{message.sequenceNumber}
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
                        {message.role === "assistant" && !discussionAnswerSections(message.body.markdown || message.body.plainText).sections.some(section => section.labels.length) ? (
                          <button className="messageReviewSourceButton" type="button"
                            onClick={async event => {
                              event.preventDefault(); event.stopPropagation();
                              const button = event.currentTarget; button.disabled = true;
                              try {
                                const id = await onReviewSource(message);
                                if (id) { onTaskQaClose?.(); setQaReviewScope({discussionId: discussion.id, questionIds: [id], initialFilter: "all", label: "Review tutor note"}); }
                              } finally { button.disabled = false; }
                            }}><BookOpen size={12} /> {message.annotationLinks.some(link => annotationById.get(link.annotationId)?.origin === "discussion_review_source") ? "Review source" : "Review as source"}</button>
                        ) : null}
                        {message.role === "assistant" ? (
                          <button
                            aria-label="Delete tutor response fully"
                            className="messageDeleteButton"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setPendingMessageDelete(message);
                            }}
                            title="Delete this complete tutor response"
                            type="button"
                          >
                            <Trash2 size={12} />
                            <span>Delete response</span>
                          </button>
                        ) : null}
                      </summary>
                      <DiscussionMessageContent
                          annotationById={annotationById}
                          compactByResource={discussion.scopeType === "day"}
                          editing={editingMessageId === message.id}
                          importantQuestionIds={importantQuestionIds}
                          visible={messageOpen}
                          highlightsOnly={highlightsOnly}
                          message={message}
                          onCancelEditing={() => setEditingMessageId("")}
                          questionIdsByLabel={discussionQuestionIdsByLabel(
                            discussion,
                            course.annotations,
                          )}
                          reviewHighlights={
                            reviewAnnotationsByMessage.get(message.id) ?? []
                          }
                          resourceById={resourceById}
                          onSaveEditing={(updatedMarkdown, reviewItems) => {
                            return onUpdateMessage(message, updatedMarkdown, reviewItems);
                          }}
                          onDeleteSection={(value, ids) => {
                            if (!value.trim()) onDeleteMessage(message);
                            else onDeleteAnswer(message, value, ids);
                          }}
                        />
                      {(mappedQuestionCountByMessage.get(message.id) ?? 0) ||
                      message.role === "assistant" ? (
                        <footer>
                          {(mappedQuestionCountByMessage.get(message.id) ?? 0) ? (
                            <span>
                              {mappedQuestionCountByMessage.get(message.id)} mapped
                              {" "}question
                              {(mappedQuestionCountByMessage.get(message.id) ?? 0) === 1
                                ? ""
                                : "s"}
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
                  ); })}
                  {!highlightsOnly && !visibleMessages.length ? (
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
                  data-track="discussion.create" onClick={() => onCreateDiscussion(selectedSource.id)}
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
      {pendingMessageDelete ? (
        <ConfirmDialog
          confirmLabel="Delete response fully"
          description="This complete tutor response will disappear, its mapped questions will reopen, and follow-ups/highlights created inside it will be removed."
          onCancel={() => setPendingMessageDelete(null)}
          onConfirm={() => {
            onDeleteMessage(pendingMessageDelete);
            setPendingMessageDelete(null);
          }}
          title="Delete this tutor response?"
        />
      ) : null}
      {discussion && activeQaReviewDiscussionId === discussion.id ? (
        <DiscussionQaReview
          key={`${discussion.id}:${taskQaLaunch?.token ?? qaReviewScope?.questionIds?.join(",") ?? "all"}`}
          course={course}
          discussion={discussion}
          questionIds={
            taskQaLaunch?.discussionId === discussion.id
              ? taskQaLaunch.questionIds
              : qaReviewScope?.discussionId === discussion.id
                ? qaReviewScope.questionIds
                : undefined
          }
          scopeLabel={
            taskQaLaunch?.discussionId === discussion.id
              ? taskQaLaunch.label
              : qaReviewScope?.discussionId === discussion.id
                ? qaReviewScope.label
                : undefined
          }
          initialFilter={
            taskQaLaunch?.discussionId === discussion.id
              ? taskQaLaunch.initialFilter
              : qaReviewScope?.discussionId === discussion.id
                ? qaReviewScope.initialFilter
                : undefined
          }
          scopeKind={
            taskQaLaunch?.discussionId === discussion.id
              ? taskQaLaunch.scopeKind
              : qaReviewScope?.discussionId === discussion.id
                ? qaReviewScope.scopeKind
                : undefined
          }
          onAnnotationChange={onAnnotationChange}
          onClose={() => {
            setQaReviewScope(null);
            onTaskQaClose?.();
          }}
          onDeleteAnswer={onDeleteAnswer}
          onMapExerciseSolution={onMapExerciseSolution}
          onToggleImportantAnswer={onToggleImportantAnswer}
          onQuestionLink={onQuestionLink}
          onQaViewed={onQaViewed}
          onUpdateMessage={onUpdateMessage}
        />
      ) : null}
    </div>
  );
}

function DiscussionComposer({
  onSubmit,
}: {
  onSubmit: (input: DiscussionMessageInput) => void | boolean | Promise<void | boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [importedFromClipboard, setImportedFromClipboard] = useState(false);
  const [role, setRole] = useState<DiscussionMessageInput["role"]>("assistant");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  async function submit() {
    if (!draft.trim() || saving) return;
    setSaving(true); setSaveError("");
    try {
    const result = await onSubmit({
      markdown: draft,
      plainText: draft,
      role,
      importedFromClipboard,
    });
    if (result === false) throw new Error("Message could not be saved. Your draft is still here.");
    setDraft(current => current === draft ? "" : current);
    setImportedFromClipboard(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the message.");
    } finally { setSaving(false); }
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
          const imported = importWithDebug(pasted);
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
        <DiscussionMarkdownSurface className="discussionComposerPreview" markdown={draft}/>
      ) : null}
      {saveError ? <p className="editorSaveError" role="alert">{saveError}</p> : null}
      <div className="noteActions">
        <button type="button" className="commandButton subtle" disabled={!draft.trim() || saving}
          onClick={() => setDraft(importWithDebug(draft, {compact: true}))}>Compact layout</button>
        <button
          className="commandButton"
          disabled={!draft.trim() || saving}
          onClick={() => void submit()}
          type="button"
        >
          <Send size={14} />
          <span>{saving ? "Saving…" : "Add message"}</span>
        </button>
      </div>
    </section>
  );
}
