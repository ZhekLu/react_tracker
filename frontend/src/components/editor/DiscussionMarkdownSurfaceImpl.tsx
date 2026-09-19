import { EditorContent, useEditor } from "@tiptap/react";
import {
  Bold, Italic, Heading2, List, ListOrdered, Quote, Undo2, Redo2, Code2, Sigma,
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
  QUESTION_MARKER_HIGHLIGHT,
  SECONDARY_DISCUSSION_HIGHLIGHT,
  discussionEditorExtensions,
} from "./discussionEditorExtensions";
import { importWithDebug } from "../../lib/insertDebug";
import type { DiscussionMarkdownSurfaceProps } from "./DiscussionMarkdownSurface";
import type { DiscussionReviewItem } from "./DiscussionMarkdownSurface";

type FormulaDraft = {
  kind: "inline" | "block";
  latex: string;
  position?: number;
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
  initialReviewItems = [],
  showActions = true,
}: DiscussionMarkdownSurfaceProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const receivedMarkdownRef = useRef(markdown);
  const emittedMarkdownRef = useRef(markdown);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(markdown);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const onChangeRef = useRef(onChange);
  const onReviewItemsChangeRef = useRef(onReviewItemsChange);
  const [formulaDraft, setFormulaDraft] = useState<FormulaDraft | null>(null);
  const [followupDraft, setFollowupDraft] = useState("");
  const [pendingReviewItems, setPendingReviewItems] = useState<
    DiscussionReviewItem[]
  >(initialReviewItems);
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
      onUpdate: ({ editor: updatedEditor, transaction }) => {
        if (!editable || !transaction.docChanged) return;
        const next = updatedEditor.getMarkdown();
        emittedMarkdownRef.current = next;
        onChangeRef.current?.(next);
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
    if (!editor || receivedMarkdownRef.current === markdown) return;
    receivedMarkdownRef.current = markdown;
    // A controlled parent's echo is not an external document replacement.
    // Replacing here used to reset selection/history and reparse every keystroke.
    if (emittedMarkdownRef.current === markdown) return;
    editor.commands.setContent(markdown, { contentType, emitUpdate: false });
    emittedMarkdownRef.current = markdown;
  }, [contentType, editor, markdown]);

  if (!editor) return null;
  const activeEditor = editor;

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await onSave?.(
        sourceMode ? sourceDraft : emittedMarkdownRef.current,
        pendingReviewItems,
      );
      if (result === false) setSaveError("Save failed. Your draft is still here; try again.");
      else setPendingReviewItems([]);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save. Your draft is still here.");
    } finally {
      setSaving(false);
    }
  }

  function toggleSourceMode() {
    if (sourceMode) {
      activeEditor.commands.setContent(sourceDraft, { contentType: "markdown", emitUpdate: false });
      emittedMarkdownRef.current = sourceDraft;
    } else setSourceDraft(emittedMarkdownRef.current);
    setFormulaDraft(null);
    setReviewSelection(null);
    setSourceMode(!sourceMode);
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
    highlightTextInsideSelection(
      reviewSelection,
      QUESTION_MARKER_HIGHLIGHT,
      false,
    );
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
    toggle = true,
  ) {
    // Use the same Tiptap command path as the toolbar. A hand-built
    // transaction split text around inline-math atoms and could corrupt the
    // visual line layout when a shortcut selection crossed a formula.
    const chain = activeEditor
      .chain()
      .focus()
      .setTextSelection({
        from: selection.fromPosition,
        to: selection.toPosition,
      });
    if (toggle) chain.toggleHighlight({ color }).run();
    else chain.setHighlight({ color }).run();
  }

  function applyHighlight(secondary: boolean) {
    const color = secondary ? SECONDARY_DISCUSSION_HIGHLIGHT : PRIMARY_DISCUSSION_HIGHLIGHT;
    const selection = selectionDetails();
    if (selection) highlightTextInsideSelection(selection, color);
    else activeEditor.chain().focus().toggleHighlight({ color }).run();
    if (reviewMode && selection?.structured) {
      queueStructuredHighlight(selection, secondary ? "secondary" : "primary");
    }
    setLastShortcut(secondary ? "secondary" : "primary");
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

    if (reviewMode && command && key === "d" && !sourceMode) {
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
    if (command && key === "h" && !sourceMode) {
      event.preventDefault();
      event.stopPropagation();
      applyHighlight(event.shiftKey);
      return;
    }
    if (command && key === "b" && !sourceMode) {
      event.preventDefault();
      event.stopPropagation();
      activeEditor.commands.toggleBold();
      return;
    }
    if (command && key === "i" && !sourceMode) {
      event.preventDefault();
      event.stopPropagation();
      activeEditor.commands.toggleItalic();
      return;
    }
    if (command && event.key === "`" && !sourceMode) {
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
    if (activeEditor.isActive("codeBlock") || activeEditor.isActive("code")) return;
    // Tiptap's own HTML contains the lossless math/mark nodes for internal copy.
    if (/data-type="(?:inline-math|block-math)"/.test(event.clipboardData.getData("text/html"))) return;
    const plainText = event.clipboardData.getData("text/plain");
    if (!plainText) return;
    event.preventDefault();
    event.stopPropagation();
    activeEditor.commands.insertContent(importWithDebug(plainText), {
      contentType: "markdown",
    });
  }

  function applyFormula() {
    if (!formulaDraft?.latex.trim()) return;
    const chain = activeEditor.chain().focus();
    if (formulaDraft.position === undefined) {
      if (formulaDraft.kind === "inline") chain.insertInlineMath({ latex: formulaDraft.latex.trim() }).run();
      else chain.insertBlockMath({ latex: formulaDraft.latex.trim() }).run();
    } else if (formulaDraft.kind === "inline") {
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
      aria-busy={saving}
      inert={saving}
      className={`discussionMarkdownSurface ${editable ? "isEditing" : "isReadOnly"} ${className}`.trim()}
      onKeyDownCapture={editable ? handleKeyDown : undefined}
      onPasteCapture={editable ? handlePaste : undefined}
    >
      {editable ? (
        <header className="discussionEditorShortcuts discussionEditorToolbar" aria-label="Formatting">
          {!sourceMode ? <>
            {[
              ["Undo", Undo2, () => activeEditor.chain().focus().undo().run()],
              ["Redo", Redo2, () => activeEditor.chain().focus().redo().run()],
              ["Bold", Bold, () => activeEditor.chain().focus().toggleBold().run()],
              ["Italic", Italic, () => activeEditor.chain().focus().toggleItalic().run()],
              ["Heading", Heading2, () => activeEditor.chain().focus().toggleHeading({level: 2}).run()],
              ["Bullet list", List, () => activeEditor.chain().focus().toggleBulletList().run()],
              ["Numbered list", ListOrdered, () => activeEditor.chain().focus().toggleOrderedList().run()],
              ["Quote", Quote, () => activeEditor.chain().focus().toggleBlockquote().run()],
              ["Code", Code2, () => activeEditor.chain().focus().toggleCode().run()],
            ].map(([label, Icon, action]) => {
              const Component = Icon as typeof Bold;
              return <button type="button" key={String(label)} aria-label={String(label)} title={String(label)}
                onMouseDown={event => event.preventDefault()} onClick={action as () => void}><Component size={14} /></button>;
            })}
            <button type="button" title="Yellow highlight (⌘H)" aria-label="Yellow highlight"
              className={lastShortcut === "primary" ? "active" : ""}
              onMouseDown={event => event.preventDefault()}
              onClick={() => applyHighlight(false)}><Highlighter size={14} /></button>
            <button type="button" title="Blue highlight (⌘⇧H)" aria-label="Blue highlight"
              onMouseDown={event => event.preventDefault()}
              onClick={() => applyHighlight(true)}><Highlighter size={14} color="#4482b5" /></button>
            <button type="button" title="Insert formula" aria-label="Insert formula"
              onMouseDown={event => event.preventDefault()}
              onClick={() => setFormulaDraft({kind: "inline", latex: ""})}><Sigma size={14} /></button>
            {reviewMode ? <button type="button" onMouseDown={event => event.preventDefault()}
              onClick={() => { setFollowupDraft(""); setReviewSelection(selectionDetails()); }}
              title="Select text, then ask a follow-up (⌘D)"><MessageCircleQuestion size={14} /> Ask</button> : null}
          </> : <span>Edit original Markdown and LaTeX</span>}
          <button type="button" className="discussionSourceToggle" aria-pressed={sourceMode} onClick={toggleSourceMode}>
            {sourceMode ? "Visual editor" : "Markdown"}
          </button>
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
      {sourceMode ? <textarea className="discussionMarkdownSource" aria-label="Markdown source"
        value={sourceDraft} onChange={event => {
          setSourceDraft(event.target.value);
          emittedMarkdownRef.current = event.target.value;
          onChangeRef.current?.(event.target.value);
        }} spellCheck={false} /> : <EditorContent editor={activeEditor} />}
      {saveError ? <p role="alert" className="editorSaveError">{saveError}</p> : null}
      {editable && showActions ? (
        <footer className="discussionEditorActions">
          <button className="commandButton" disabled={saving} onClick={() => void save()} type="button">
            <Save size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
          {onCancel ? <button className="commandButton subtle" disabled={saving} onClick={onCancel} type="button">
            <X size={13} />
            Cancel
          </button> : null}
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
            {formulaDraft.position === undefined ? <select aria-label="Formula layout" value={formulaDraft.kind}
              onChange={event => setFormulaDraft({...formulaDraft, kind: event.target.value as "inline" | "block"})}>
              <option value="inline">Inline</option><option value="block">Display</option>
            </select> : null}
            <textarea
              rows={3}
              autoFocus
              onChange={(event) =>
                setFormulaDraft((current) =>
                  current ? { ...current, latex: event.target.value } : null,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
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
