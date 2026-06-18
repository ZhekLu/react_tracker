import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code2, Heading2, Highlighter, Italic, ListTodo, Quote } from "lucide-react";

type RichNoteEditorProps = {
  initialContent?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
};

export function RichNoteEditor({ initialContent, placeholder = "Write notes, questions, or GPT follow-ups...", onChange }: RichNoteEditorProps) {
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
    ],
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "richEditorSurface",
      },
    },
    onUpdate: ({ editor: activeEditor }) => onChange?.(activeEditor.getHTML()),
  });

  if (!editor) return null;

  return (
    <section className="editorFrame" aria-label="Rich note editor">
      <div className="editorToolbar" aria-label="Editor toolbar">
        <button className={editor.isActive("heading", { level: 2 }) ? "toolButton active" : "toolButton"} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading">
          <Heading2 size={17} />
        </button>
        <button className={editor.isActive("bold") ? "toolButton active" : "toolButton"} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <Bold size={17} />
        </button>
        <button className={editor.isActive("italic") ? "toolButton active" : "toolButton"} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <Italic size={17} />
        </button>
        <button className={editor.isActive("highlight") ? "toolButton active" : "toolButton"} onClick={() => editor.chain().focus().toggleHighlight({ color: "#fff3a8" }).run()} title="Highlight">
          <Highlighter size={17} />
        </button>
        <button className={editor.isActive("blockquote") ? "toolButton active" : "toolButton"} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
          <Quote size={17} />
        </button>
        <button className={editor.isActive("code") ? "toolButton active" : "toolButton"} onClick={() => editor.chain().focus().toggleCode().run()} title="Code">
          <Code2 size={17} />
        </button>
        <button className={editor.isActive("taskList") ? "toolButton active" : "toolButton"} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Task list">
          <ListTodo size={17} />
        </button>
      </div>
      <EditorContent editor={editor} />
    </section>
  );
}
