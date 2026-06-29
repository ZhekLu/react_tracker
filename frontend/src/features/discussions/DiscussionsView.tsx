import { lazy, Suspense, useState } from "react";
import {
  BookOpen,
  Bot,
  MessageSquarePlus,
  MessageSquareText,
  Plus,
  Send,
  UserRound,
} from "lucide-react";
import type { DiscussionMessageInput } from "../../api/trackerApi";
import type { Course, Discussion } from "../../types/tracker";

const RichNoteEditor = lazy(() =>
  import("../../components/editor/RichNoteEditor").then((module) => ({
    default: module.RichNoteEditor,
  })),
);

type DiscussionsViewProps = {
  course: Course;
  focusedResourceId: string;
  onAddMessage: (discussionId: string, input: DiscussionMessageInput) => void;
  onCreateDiscussion: (resourceId: string) => void;
  onFocusResource: (resourceId: string) => void;
  onOpenResource: (resourceId: string) => void;
};

function messageRoleLabel(role: Discussion["messages"][number]["role"]): string {
  if (role === "assistant") return "Tutor";
  if (role === "personal_note") return "Personal note";
  return role[0].toUpperCase() + role.slice(1);
}

export function DiscussionsView({
  course,
  focusedResourceId,
  onAddMessage,
  onCreateDiscussion,
  onFocusResource,
  onOpenResource,
}: DiscussionsViewProps) {
  const resources = course.resources.filter((resource) => resource.kind !== "exam_question");
  const selectedResourceId =
    focusedResourceId ||
    course.discussions[0]?.resourceId ||
    resources[0]?.id ||
    "";
  const selectedResource = course.resources.find((resource) => resource.id === selectedResourceId);
  const discussion = course.discussions.find((item) => item.resourceId === selectedResourceId);

  return (
    <div className="discussionLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Tutor conversations</p>
          <h2>{course.discussions.length} linked discussion{course.discussions.length === 1 ? "" : "s"}</h2>
        </div>
        <label className="discussionResourceSelect">
          <span>Resource</span>
          <select
            onChange={(event) => onFocusResource(event.target.value)}
            value={selectedResourceId}
          >
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>{resource.title}</option>
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
          {course.discussions.map((item) => {
            const resource = course.resources.find((candidate) => candidate.id === item.resourceId);
            return (
              <button
                className={item.resourceId === selectedResourceId ? "active" : ""}
                key={item.id}
                onClick={() => onFocusResource(item.resourceId)}
                type="button"
              >
                <strong>{resource?.title ?? item.title}</strong>
                <span>{item.messages.length} messages · {item.status}</span>
              </button>
            );
          })}
          {!course.discussions.length ? <p>No discussions yet.</p> : null}
        </aside>

        <section className="discussionMain">
          <header className="discussionHeader">
            <div>
              <p className="eyebrow">Linked resource</p>
              <h2>{selectedResource?.title ?? "Choose a resource"}</h2>
            </div>
            {selectedResource ? (
              <button
                className="commandButton subtle"
                onClick={() => onOpenResource(selectedResource.id)}
                type="button"
              >
                <BookOpen size={15} />
                <span>Open source</span>
              </button>
            ) : null}
          </header>

          {discussion ? (
            <>
              <div className="messageStream">
                {discussion.messages.map((message) => (
                  <article className={`discussionMessage role-${message.role}`} key={message.id}>
                    <header>
                      {message.role === "assistant" ? <Bot size={15} /> : <UserRound size={15} />}
                      <strong>{messageRoleLabel(message.role)}</strong>
                      <span>#{message.sequenceNumber}</span>
                    </header>
                    <div className="discussionMessageBody">{message.body.plainText}</div>
                  </article>
                ))}
                {!discussion.messages.length ? (
                  <div className="emptyInline">The thread is ready for its first message.</div>
                ) : null}
              </div>
              <DiscussionComposer
                onSubmit={(input) => onAddMessage(discussion.id, input)}
              />
            </>
          ) : selectedResource ? (
            <div className="discussionEmpty">
              <MessageSquarePlus size={28} />
              <h3>No discussion for this resource yet</h3>
              <p>Create one thread; future GPT exchanges will stay in sequence here.</p>
              <button
                className="commandButton"
                onClick={() => onCreateDiscussion(selectedResource.id)}
                type="button"
              >
                <Plus size={15} />
                <span>Create discussion</span>
              </button>
            </div>
          ) : null}
        </section>
      </div>
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
    const element = document.createElement("div");
    element.innerHTML = draft;
    onSubmit({
      markdown: draft,
      plainText: element.textContent ?? draft,
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
            onChange={(event) => setRole(event.target.value as DiscussionMessageInput["role"])}
            value={role}
          >
            <option value="assistant">Tutor response</option>
            <option value="user">My prompt</option>
            <option value="personal_note">Personal note</option>
          </select>
        </label>
      </header>
      <Suspense fallback={<div className="editorLoading">Loading editor...</div>}>
        <RichNoteEditor
          initialContent={draft}
          onChange={setDraft}
          placeholder="Paste or write the next exchange..."
        />
      </Suspense>
      <div className="noteActions">
        <button className="commandButton" disabled={!draft.trim()} onClick={submit} type="button">
          <Send size={14} />
          <span>Add message</span>
        </button>
      </div>
    </section>
  );
}
