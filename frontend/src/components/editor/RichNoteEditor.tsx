import Highlight from "@tiptap/extension-highlight";
import {
  Mathematics,
  migrateMathStrings,
} from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading2,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Redo2,
  Sigma,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { IconButton } from "../ui/IconButton";

type RichNoteEditorProps = {
  initialContent?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
};

export function RichNoteEditor({ initialContent, placeholder = "Write notes, questions, or GPT follow-ups...", onChange }: RichNoteEditorProps) {
  const [mathEditor, setMathEditor] = useState<{
    kind: "inline" | "block";
    pos?: number;
  } | null>(null);
  const [latex, setLatex] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      Mathematics.configure({
        blockOptions: {
          onClick: (node, pos) => {
            setLatex(String(node.attrs.latex ?? ""));
            setMathEditor({ kind: "block", pos });
          },
        },
        inlineOptions: {
          onClick: (node, pos) => {
            setLatex(String(node.attrs.latex ?? ""));
            setMathEditor({ kind: "inline", pos });
          },
        },
        katexOptions: {
          throwOnError: false,
        },
      }),
    ],
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "richEditorSurface",
      },
    },
    immediatelyRender: false,
    onCreate: ({ editor: activeEditor }) => migrateMathStrings(activeEditor),
    onUpdate: ({ editor: activeEditor }) => onChange?.(activeEditor.getHTML()),
  });

  useEffect(() => {
    if (!editor || initialContent === undefined || editor.getHTML() === initialContent) return;
    editor.commands.setContent(initialContent, { emitUpdate: false });
  }, [editor, initialContent]);

  if (!editor) return null;

  function openMathEditor(kind: "inline" | "block") {
    setLatex("");
    setMathEditor({ kind });
  }

  function applyFormula() {
    if (!editor || !mathEditor || !latex.trim()) return;
    const chain = editor.chain().focus();
    if (mathEditor.kind === "inline") {
      if (mathEditor.pos === undefined) {
        chain.insertInlineMath({ latex: latex.trim() }).run();
      } else {
        chain.updateInlineMath({
          latex: latex.trim(),
          pos: mathEditor.pos,
        }).run();
      }
    } else if (mathEditor.pos === undefined) {
      chain.insertBlockMath({ latex: latex.trim() }).run();
    } else {
      chain.updateBlockMath({
        latex: latex.trim(),
        pos: mathEditor.pos,
      }).run();
    }
    setLatex("");
    setMathEditor(null);
  }

  const toolbarButton = (
    label: string,
    icon: ReactNode,
    command: () => void,
    selected = false,
    disabled = false,
  ) => (
    <IconButton disabled={disabled} label={label} onClick={command} selected={selected}>
      {icon}
    </IconButton>
  );

  return (
    <section className="editorFrame" aria-label="Rich note editor">
      <div className="editorCanvas">
        <EditorContent editor={editor} />
      </div>
      <div className="editorToolbar" aria-label="Editor toolbar">
        <div className="editorToolGroup">
          {toolbarButton("Undo", <Undo2 size={16} />, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
          {toolbarButton("Redo", <Redo2 size={16} />, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
        </div>
        <div className="editorToolGroup">
          {toolbarButton("Heading", <Heading2 size={16} />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
          {toolbarButton("Bold", <Bold size={16} />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
          {toolbarButton("Italic", <Italic size={16} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
          {toolbarButton("Strike", <Strikethrough size={16} />, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
          {toolbarButton("Code", <Code2 size={16} />, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
        </div>
        <div className="editorToolGroup highlightSwatches" aria-label="Highlight color">
          {[
            ["#fff3a8", "Yellow highlight"],
            ["#dff4d9", "Green highlight"],
            ["#dff0ff", "Blue highlight"],
          ].map(([color, label]) => (
            <button
              aria-label={label}
              className="highlightSwatch"
              key={color}
              onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
              style={{ backgroundColor: color }}
              title={label}
              type="button"
            />
          ))}
        </div>
        <div className="editorToolGroup">
          {toolbarButton("Quote", <Quote size={16} />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
          {toolbarButton("Bullet list", <List size={16} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
          {toolbarButton("Numbered list", <ListOrdered size={16} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
          {toolbarButton("Task list", <ListTodo size={16} />, () => editor.chain().focus().toggleTaskList().run(), editor.isActive("taskList"))}
        </div>
        <div className="editorToolGroup">
          {toolbarButton(
            "Inline formula",
            <Sigma size={16} />,
            () => openMathEditor("inline"),
            editor.isActive("inlineMath"),
          )}
          {toolbarButton(
            "Block formula",
            <span className="blockMathIcon">∑</span>,
            () => openMathEditor("block"),
            editor.isActive("blockMath"),
          )}
        </div>
      </div>
      {mathEditor ? (
        <div className="formulaComposer">
          <label>
            <span>
              {mathEditor.pos === undefined ? "Insert" : "Edit"}{" "}
              {mathEditor.kind} formula
            </span>
            <input
              autoFocus
              onChange={(event) => setLatex(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyFormula();
                }
                if (event.key === "Escape") setMathEditor(null);
              }}
              placeholder={mathEditor.kind === "inline" ? "V^\\pi(s)" : "\\sum_t \\gamma^t r_t"}
              value={latex}
            />
          </label>
          <button
            disabled={!latex.trim()}
            onClick={applyFormula}
            type="button"
          >
            Apply
          </button>
          <button onClick={() => setMathEditor(null)} type="button">
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
}
