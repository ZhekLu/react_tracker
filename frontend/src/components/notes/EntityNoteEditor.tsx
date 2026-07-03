import { useState } from "react";
import {
  FilePenLine,
  GraduationCap,
  Highlighter,
  Pencil,
} from "lucide-react";
import { DiscussionMarkdownSurface } from "../editor/DiscussionMarkdownSurface";
import {
  discussionHighlights,
  discussionHighlightsMarkdown,
} from "../../lib/discussionHighlights";
import type { Attention, Note } from "../../types/tracker";
import { FileMentionChips } from "./FileMentionChips";

type EntityNoteEditorProps = {
  label?: string;
  note?: Note;
  placeholder: string;
  onSave: (html: string) => void;
  onAttentionChange?: (note: Note, attention: Attention) => void;
};

function noteContent(note?: Note): string {
  return note?.document.markdown ?? note?.document.plainText ?? "";
}

function noteContentType(content: string): "html" | "markdown" {
  return /^\s*<(?:p|h[1-6]|ul|ol|pre|blockquote)\b/i.test(content)
    ? "html"
    : "markdown";
}

export function EntityNoteEditor({
  label = "Notes",
  note,
  placeholder,
  onAttentionChange,
  onSave,
}: EntityNoteEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(noteContent(note));
  const [savedContent, setSavedContent] = useState(noteContent(note));
  const [editing, setEditing] = useState(!savedContent.trim());
  const [highlightsOnly, setHighlightsOnly] = useState(false);
  const highlights = discussionHighlights(savedContent);
  const contentType = noteContentType(savedContent);

  function save(markdown: string) {
    onSave(markdown);
    setDraft(markdown);
    setSavedContent(markdown);
    setEditing(false);
  }

  return (
    <details
      className={`entityNoteEditor ${highlightsOnly ? "highlightsOnly" : ""}`}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (nextOpen && !savedContent.trim()) setEditing(true);
      }}
    >
      <summary>
        <FilePenLine size={14} />
        <span>{label}</span>
        {savedContent.trim() ? <span className="notePresent">saved</span> : null}
        {note && onAttentionChange ? (
          <button
            aria-label={
              note.attention === "professor"
                ? "Remove professor discussion flag"
                : "Mark to discuss with professor"
            }
            className={
              note.attention === "professor"
                ? "noteAttentionToggle active"
                : "noteAttentionToggle"
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAttentionChange(
                note,
                note.attention === "professor" ? "none" : "professor",
              );
            }}
            title={
              note.attention === "professor"
                ? "Marked for professor"
                : "Discuss with professor"
            }
            type="button"
          >
            <GraduationCap size={12} />
          </button>
        ) : null}
        {highlights.length ? (
          <button
            aria-label={
              highlightsOnly ? "Show full note" : "Show note highlights only"
            }
            className={highlightsOnly ? "noteHighlightToggle active" : "noteHighlightToggle"}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setHighlightsOnly((current) => !current);
            }}
            title={highlightsOnly ? "Show full note" : "Highlights only"}
            type="button"
          >
            <Highlighter size={12} />
          </button>
        ) : null}
      </summary>
      {open ? (
        <div className="entityNoteEditorBody">
          {editing ? (
            <DiscussionMarkdownSurface
              contentType={noteContentType(draft)}
              editable
              markdown={draft}
              onCancel={() => setEditing(false)}
              onSave={save}
              placeholder={placeholder}
            />
          ) : (
            <>
              <DiscussionMarkdownSurface
                className="entityNotePreview"
                contentType={highlightsOnly ? "markdown" : contentType}
                markdown={
                  highlightsOnly
                    ? discussionHighlightsMarkdown(savedContent)
                    : savedContent
                }
              />
              <FileMentionChips
                courseId={note?.courseId}
                markdown={savedContent}
              />
              <div className="noteActions">
                <button
                  className="commandButton subtle"
                  onClick={() => setEditing(true)}
                  type="button"
                >
                  <Pencil size={13} />
                  <span>Edit</span>
                </button>
              </div>
            </>
          )}
          {!editing && !savedContent.trim() ? (
            <button
              className="commandButton"
              onClick={() => setEditing(true)}
              type="button"
            >
              <Pencil size={13} />
              <span>Write note</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
