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
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import type { DiscussionMessageInput } from "../../api/trackerApi";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import type {
  Annotation,
  Course,
  Discussion,
  DiscussionMessage,
  DiscussionQuestionRelation,
} from "../../types/tracker";
import { discussionFollowups } from "../../lib/discussionText";

type DiscussionsViewProps = {
  course: Course;
  focusedResourceId: string;
  onAddMessage: (discussionId: string, input: DiscussionMessageInput) => void;
  onAskMessageQuestion: (
    discussionResourceId: string,
    messageId: string,
    messagePreview: string,
  ) => void;
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

export function DiscussionsView({
  course,
  focusedResourceId,
  onAddMessage,
  onAskMessageQuestion,
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
  const sourceResources = course.resources.filter(
    (resource) =>
      !["discussion", "exam_question"].includes(resource.kind),
  );
  const discussion =
    course.discussions.find(
      (item) =>
        item.id === focusedResourceId ||
        item.resourceId === focusedResourceId,
    ) ??
    course.discussions.find((item) =>
      item.sourceResourceIds.includes(focusedResourceId),
    ) ??
    course.discussions[0];
  const selectedSourceId =
    discussion
      ? discussion.sourceResourceIds[0] ?? ""
      : sourceResources.some((resource) => resource.id === focusedResourceId)
        ? focusedResourceId
        : sourceResources[0]?.id ?? "";
  const selectedSource = course.resources.find(
    (resource) => resource.id === selectedSourceId,
  );
  const followups = discussion ? discussionFollowups(discussion) : "";
  const annotationById = useMemo(
    () => new Map(course.annotations.map((annotation) => [annotation.id, annotation])),
    [course.annotations],
  );
  const resourceById = useMemo(
    () => new Map(course.resources.map((resource) => [resource.id, resource])),
    [course.resources],
  );
  const questions = (discussion?.questionIds ?? [])
    .map((id) => annotationById.get(id))
    .filter((item): item is Annotation => Boolean(item));
  const latestAssistantMessage = [...(discussion?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");
  const answeredCount = questions.filter(
    (question) => question.status === "answered",
  ).length;

  return (
    <div className="discussionLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Tutor conversations</p>
          <h2>
            {course.discussions.length} discussion
            {course.discussions.length === 1 ? "" : "s"} · {answeredCount}/
            {questions.length} linked questions answered
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
                      <MarkdownMath className="discussionMessageBody">
                        {message.body.markdown || message.body.plainText}
                      </MarkdownMath>
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
              <aside className="discussionQuestionPanel">
                <header>
                  <div>
                    <p className="eyebrow">Question coverage</p>
                    <h3>
                      {answeredCount}/{questions.length} answered
                    </h3>
                  </div>
                  <CircleHelp size={18} />
                </header>
                {questions.map((question) => {
                  const linkedRelation = [...(discussion.messages ?? [])]
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
                {!questions.length ? (
                  <div className="emptyInline">
                    This thread has no prompt-batch questions yet.
                  </div>
                ) : null}
              </aside>
            </div>
          ) : selectedSource ? (
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
