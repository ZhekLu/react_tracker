import { useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  CheckCircle2,
  CircleHelp,
  ClipboardPaste,
  Copy,
  MessageSquarePlus,
  MessageSquareText,
  MessageCircleQuestion,
  Pin,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Timer,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { DiscussionMessageInput } from "../../api/trackerApi";
import { AnnotationChapterGroups } from "../../components/annotations/AnnotationChapterGroups";
import {
  InlineCaptureEditor,
  type ResourceCaptureInput,
} from "../../components/annotations/InlineCaptureEditor";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  Discussion,
  DiscussionMessage,
  DiscussionQuestionRelation,
  Resource,
} from "../../types/tracker";
import {
  discussionAnswerSections,
  discussionFollowups,
  matchAnswerSectionsToQuestions,
} from "../../lib/discussionText";

type DiscussionsViewProps = {
  course: Course;
  focusedResourceId: string;
  focusedTaskId: string;
  onAddMessage: (discussionId: string, input: DiscussionMessageInput) => void;
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
  onFocusResource: (resourceId: string) => void;
  onExtractQuestions: (
    discussionResourceId: string,
    message: DiscussionMessage,
  ) => void;
  onImportClipboard: (resourceId: string) => void;
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

function DiscussionMessageContent({
  annotationById,
  message,
  onQuestionLink,
  resourceById,
}: {
  annotationById: Map<string, Annotation>;
  message: DiscussionMessage;
  onQuestionLink: DiscussionsViewProps["onQuestionLink"];
  resourceById: Map<string, Resource>;
}) {
  const markdown = message.body.markdown || message.body.plainText;
  const linkedQuestions = message.annotationLinks
    .map((link) => annotationById.get(link.annotationId))
    .filter((item): item is Annotation =>
      Boolean(item && ["question", "todo"].includes(item.kind)),
    );
  const parsed = discussionAnswerSections(markdown);
  if (message.role !== "assistant" || !parsed.sections.length) {
    return (
      <MarkdownMath className="discussionMessageBody">
        {markdown}
      </MarkdownMath>
    );
  }
  const sectionMatches = new Map(
    matchAnswerSectionsToQuestions(
      parsed.sections,
      linkedQuestions.map((question) => ({
        id: question.id,
        text: questionText(question),
      })),
    ).map((match) => [match.sectionLabel, match.questionId]),
  );
  return (
    <div className="discussionStructuredAnswer">
      {parsed.preamble ? (
        <MarkdownMath className="discussionMessageBody">
          {parsed.preamble}
        </MarkdownMath>
      ) : null}
      {parsed.sections.map((section) => {
        const questionId = sectionMatches.get(section.label);
        const question = questionId
          ? annotationById.get(questionId)
          : undefined;
        const relation = question
          ? message.annotationLinks.find(
              (link) => link.annotationId === question.id,
            )?.relation
          : undefined;
        const source = question
          ? resourceById.get(question.resourceId)
          : undefined;
        return (
          <section className="discussionAnswerSection" key={section.label}>
            {question ? (
              <aside
                className={`inlineAnsweredQuestion status-${question.status}`}
              >
                <header>
                  <span>{section.label} · linked question</span>
                  <strong>{relation ?? question.status}</strong>
                </header>
                <MarkdownMath>{questionText(question)}</MarkdownMath>
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
            ) : null}
            <MarkdownMath className="discussionMessageBody">
              {section.markdown}
            </MarkdownMath>
          </section>
        );
      })}
    </div>
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
  onQuestionLink,
  resource,
  resourceById,
  showHighlights,
  studyCaptureCount,
  onShowHighlightsChange,
}: DiscussionWorkshopPanelProps) {
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
            {coverageQuestions.map((question) => {
              const linkedRelation = [...discussion.messages]
                .reverse()
                .flatMap((message) => message.annotationLinks)
                .find((link) => link.annotationId === question.id)?.relation;
              const source = resourceById.get(question.resourceId);
              return (
                <article
                  className={`discussionQuestion status-${question.status}`}
                  key={question.id}
                >
                  <header>
                    <strong>{source?.title ?? "Source question"}</strong>
                    <span>{linkedRelation ?? question.status}</span>
                  </header>
                  <MarkdownMath>{questionText(question)}</MarkdownMath>
                  <div>
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
  onAnnotationChange,
  onAskMessageQuestion,
  onCreateCapture,
  onCreateDiscussion,
  onDeleteDiscussion,
  onDiscussionStatusChange,
  onExtractQuestions,
  onFocusResource,
  onImportClipboard,
  onCopy,
  onOpenResource,
  onQuestionLink,
}: DiscussionsViewProps) {
  const [pendingDelete, setPendingDelete] = useState<Discussion | null>(null);
  const [captureEditorResourceId, setCaptureEditorResourceId] = useState("");
  const [allCaptureResourceId, setAllCaptureResourceId] = useState("");
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
      ? discussion.sourceResourceIds[0] ?? ""
      : sourceResources.some((resource) => resource.id === focusedResourceId)
        ? focusedResourceId
        : sourceResources[0]?.id ?? "";
  const selectedSource = course.resources.find(
    (resource) => resource.id === selectedSourceId,
  );
  const captureEditorOpen = captureEditorResourceId === selectedSourceId;
  const followups = discussion ? discussionFollowups(discussion) : "";
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

  function handleCaptureEditorOpenChange(open: boolean) {
    setCaptureEditorResourceId(open ? selectedSourceId : "");
  }

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
                    <span>Follow-ups</span>
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
                  {discussion.messages.map((message) => (
                    <article
                      className={`discussionMessage role-${message.role}`}
                      key={message.id}
                    >
                      <header>
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
                      </header>
                      <DiscussionMessageContent
                        annotationById={annotationById}
                        message={message}
                        onQuestionLink={onQuestionLink}
                        resourceById={resourceById}
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
                    </article>
                  ))}
                  {!discussion.messages.length ? (
                    <div className="emptyInline">
                      The thread is ready for its first message.
                    </div>
                  ) : null}
                </div>
                <DiscussionComposer
                  onSubmit={(input) => onAddMessage(discussion.id, input)}
                />
              </div>
              {selectedSource ? (
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
                  onQuestionLink={onQuestionLink}
                  resource={selectedSource}
                  resourceById={resourceById}
                  showHighlights={showHighlights}
                  studyCaptureCount={studyCaptures.length}
                  onShowHighlightsChange={(show) =>
                    setAllCaptureResourceId(show ? selectedSourceId : "")
                  }
                />
              ) : null}
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
              <DiscussionWorkshopPanel
                activeCaptures={activeCaptures}
                allCapturesCount={allActiveCaptures.length}
                answeredCount={answeredCount}
                captureEditorOpen={captureEditorOpen}
                coverageQuestions={coverageQuestions}
                onAnnotationChange={onAnnotationChange}
                onCaptureEditorOpenChange={handleCaptureEditorOpenChange}
                onCreateCapture={onCreateCapture}
                onQuestionLink={onQuestionLink}
                resource={selectedSource}
                resourceById={resourceById}
                showHighlights={showHighlights}
                studyCaptureCount={studyCaptures.length}
                onShowHighlightsChange={(show) =>
                  setAllCaptureResourceId(show ? selectedSourceId : "")
                }
              />
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
  const [role, setRole] = useState<DiscussionMessageInput["role"]>("assistant");

  function submit() {
    if (!draft.trim()) return;
    onSubmit({
      markdown: draft,
      plainText: draft,
      role,
    });
    setDraft("");
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
