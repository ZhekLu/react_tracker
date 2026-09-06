import { useMemo, useState } from "react";
import { FileText, Image, X } from "lucide-react";

export type PromptQuestionChoice = {
  annotationIds: string[];
  attachmentCount: number;
  chapterLabel: string;
  key: string;
  label: string;
  locationLabel: string;
  summary: string;
};

type PromptQuestionSelectionDialogProps = {
  choices: PromptQuestionChoice[];
  onClose: () => void;
  onCopy: (keys: string[]) => void;
  resourceTitle: string;
};

export function PromptQuestionSelectionDialog({
  choices,
  onClose,
  onCopy,
  resourceTitle,
}: PromptQuestionSelectionDialogProps) {
  const firstTwenty = useMemo(
    () => choices.slice(0, 20).map((choice) => choice.key),
    [choices],
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(firstTwenty),
  );

  const selectedAttachmentCount = choices
    .filter((choice) => selectedKeys.has(choice.key))
    .reduce((total, choice) => total + choice.attachmentCount, 0);

  function replaceSelection(keys: string[]) {
    setSelectedKeys(new Set(keys));
  }

  return (
    <div className="questionDialogBackdrop" role="presentation">
      <section
        aria-labelledby="prompt-question-selection-title"
        aria-modal="true"
        className="questionDialog promptQuestionSelectionDialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">Question batch</p>
            <h2 id="prompt-question-selection-title">Choose questions to copy</h2>
            <p>
              {resourceTitle} has {choices.length} unanswered questions. The first
              20 are selected; change the selection or jump to all questions.
            </p>
          </div>
          <button aria-label="Close question selection" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="promptQuestionSelectionActions">
          <button
            className="commandButton subtle"
            onClick={() => replaceSelection(firstTwenty)}
            type="button"
          >
            First 20
          </button>
          <button
            className="commandButton subtle"
            onClick={() => replaceSelection(choices.map((choice) => choice.key))}
            type="button"
          >
            Select all · {choices.length}
          </button>
          <button
            className="commandButton subtle"
            onClick={() => replaceSelection([])}
            type="button"
          >
            Clear
          </button>
          <span>
            {selectedKeys.size} selected · {selectedAttachmentCount} image
            {selectedAttachmentCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="promptQuestionSelectionList">
          {choices.map((choice) => {
            const selected = selectedKeys.has(choice.key);
            return (
              <label className={selected ? "selected" : ""} key={choice.key}>
                <input
                  checked={selected}
                  onChange={() => {
                    const next = new Set(selectedKeys);
                    if (selected) next.delete(choice.key);
                    else next.add(choice.key);
                    setSelectedKeys(next);
                  }}
                  type="checkbox"
                />
                <span className="promptQuestionSelectionCopy">
                  <strong>{choice.label}</strong>
                  <small>
                    {choice.chapterLabel}
                    {choice.locationLabel ? ` · ${choice.locationLabel}` : ""}
                  </small>
                  <span>{choice.summary}</span>
                </span>
                <span
                  className={
                    choice.attachmentCount
                      ? "promptQuestionAttachmentBadge hasAttachment"
                      : "promptQuestionAttachmentBadge"
                  }
                  title={
                    choice.attachmentCount
                      ? `${choice.attachmentCount} question image${choice.attachmentCount === 1 ? "" : "s"} will be prepared`
                      : "This question has no separate image attachment"
                  }
                >
                  {choice.attachmentCount ? <Image size={14} /> : <FileText size={14} />}
                  {choice.attachmentCount
                    ? `${choice.attachmentCount} image${choice.attachmentCount === 1 ? "" : "s"}`
                    : "text only"}
                </span>
              </label>
            );
          })}
        </div>

        <footer>
          <button className="commandButton subtle" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="commandButton"
            disabled={!selectedKeys.size}
            onClick={() =>
              onCopy(
                choices
                  .filter((choice) => selectedKeys.has(choice.key))
                  .map((choice) => choice.key),
              )
            }
            type="button"
          >
            Copy selected · {selectedKeys.size}
          </button>
        </footer>
      </section>
    </div>
  );
}
