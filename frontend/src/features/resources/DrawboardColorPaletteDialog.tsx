import { CircleHelp, Highlighter, Palette, X } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  DrawboardColorPaletteEntry,
  DrawboardColorRole,
} from "../../api/trackerApi";

type DrawboardColorPaletteDialogProps = {
  entries: DrawboardColorPaletteEntry[];
  resourceTitle: string;
  onClose: () => void;
  onSave: (roles: Record<string, DrawboardColorRole>) => void;
};

function swatchColor(entry: DrawboardColorPaletteEntry) {
  const [red = 0, green = 0, blue = 0] = entry.rgb;
  return `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(
    blue * 255,
  )})`;
}

export function DrawboardColorPaletteDialog({
  entries,
  resourceTitle,
  onClose,
  onSave,
}: DrawboardColorPaletteDialogProps) {
  const initialRoles = useMemo(
    () =>
      Object.fromEntries(
        entries.map((entry) => [
          entry.key,
          entry.role ?? entry.suggestedRole,
        ]),
      ) as Record<string, DrawboardColorRole>,
    [entries],
  );
  const [roles, setRoles] = useState(initialRoles);
  const unknownCount = entries.filter((entry) => !entry.role).length;

  return (
    <div className="questionDialogBackdrop" role="presentation">
      <section
        aria-labelledby="drawboard-palette-title"
        aria-modal="true"
        className="questionDialog drawboardPaletteDialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">Drawboard colour roles</p>
            <h2 id="drawboard-palette-title">
              Which colours mean “question”?
            </h2>
          </div>
          <button aria-label="Close colour palette" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <p>
          Found {unknownCount} new colour{unknownCount === 1 ? "" : "s"} in{" "}
          <strong>{resourceTitle}</strong>. Assign each exact Drawboard colour once;
          the choice is reused for this course. Regular colours remain notes or
          highlights even when their quoted text ends in a question mark.
        </p>
        <div className="drawboardPaletteList">
          {entries.map((entry) => {
            const role = roles[entry.key];
            return (
              <article
                className={`drawboardPaletteItem ${
                  entry.role ? "isKnown" : "isNew"
                }`}
                key={entry.key}
              >
                <span
                  aria-hidden="true"
                  className="drawboardColorSwatch"
                  style={{ background: swatchColor(entry) }}
                />
                <div className="drawboardColorDetails">
                  <strong>{entry.key}</strong>
                  <span>
                    {entry.count} mark{entry.count === 1 ? "" : "s"} ·{" "}
                    {entry.annotationKinds.join(", ")}
                  </span>
                </div>
                <div className="drawboardRoleChoice" role="group">
                  <button
                    aria-pressed={role === "question"}
                    className={role === "question" ? "isActive question" : ""}
                    onClick={() =>
                      setRoles((current) => ({
                        ...current,
                        [entry.key]: "question",
                      }))
                    }
                    type="button"
                  >
                    <CircleHelp size={15} />
                    Question
                  </button>
                  <button
                    aria-pressed={role === "regular"}
                    className={role === "regular" ? "isActive regular" : ""}
                    onClick={() =>
                      setRoles((current) => ({
                        ...current,
                        [entry.key]: "regular",
                      }))
                    }
                    type="button"
                  >
                    <Highlighter size={15} />
                    Regular
                  </button>
                </div>
                <span className="drawboardRoleState">
                  {entry.role ? "Saved" : "New"}
                </span>
              </article>
            );
          })}
        </div>
        <footer>
          <span className="drawboardPaletteHint">
            <Palette size={15} /> Future new colours will open this palette again.
          </span>
          <button className="commandButton subtle" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="commandButton"
            disabled={entries.some((entry) => !roles[entry.key])}
            onClick={() => onSave(roles)}
            type="button"
          >
            Save roles &amp; collect
          </button>
        </footer>
      </section>
    </div>
  );
}
