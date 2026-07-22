import { EditorContent, useEditor } from "@tiptap/react";
import {
  CornerDownLeft,
  Highlighter,
  MessageCircleQuestion,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PRIMARY_DISCUSSION_HIGHLIGHT,
  SECONDARY_DISCUSSION_HIGHLIGHT,
  discussionEditorExtensions,
} from "./discussionEditorExtensions";
import { normalizeDiscussionMarkdown } from "../../lib/discussionText";
import { importPastedMarkdown } from "../../lib/discussionImport";
import type { DiscussionMarkdownSurfaceProps } from "./DiscussionMarkdownSurface";
import type { DiscussionReviewItem } from "./DiscussionMarkdownSurface";

type FormulaDraft = {
  kind: "inline" | "block";
  latex: string;
  position: number;
};

type ReviewSelection = {
  contextAfter: string;
  contextBefore: string;
  fromPosition: number;
  left: number;
  quote: string;
  structured: boolean;
  structuredMarkdown: string;
  toPosition: number;
  top: number;
};

function structuredSelectionMarkdown(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  from: number,
  to: number,
): { markdown: string; structured: boolean; structuredMarkdown: string } {
  const blocks: string[] = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "inlineMath") {
      blocks.push(`$${String(node.attrs.latex ?? "").trim()}$`);
      return false;
    }
    if (node.type.name === "blockMath") {
      blocks.push(`$$\n${String(node.attrs.latex ?? "").trim()}\n$$`);
      return false;
    }
    if (node.type.name === "codeBlock") {
      const language = String(node.attrs.language ?? "").trim();
      blocks.push(`\`\`\`${language}\n${node.textContent}\n\`\`\``);
      return false;
    }
    return true;
  });
  const plainText = editor.state.doc
    .textBetween(from, to, "\n", (node) => {
      if (node.type.name === "inlineMath") {
        return `$${String(node.attrs.latex ?? "").trim()}$`;
      }
      if (node.type.name === "blockMath") {
        return `$$\n${String(node.attrs.latex ?? "").trim()}\n$$`;
      }
      return " ";
    })
    .trim();
  return {
    markdown: plainText || blocks.join("\n\n"),
    structured: blocks.length > 0,
    structuredMarkdown: blocks.join("\n\n"),
  };
}

export function DiscussionMarkdownSurfaceImpl({
  className = "",
  contentType = "markdown",
  editable = false,
  markdown,
  onCancel,
  onChange,
  onReviewItemsChange,
  onSave,
  placeholder,
  reviewMode = false,
  showActions = true,
}: DiscussionMarkdownSurfaceProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const changeEventsReadyRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onReviewItemsChangeRef = useRef(onReviewItemsChange);
  const [formulaDraft, setFormulaDraft] = useState<FormulaDraft | null>(null);
  const [followupDraft, setFollowupDraft] = useState("");
  const [pendingReviewItems, setPendingReviewItems] = useState<
    DiscussionReviewItem[]
  >([]);
  const [reviewSelection, setReviewSelection] =
    useState<ReviewSelection | null>(null);
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
      onUpdate: ({ editor: updatedEditor }) => {
        if (!editable || !changeEventsReadyRef.current) return;
        onChangeRef.current?.(
          normalizeDiscussionMarkdown(updatedEditor.getMarkdown()),
        );
      },
    },
    [editable, placeholder],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onReviewItemsChangeRef.current = onReviewItemsChange;
  }, [onReviewItemsChange]);

  useEffect(() => {
    onReviewItemsChangeRef.current?.(pendingReviewItems);
  }, [pendingReviewItems]);

  useEffect(() => {
    changeEventsReadyRef.current = false;
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => {
      changeEventsReadyRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor]);

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
    onSave?.(
      normalizeDiscussionMarkdown(activeEditor.getMarkdown()),
      pendingReviewItems,
    );
  }

  function selectionDetails(): ReviewSelection | null {
    const { from, to } = activeEditor.state.selection;
    if (from === to) return null;
    const selected = structuredSelectionMarkdown(activeEditor, from, to);
    if (!selected.markdown.trim()) return null;
    const contextRadius = 240;
    const documentSize = activeEditor.state.doc.content.size;
    const contextBefore = activeEditor.state.doc
      .textBetween(Math.max(0, from - contextRadius), from, "\n", " ")
      .replace(/\s+/g, " ")
      .trim();
    const contextAfter = activeEditor.state.doc
      .textBetween(to, Math.min(documentSize, to + contextRadius), "\n", " ")
      .replace(/\s+/g, " ")
      .trim();
    const surfaceRect = surfaceRef.current?.getBoundingClientRect();
    const selection = window.getSelection();
    const selectionRect =
      selection?.rangeCount
        ? selection.getRangeAt(0).getBoundingClientRect()
        : activeEditor.view.coordsAtPos(to);
    const left = surfaceRect
      ? Math.max(8, Math.min(selectionRect.left - surfaceRect.left, surfaceRect.width - 310))
      : 8;
    const top = surfaceRect
      ? Math.max(42, selectionRect.bottom - surfaceRect.top + 8)
      : 42;
    return {
      contextAfter: contextAfter.slice(0, contextRadius),
      contextBefore: contextBefore.slice(-contextRadius),
      fromPosition: from,
      left,
      quote: selected.markdown,
      structured: selected.structured,
      structuredMarkdown: selected.structuredMarkdown,
      toPosition: to,
      top,
    };
  }

  function queueReviewItem(item: DiscussionReviewItem) {
    setPendingReviewItems((current) =>
      current.some(
        (queued) =>
          queued.kind === item.kind &&
          queued.fromPosition === item.fromPosition &&
          queued.toPosition === item.toPosition &&
          queued.markdown === item.markdown,
      )
        ? current
        : [...current, item],
    );
    setFollowupDraft("");
    setReviewSelection(null);
  }

  function queueFollowup() {
    if (!reviewSelection || !followupDraft.trim()) return;
    queueReviewItem({
      contextAfter: reviewSelection.contextAfter,
      contextBefore: reviewSelection.contextBefore,
      fromPosition: reviewSelection.fromPosition,
      kind: "question",
      markdown: followupDraft.trim(),
      quote: reviewSelection.quote,
      toPosition: reviewSelection.toPosition,
    });
  }

  function queueStructuredHighlight(
    selection: ReviewSelection,
    color: "primary" | "secondary",
  ) {
    queueReviewItem({
      color,
      contextAfter: selection.contextAfter,
      contextBefore: selection.contextBefore,
      fromPosition: selection.fromPosition,
      kind: "highlight",
      markdown: selection.structuredMarkdown,
      quote: selection.structuredMarkdown,
      toPosition: selection.toPosition,
    });
  }

  function highlightTextInsideSelection(
    selection: ReviewSelection,
    color: string,
  ) {
    const mark = activeEditor.schema.marks.highlight.create({ color });
    const transaction = activeEditor.state.tr;
    activeEditor.state.doc.nodesBetween(
      selection.fromPosition,
      selection.toPosition,
      (node, position) => {
        if (!node.isText) return true;
        const from = Math.max(selection.fromPosition, position);
        const to = Math.min(selection.toPosition, position + node.nodeSize);
        if (from < to) transaction.addMark(from, to, mark);
        return false;
      },
    );
    activeEditor.view.dispatch(transaction);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (
      (event.target as HTMLElement).closest(
        ".discussionFormulaComposer, .discussionSelectionReview",
      )
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.metaKey || event.ctrlKey;

    if (reviewMode && command && key === "d") {
      event.preventDefault();
      event.stopPropagation();

      const selection = selectionDetails();

      if (!selection) {
        return;
      }

      setFollowupDraft("");
      setReviewSelection(selection);

      return;
    }
    if (command && key === "h") {
      event.preventDefault();
      event.stopPropagation();
      const secondary = event.shiftKey;
      const selection = selectionDetails();
      if (reviewMode && selection?.structured) {
        const color = secondary
          ? SECONDARY_DISCUSSION_HIGHLIGHT
          : PRIMARY_DISCUSSION_HIGHLIGHT;
        highlightTextInsideSelection(selection, color);
        queueStructuredHighlight(
          selection,
          secondary ? "secondary" : "primary",
        );
        setLastShortcut(secondary ? "secondary" : "primary");
        return;
      }
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
      ref={surfaceRef}
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
          {reviewMode ? <span>select → Ctrl/⌘ + D to ask follow-up</span> : null}
        </header>
      ) : null}
      {pendingReviewItems.length ? (
        <div className="discussionPendingReview" role="status">
          <span>
            {pendingReviewItems.filter((item) => item.kind === "question").length}
            {" "}follow-up
            {pendingReviewItems.filter((item) => item.kind === "question").length === 1 ? "" : "s"}
            {" · "}
            {pendingReviewItems.filter((item) => item.kind === "highlight").length}
            {" "}structured highlight
            {pendingReviewItems.filter((item) => item.kind === "highlight").length === 1 ? "" : "s"}
            {" "}queued until save
          </span>
          <button
            aria-label="Clear queued review items"
            onClick={() => setPendingReviewItems([])}
            title="Clear queued review items"
            type="button"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ) : null}
      <EditorContent editor={activeEditor} />
      {editable && showActions ? (
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
      {reviewSelection ? (
        <div
          className="discussionSelectionReview"
          style={{ left: reviewSelection.left, top: reviewSelection.top }}
        >
          <header>
            <MessageCircleQuestion size={13} />
            <strong>Ask about selection</strong>
            {reviewSelection.structured ? (
              <span><Highlighter size={11} /> structured</span>
            ) : null}
            <button
              aria-label="Close selection review"
              onClick={() => {
                setReviewSelection(null);
                setFollowupDraft("");
              }}
              type="button"
            >
              <X size={12} />
            </button>
          </header>
          <blockquote>{reviewSelection.quote.slice(0, 240)}</blockquote>
          <textarea
            autoFocus
            onChange={(event) => setFollowupDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                queueFollowup();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setReviewSelection(null);
                setFollowupDraft("");
              }
            }}
            placeholder="What should the tutor clarify?"
            rows={2}
            value={followupDraft}
          />
          <footer>
            <span><CornerDownLeft size={11} /> ⌘Enter</span>
            <button disabled={!followupDraft.trim()} onClick={queueFollowup} type="button">
              Queue follow-up
            </button>
          </footer>
        </div>
      ) : null}
    </section>
  );
}
