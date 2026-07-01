import { Trash2, X } from "lucide-react";

type ConfirmDialogProps = {
  confirmLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
};

export function ConfirmDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  return (
    <div className="questionDialogBackdrop" role="presentation">
      <section
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="questionDialog confirmDialog"
        role="alertdialog"
      >
        <header>
          <div>
            <p className="eyebrow">Confirm deletion</p>
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button aria-label="Cancel deletion" onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>
        <p>{description}</p>
        <footer>
          <button className="commandButton subtle" onClick={onCancel} type="button">
            Keep discussion
          </button>
          <button className="commandButton danger" onClick={onConfirm} type="button">
            <Trash2 size={15} /> {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
