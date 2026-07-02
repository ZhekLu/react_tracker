import {
  CircleHelp,
  Flag,
  Highlighter,
  NotebookPen,
  Save,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AnnotationKind } from "../../types/tracker";

export type ResourceCaptureInput = {
  color?: string;
  kind: AnnotationKind;
  markdown: string;
  priority: "low" | "normal" | "high";
};

type InlineCaptureEditorProps = {
  onCancel: () => void;
  onSubmit: (input: ResourceCaptureInput) => void;
  resourceTitle: string;
};

const captureTypes: {
  icon: typeof CircleHelp;
  kind: AnnotationKind;
  label: string;
}[] = [
  { icon: NotebookPen, kind: "note", label: "Note" },
  { icon: CircleHelp, kind: "question", label: "Question" },
  { icon: Highlighter, kind: "highlight", label: "Highlight" },
  { icon: Flag, kind: "todo", label: "To do" },
];

export function InlineCaptureEditor({
  onCancel,
  onSubmit,
  resourceTitle,
}: InlineCaptureEditorProps) {
  const [kind, setKind] = useState<AnnotationKind>("note");
  const [markdown, setMarkdown] = useState("");
  const [priority, setPriority] =
    useState<ResourceCaptureInput["priority"]>("normal");
  const [color, setColor] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prioritized = kind === "question" || kind === "todo";

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function submit() {
    const value = markdown.trim();
    if (!value) return;
    onSubmit({
      color: color || undefined,
      kind,
      markdown: value,
      priority,
    });
  }

  return (
    <section className="inlineCaptureEditor">
      <header>
        <div>
          <span className="eyebrow">Resource capture</span>
          <strong>{resourceTitle}</strong>
        </div>
        <button
          aria-label="Close capture editor"
          className="captureIconButton"
          onClick={onCancel}
          type="button"
        >
          <X size={14} />
        </button>
      </header>
      <div className="captureTypePicker" aria-label="Capture type">
        {captureTypes.map(({ icon: Icon, kind: option, label }) => (
          <button
            className={kind === option ? `active kind-${option}` : ""}
            key={option}
            onClick={() => setKind(option)}
            type="button"
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      <textarea
        aria-label={`Write a ${kind} for ${resourceTitle}`}
        onChange={(event) => setMarkdown(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") onCancel();
        }}
        placeholder={
          kind === "question"
            ? "What is unclear, and what would count as an answer?"
            : kind === "todo"
              ? "What should you return to?"
              : "Write the idea while it is fresh…"
        }
        ref={textareaRef}
        rows={4}
        value={markdown}
      />
      <footer>
        <label>
          <span>Colour</span>
          <select
            onChange={(event) => setColor(event.target.value)}
            value={color}
          >
            <option value="">None</option>
            <option value="yellow">Yellow</option>
            <option value="red">Red</option>
            <option value="cyan">Cyan</option>
            <option value="green">Green</option>
            <option value="blue">Blue</option>
          </select>
        </label>
        {prioritized ? (
          <label>
            <span>Priority</span>
            <select
              onChange={(event) =>
                setPriority(
                  event.target.value as ResourceCaptureInput["priority"],
                )
              }
              value={priority}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
        ) : null}
        <button
          className="commandButton"
          disabled={!markdown.trim()}
          onClick={submit}
          type="button"
        >
          <Save size={14} />
          Save {kind}
        </button>
      </footer>
    </section>
  );
}
