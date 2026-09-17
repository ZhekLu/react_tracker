import { useEffect, useState } from "react";
import {
  FilePenLine,
  GraduationCap,
  Highlighter,
  Pencil,
  Trash2,
} from "lucide-react";
import { DiscussionMarkdownSurface } from "../editor/DiscussionMarkdownSurface";
import {
  discussionHighlights,
  discussionHighlightsMarkdown,
} from "../../lib/discussionHighlights";
import type { Attention, Note } from "../../types/tracker";
import { FileMentionChips } from "./FileMentionChips";
import { NoteWorkspace } from "./NoteWorkspace";
import { highlightNoteMarkers } from "../../lib/noteMarkers";

type EntityNoteEditorProps = {
  defaultEditing?: boolean;
  defaultOpen?: boolean;
  label?: string;
  note?: Note;
  placeholder: string;
  onSave: (markdown: string) => void | boolean | Promise<void | boolean>;
  onAttentionChange?: (note: Note, attention: Attention) => void;
  onDelete?: (note: Note) => void;
  deleteLabel?: string;
  showDeleteInSummary?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
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
  defaultEditing = false,
  defaultOpen = false,
  label = "Notes",
  note,
  placeholder,
  onAttentionChange,
  onDelete,
  deleteLabel = "Delete note",
  showDeleteInSummary = false,
  onDirtyChange,
  onSave,
}: EntityNoteEditorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState(noteContent(note));
  const [savedContent, setSavedContent] = useState(noteContent(note));
  const [editing, setEditing] = useState(defaultEditing || !savedContent.trim());
  const [highlightsOnly, setHighlightsOnly] = useState(false);
  const highlights = discussionHighlights(savedContent);
  const contentType = noteContentType(savedContent);
  useEffect(() => { onDirtyChange?.(draft !== savedContent); }, [draft, savedContent, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  async function save(markdown: string) {
    const highlighted = highlightNoteMarkers(markdown);
    const result = await onSave(highlighted);
    if (result === false) return false;
    setDraft(highlighted);
    setSavedContent(highlighted);
    setEditing(false);
    return true;
  }

  return (
    <details
      className={`entityNoteEditor ${highlightsOnly ? "highlightsOnly" : ""}`}
      open={open}
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
        {showDeleteInSummary && note && onDelete ? (
          <button
            aria-label={deleteLabel}
            className="noteSummaryDelete"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete(note);
            }}
            title={deleteLabel}
            type="button"
          >
            <Trash2 size={12} />
            <span>{deleteLabel}</span>
          </button>
        ) : null}
      </summary>
      {open ? (
        <div className="entityNoteEditorBody">
          <NoteWorkspace editing={editing} onEdit={() => setEditing(true)}>
          {editing ? (
            <DiscussionMarkdownSurface
              contentType={noteContentType(draft)}
              editable
              markdown={draft}
              onChange={setDraft}
              onCancel={() => { setDraft(savedContent); setEditing(false); }}
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
                {note && onDelete ? (
                  <button
                    className="commandButton danger subtle"
                    onClick={() => onDelete(note)}
                    type="button"
                  >
                    <Trash2 size={13} />
                    <span>{deleteLabel}</span>
                  </button>
                ) : null}
              </div>
            </>
          )}
          </NoteWorkspace>
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
