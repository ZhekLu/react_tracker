import { CircleHelp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownMath } from "../../components/content/MarkdownMath";

type QuestionDialogProps = {
  contextLabel: string;
  initialText?: string;
  onClose: () => void;
  onSubmit: (input: {
    markdown: string;
    priority: "low" | "normal" | "high";
  }) => void;
};

export function QuestionDialog({
  contextLabel,
  initialText = "",
  onClose,
  onSubmit,
}: QuestionDialogProps) {
  const [markdown, setMarkdown] = useState(initialText);
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function submit() {
    if (!markdown.trim()) return;
    onSubmit({ markdown: markdown.trim(), priority });
  }

  return (
    <div className="questionDialogBackdrop" role="presentation">
      <section
        aria-labelledby="question-dialog-title"
        aria-modal="true"
        className="questionDialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">Structured question</p>
            <h2 id="question-dialog-title">Ask about {contextLabel}</h2>
          </div>
          <button aria-label="Close question dialog" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <p>
          Markdown and LaTeX are preserved. Use <code>$...$</code> inline or{" "}
          <code>$$...$$</code> for a displayed formula.
        </p>
        <textarea
          onChange={(event) => setMarkdown(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") onClose();
          }}
          placeholder="What exactly is unclear, and what would count as an answer?"
          ref={textareaRef}
          rows={7}
          value={markdown}
        />
        {markdown.trim() ? (
          <MarkdownMath className="questionFormulaPreview">
            {markdown}
          </MarkdownMath>
        ) : null}
        <footer>
          <label>
            <span>Priority</span>
            <select
              onChange={(event) =>
                setPriority(
                  event.target.value as "low" | "normal" | "high",
                )
              }
              value={priority}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
          <button className="commandButton subtle" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="commandButton"
            disabled={!markdown.trim()}
            onClick={submit}
            type="button"
          >
            <CircleHelp size={15} />
            Save question
          </button>
        </footer>
      </section>
    </div>
  );
}
