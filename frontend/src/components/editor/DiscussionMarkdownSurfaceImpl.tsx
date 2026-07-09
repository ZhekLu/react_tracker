import { EditorContent, useEditor } from "@tiptap/react";
import { Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PRIMARY_DISCUSSION_HIGHLIGHT,
  SECONDARY_DISCUSSION_HIGHLIGHT,
  discussionEditorExtensions,
} from "./discussionEditorExtensions";
import { normalizeDiscussionMarkdown } from "../../lib/discussionText";
import { importPastedMarkdown } from "../../lib/discussionImport";
import type { DiscussionMarkdownSurfaceProps } from "./DiscussionMarkdownSurface";

type FormulaDraft = {
  kind: "inline" | "block";
  latex: string;
  position: number;
};

export function DiscussionMarkdownSurfaceImpl({
  className = "",
  contentType = "markdown",
  editable = false,
  markdown,
  onCancel,
  onSave,
  placeholder,
}: DiscussionMarkdownSurfaceProps) {
  const [formulaDraft, setFormulaDraft] = useState<FormulaDraft | null>(null);
  const [lastShortcut, setLastShortcut] = useState<
    "primary" | "secondary" | null
  >(null);
  const extensions = useMemo(
    () =>
      discussionEditorExtensions((kind, latex, position) => {
        if (editable) setFormulaDraft({ kind, latex, position });
      }, placeholder),
    [editable, placeholder],
  );
  const editor = useEditor(
    {
      content: markdown,
      contentType,
      editable,
      extensions,
      editorProps: {
        attributes: {
          class: editable
            ? "discussionRichSurface editing"
            : "discussionRichSurface",
        },
      },
      immediatelyRender: false,
    },
    [editable, placeholder],
  );

  useEffect(() => {
    if (!editor || editor.getMarkdown() === markdown) return;
    editor.commands.setContent(markdown, {
      contentType,
      emitUpdate: false,
    });
  }, [contentType, editor, markdown]);

  if (!editor) return null;
  const activeEditor = editor;

  function save() {
    onSave?.(normalizeDiscussionMarkdown(activeEditor.getMarkdown()));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(".discussionFormulaComposer")) {
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.metaKey || event.ctrlKey;
    if (command && key === "h") {
      event.preventDefault();
      event.stopPropagation();
      const secondary = event.shiftKey;
      activeEditor.commands.toggleHighlight({
        color: secondary
          ? SECONDARY_DISCUSSION_HIGHLIGHT
          : PRIMARY_DISCUSSION_HIGHLIGHT,
      });
      setLastShortcut(secondary ? "secondary" : "primary");
      return;
    }
    if (command && key === "b") {
      event.preventDefault();
      event.stopPropagation();
      activeEditor.commands.toggleBold();
      return;
    }
    if (command && key === "i") {
      event.preventDefault();
      event.stopPropagation();
      activeEditor.commands.toggleItalic();
      return;
    }
    if (command && event.key === "`") {
      event.preventDefault();
      event.stopPropagation();
      activeEditor.commands.toggleCode();
      return;
    }
    if (command && key === "s") {
      event.preventDefault();
      event.stopPropagation();
      save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    if (!(event.target as HTMLElement).closest(".ProseMirror")) return;
    const plainText = event.clipboardData.getData("text/plain");
    if (!plainText) return;
    event.preventDefault();
    activeEditor.commands.insertContent(importPastedMarkdown(plainText), {
      contentType: "markdown",
    });
  }

  function applyFormula() {
    if (!formulaDraft?.latex.trim()) return;
    const chain = activeEditor.chain().focus();
    if (formulaDraft.kind === "inline") {
      chain
        .updateInlineMath({
          latex: formulaDraft.latex.trim(),
          pos: formulaDraft.position,
        })
        .run();
    } else {
      chain
        .updateBlockMath({
          latex: formulaDraft.latex.trim(),
          pos: formulaDraft.position,
        })
        .run();
    }
    setFormulaDraft(null);
  }

  return (
    <section
      className={`discussionMarkdownSurface ${editable ? "isEditing" : "isReadOnly"} ${className}`.trim()}
      onKeyDownCapture={editable ? handleKeyDown : undefined}
      onPasteCapture={editable ? handlePaste : undefined}
    >
      {editable ? (
        <header className="discussionEditorShortcuts">
          <span>⌘B bold</span>
          <span>⌘I italic</span>
          <span>⌘` code</span>
          <span
            className={`primaryHighlightShortcut ${lastShortcut === "primary" ? "shortcutApplied" : ""}`}
          >
            ⌘H highlight
          </span>
          <span
            className={`secondaryHighlightShortcut ${lastShortcut === "secondary" ? "shortcutApplied" : ""}`}
          >
            ⌘⇧H highlight
          </span>
          <span>⌘S save</span>
        </header>
      ) : null}
      <EditorContent editor={activeEditor} />
      {editable ? (
        <footer className="discussionEditorActions">
          <button className="commandButton" onClick={save} type="button">
            <Save size={13} />
            Save
          </button>
          <button className="commandButton subtle" onClick={onCancel} type="button">
            <X size={13} />
            Cancel
          </button>
        </footer>
      ) : null}
      {formulaDraft ? (
        <div
          aria-label={`Edit ${formulaDraft.kind} formula`}
          className="formulaComposer discussionFormulaComposer"
          role="dialog"
        >
          <label>
            <span>Edit {formulaDraft.kind} formula</span>
            <input
              autoFocus
              onChange={(event) =>
                setFormulaDraft((current) =>
                  current ? { ...current, latex: event.target.value } : null,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyFormula();
                }
                if (event.key === "Escape") setFormulaDraft(null);
              }}
              value={formulaDraft.latex}
            />
          </label>
          <button onClick={applyFormula} type="button">
            Apply
          </button>
          <button onClick={() => setFormulaDraft(null)} type="button">
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
}
