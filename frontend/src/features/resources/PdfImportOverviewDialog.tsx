import { CircleHelp, FilePenLine, Highlighter, X } from "lucide-react";
import type { PdfAnnotationCollectionItem } from "../../api/trackerApi";
import type { StudyDay } from "../../types/tracker";

type PdfImportOverviewDialogProps = {
  days: StudyDay[];
  items: PdfAnnotationCollectionItem[];
  onClose: () => void;
  resourceTitle: string;
};

function itemIcon(kind: PdfAnnotationCollectionItem["kind"]) {
  if (kind === "question" || kind === "todo") return CircleHelp;
  if (kind === "highlight") return Highlighter;
  return FilePenLine;
}

export function PdfImportOverviewDialog({
  days,
  items,
  onClose,
  resourceTitle,
}: PdfImportOverviewDialogProps) {
  const dayById = new Map(days.map((day) => [day.id, day]));
  const groups = [...items.reduce((result, item) => {
    const key = item.sourceDayId ?? "unmapped";
    const current = result.get(key) ?? [];
    current.push(item);
    result.set(key, current);
    return result;
  }, new Map<string, PdfAnnotationCollectionItem[]>()).entries()];

  return (
    <div className="questionDialogBackdrop" role="presentation">
      <section aria-modal="true" className="questionDialog pdfImportOverview" role="dialog">
        <header>
          <div>
            <p className="eyebrow">PDF collection overview</p>
            <h2>{items.length} changed capture{items.length === 1 ? "" : "s"}</h2>
            <small>{resourceTitle}</small>
          </div>
          <button aria-label="Close import overview" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="pdfImportOverviewGroups">
          {groups.map(([dayId, group]) => {
            const day = dayById.get(dayId);
            return (
              <section key={dayId}>
                <header>
                  <strong>{day ? `Day ${day.number} · ${day.topic || day.title}` : "Not mapped to a study day"}</strong>
                  <span>{group.length}</span>
                </header>
                {group.map((item, index) => {
                  const Icon = itemIcon(item.kind);
                  return (
                    <article key={`${item.kind}:${item.page}:${index}`}>
                      <Icon size={14} />
                      <div>
                        <strong>{item.kind} · {item.outcome}</strong>
                        <span>{[item.page ? `p. ${item.page}` : "", item.sectionTitle].filter(Boolean).join(" · ")}</span>
                        <p>{item.text || "Screenshot"}</p>
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
        <footer><button className="commandButton" onClick={onClose} type="button">Done</button></footer>
      </section>
    </div>
  );
}
