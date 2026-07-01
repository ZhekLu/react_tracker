import { Check, CircleHelp, ListChecks, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Candidate = {
  id: string;
  markdown: string;
  selected: boolean;
};

type QuestionExtractionDialogProps = {
  candidates: string[];
  contextLabel: string;
  onClose: () => void;
  onSubmit: (input: {
    priority: "low" | "normal" | "high";
    questions: string[];
  }) => void;
};

export function QuestionExtractionDialog({
  candidates,
  contextLabel,
  onClose,
  onSubmit,
}: QuestionExtractionDialogProps) {
  const [items, setItems] = useState<Candidate[]>(() =>
    (candidates.length ? candidates : [""]).map((markdown, index) => ({
      id: `candidate-${index}`,
      markdown,
      selected: true,
    })),
  );
  const [priority, setPriority] =
    useState<"low" | "normal" | "high">("normal");
  const firstInputRef = useRef<HTMLTextAreaElement>(null);
  const selectedQuestions = useMemo(
    () =>
      items
        .filter((item) => item.selected && item.markdown.trim())
        .map((item) => item.markdown.trim()),
    [items],
  );

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  function updateItem(id: string, changes: Partial<Candidate>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }

  return (
    <div className="questionDialogBackdrop" role="presentation">
      <section
        aria-labelledby="question-extraction-title"
        aria-modal="true"
        className="questionDialog extractionDialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">Tutor-response parser</p>
            <h2 id="question-extraction-title">
              Review questions from {contextLabel}
            </h2>
          </div>
          <button
            aria-label="Close extracted questions"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <p>
          Question-like bullets, explicit follow-ups, and sentences ending in a
          question mark were detected. Edit the wording and keep only useful
          items before saving.
        </p>
        <div className="extractionCandidateList">
          {items.map((item, index) => (
            <label
              className={item.selected ? "extractionCandidate selected" : "extractionCandidate"}
              key={item.id}
            >
              <input
                checked={item.selected}
                onChange={(event) =>
                  updateItem(item.id, { selected: event.target.checked })
                }
                type="checkbox"
              />
              <span>Q{index + 1}</span>
              <textarea
                onChange={(event) =>
                  updateItem(item.id, { markdown: event.target.value })
                }
                placeholder="Add or refine a question"
                ref={index === 0 ? firstInputRef : undefined}
                rows={2}
                value={item.markdown}
              />
            </label>
          ))}
        </div>
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
          <button
            className="commandButton subtle"
            onClick={() =>
              setItems((current) =>
                current.map((item) => ({ ...item, selected: true })),
              )
            }
            type="button"
          >
            <ListChecks size={14} /> Select all
          </button>
          <button className="commandButton subtle" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="commandButton"
            disabled={!selectedQuestions.length}
            onClick={() => onSubmit({ priority, questions: selectedQuestions })}
            type="button"
          >
            {selectedQuestions.length ? <Check size={15} /> : <CircleHelp size={15} />}
            Save {selectedQuestions.length} question
            {selectedQuestions.length === 1 ? "" : "s"}
          </button>
        </footer>
      </section>
    </div>
  );
}
