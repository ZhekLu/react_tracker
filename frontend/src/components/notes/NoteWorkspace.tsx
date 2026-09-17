import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Maximize2, Minimize2, Pencil } from "lucide-react";
import "./note-workspace.css";

type Heading = { text: string; level: number };
const fontKey = "tracker.noteFontSize";

/** One scroll surface for reading instructions and writing underneath them. */
export function NoteWorkspace({ children, editing, onEdit }: {
  children: ReactNode;
  editing: boolean;
  onEdit: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(fontKey));
      return saved >= 16 && saved <= 22 ? saved : 18;
    } catch { return 18; }
  });

  useEffect(() => {
    const root = content.current;
    if (!root) return;
    let frame = 0;
    function update() {
      const next = [...root!.querySelectorAll(".discussionRichSurface :is(h1,h2,h3,h4,h5,h6)")]
        .map((element) => ({ text: element.textContent?.trim() || "Untitled heading", level: Number(element.tagName[1]) }));
      setHeadings((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  function resize(next: number) {
    setFontSize(next);
    try { localStorage.setItem(fontKey, String(next)); } catch { /* Local preference is optional. */ }
  }

  function jump(index: number) {
    const root = content.current;
    const heading = root?.querySelectorAll<HTMLElement>(".discussionRichSurface :is(h1,h2,h3,h4,h5,h6)")[index];
    if (!root || !heading) return;
    root.scrollTo({ top: root.scrollTop + heading.getBoundingClientRect().top - root.getBoundingClientRect().top - 70 });
    // Focus the heading without moving the editor selection or changing the note.
    if (!editing) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }

  return (
    <section className={`noteWorkspace${expanded ? " expanded" : ""}`} style={{ "--note-font-size": `${fontSize}px` } as CSSProperties}>
      <div className="noteWorkspaceTools">
        <span className="noteWorkspaceMode">{editing ? "Writing" : "Reading"}</span>
        {!editing && <button className="commandButton" onClick={onEdit} type="button"><Pencil size={14} /> Edit note</button>}
        <div className="noteTextSize" role="group" aria-label="Note text size">
          <button aria-label="Smaller note text" disabled={fontSize <= 16} onClick={() => resize(fontSize - 1)} type="button">A−</button>
          <output aria-label="Note font size">{fontSize}</output>
          <button aria-label="Larger note text" disabled={fontSize >= 22} onClick={() => resize(fontSize + 1)} type="button">A+</button>
        </div>
        <button aria-pressed={expanded} className="commandButton subtle" onClick={() => setExpanded((value) => !value)} type="button">
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {expanded ? "Compact" : "More space"}
        </button>
      </div>
      {headings.length > 1 && <label className="noteHeadingNavigation">
        <span>Jump to</span>
        <select aria-label="Jump to note heading" value="" onChange={(event) => jump(Number(event.target.value))}>
          <option value="" disabled>Choose a task or heading…</option>
          {headings.map((heading, index) => <option key={index} value={index}>{`${"　".repeat(Math.max(0, heading.level - 2))}${heading.text}`}</option>)}
        </select>
      </label>}
      <div className="noteWorkspaceContent" ref={content}>{children}</div>
    </section>
  );
}
