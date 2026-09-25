import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, X } from "lucide-react";
import type { Course, StudyDay, Task } from "../../types/tracker";
import { noteText, taskSupportingNotes, taskTutorPrompt, type PromptPayload, type TaskTutorPromptOptions } from "../../lib/prompts";
import { originalTaskWork, taskNoteCopyParts } from "../../lib/taskReviewCopy";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import "./task-flow.css";

export function TaskPromptDialog({course, day, task, options, onClose, onCopy}: {
  course: Course; day: StudyDay; task: Task; options: TaskTutorPromptOptions;
  onClose: () => void; onCopy: (payload: PromptPayload) => Promise<boolean>;
}) {
  const note = noteText(task.notes.filter(note => note.kind === "task"));
  const original = useMemo(() => originalTaskWork(note), [note]);
  const [includeReviews, setIncludeReviews] = useState(false);
  const [includeInfo, setIncludeInfo] = useState(!original.markdown.trim());
  const [includeNotes, setIncludeNotes] = useState(Boolean(options.includeResourceNotes));
  const [title, setTitle] = useState(task.title);
  const parts = useMemo(() => taskNoteCopyParts(original.markdown), [original.markdown]);
  const [selected, setSelected] = useState(() => new Set(parts.map(part => part.id)));
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const noteCount = taskSupportingNotes(course, day, task).length;
  const selectedNote = parts.filter(part => selected.has(part.id)).map(part => part.markdown).join("\n\n");
  // Previous reviews are explicit context, never silently mixed into my attempt.
  const payload = taskTutorPrompt(course, day, task, {...options, includeTaskInfo: includeInfo,
    includeResourceNotes: includeNotes, reviewTitle: title,
    noteMarkdown: (customNote ?? selectedNote) + (includeReviews ? `\n\n## Previous tutor feedback (reference)\n\n${original.reviews.join("\n\n")}` : ""),
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  async function copy() {
    setBusy(true); setError("");
    try {
      if (await onCopy(payload)) onClose();
      else setError("The prompt could not be fully prepared. Your preview is still here; see the workspace message for details.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Copy failed. Your preview is still here."); }
    finally { setBusy(false); }
  }

  return createPortal(<dialog aria-label="Prepare task review" className="taskPromptDialog" ref={dialog}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><small>Day {day.number} · Send to tutor</small><h2>{task.title}</h2></div>
      <button aria-label="Close task prompt" disabled={busy} onClick={onClose} type="button"><X size={20}/></button></header>
    <div className="taskPromptLayout"><div className="taskPromptOptions">
      <label className="taskPromptTitle">Review heading<input aria-label="Review heading" value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/></label>
      <fieldset disabled={busy}><legend>What to share</legend>
        <label><input checked={includeInfo} onChange={e => setIncludeInfo(e.target.checked)} type="checkbox"/> Task instructions</label>
        <label><input checked={includeNotes} disabled={!noteCount} onChange={e => setIncludeNotes(e.target.checked)} type="checkbox"/> Resource notes & images ({noteCount})</label>
        {original.reviewCount ? <label><input checked={includeReviews} onChange={e => setIncludeReviews(e.target.checked)} type="checkbox"/> Previous tutor reviews ({original.reviewCount})</label> : null}
        <p>{payload.annotationIds?.length ?? 0} linked questions included with their stable IDs.</p>
      </fieldset>
      <fieldset disabled={busy || customNote !== null}><legend>Sections of my note</legend>
        {parts.length > 1 ? <div className="taskPromptPresets">
          <button onClick={() => setSelected(new Set(parts.map(p => p.id)))} type="button">Whole note</button>
          {parts.some(p => p.isMyWork) ? <button onClick={() => setSelected(new Set(parts.filter(p => p.isMyWork).map(p => p.id)))} type="button">My work sections</button> : null}
        </div> : null}
        {parts.map(part => <label key={part.id}><input checked={selected.has(part.id)} type="checkbox" onChange={() => setSelected(current => {
          const next = new Set(current); if (next.has(part.id)) next.delete(part.id); else next.add(part.id); return next;
        })}/>{part.title}</label>)}
        {!parts.length ? <p>No saved task note yet.</p> : <p>Keep the whole note when your answers follow each checklist item.</p>}
      </fieldset>
      <button className="commandButton subtle" disabled={busy} onClick={() => setCustomNote(customNote === null ? selectedNote : null)} type="button">
        {customNote === null ? "Edit this copy" : "Use saved sections"}
      </button>
      {customNote !== null ? <label className="taskPromptDraft">My work for this copy<textarea aria-label="My work for this copy" value={customNote} disabled={busy} onChange={e => setCustomNote(e.target.value)}/></label> : null}
      <small>Your saved note stays unchanged. Attachment files and their index are prepared when you copy.</small>
    </div><section className="taskPromptPreview"><header><strong>Prompt preview</strong><span>{payload.markdown.length.toLocaleString()} characters</span></header>
      <MarkdownMath>{payload.markdown}</MarkdownMath></section></div>
    {error ? <p className="taskTutorError" role="alert">{error}</p> : null}
    <footer><button className="commandButton subtle" disabled={busy} onClick={onClose} type="button">Cancel</button>
      <button className="commandButton" disabled={busy || !title.trim()} onClick={() => void copy()} type="button"><Copy size={14}/>{busy ? "Preparing…" : "Copy for tutor"}</button></footer>
  </dialog>, document.body);
}
