import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, X } from "lucide-react";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { importWithDebug } from "../../lib/insertDebug";
import { taskReviewParts, type TaskReviewPart } from "../../lib/taskReview";
import type { Annotation, Discussion, Task } from "../../types/tracker";

export function TaskTutorReviewDialog({task, discussion, annotations, onClose, onImport}: {
  task: Task; discussion?: Discussion; annotations: Annotation[]; onClose: () => void;
  onImport: (review: string, answers: TaskReviewPart[], importId: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const importId = useRef(crypto.randomUUID());
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea, input:not(:disabled), summary, [tabindex="0"]',
      ) ?? [])].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("keydown", keyboard, true); previousFocus?.focus(); };
  }, [busy, onClose]);
  const parts = useMemo(() => taskReviewParts(source ?? "", discussion, annotations), [source, discussion, annotations]);
  const review = parts.filter(p => selected.has(p.id)).map(p => p.markdown).join("\n\n");
  const answers = parts.filter(p => !selected.has(p.id));
  const unmapped = answers.some(p => !p.questionIds.length || p.labels.some(label =>
    !discussion?.questionLabels.some(q => q.label === label) && !annotations.some(a => a.anchor?.metadata?.promptLabel === label)));

  function preview() {
    const markdown = importWithDebug(text);
    if (!markdown.trim()) { setError("Paste the tutor response first."); return; }
    const parsed = taskReviewParts(markdown, discussion, annotations);
    setSelected(new Set(parsed.filter(p => !p.questionIds.length).map(p => p.id)));
    setSource(markdown); setError(""); importId.current = crypto.randomUUID();
  }
  async function submit() {
    setBusy(true); setError("");
    try { await onImport(review, answers, importId.current); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed. Your pasted text is still here."); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="taskTutorBackdrop">
    <section aria-label="Insert task tutor review" aria-modal="true" className="taskTutorDialog" ref={dialogRef} role="dialog">
      <header><div><small>Task tutor review</small><h2>{task.title}</h2></div>
        <button aria-label="Close task review import" disabled={busy} onClick={onClose} type="button"><X size={20}/></button></header>
      {source === null ? <>
        <p>Paste the full response. The next step separates your task review from labelled question answers.</p>
        <button className="commandButton subtle" onClick={async () => {
          try { setText(await navigator.clipboard.readText()); setError(""); }
          catch { setError("Clipboard access failed. Paste into the field below."); }
        }} type="button"><ClipboardPaste size={14}/> Paste from clipboard</button>
        <textarea autoFocus aria-label="Tutor response" onChange={e => setText(e.target.value)} placeholder="Paste tutor feedback, including any Q-… headings" value={text}/>
      </> : <>
        <p>Checked sections are appended to the task note. Unchecked sections become answers to their labelled questions. Every section is kept.</p>
        <div className="taskTutorParts">{parts.map(part => <label key={part.id}>
          <input checked={selected.has(part.id)} disabled={busy} onChange={() => setSelected(current => {
            const next = new Set(current); if (next.has(part.id)) next.delete(part.id); else next.add(part.id); return next;
          })} type="checkbox"/>
          <span>{part.title}<small>{selected.has(part.id) ? "Task review" : part.questionIds.length ? `${part.labels.join(", ")} · mapped answer` : "No matching question — include in task review"}</small></span>
        </label>)}</div>
        <details open><summary>Task note append preview</summary><div className="taskTutorPreview"><MarkdownMath>{review || "Only question answers selected."}</MarkdownMath></div></details>
      </>}
      {error ? <p className="taskTutorError" role="alert">{error}</p> : null}
      <footer><button className="commandButton subtle" disabled={busy} onClick={() => source === null ? onClose() : setSource(null)} type="button">{source === null ? "Cancel" : "Back to paste"}</button>
        <button className="commandButton" disabled={busy || (source !== null && (unmapped || (!review && !answers.length)))} onClick={() => source === null ? preview() : void submit()} type="button">{busy ? "Importing…" : source === null ? "Preview import" : "Import and open Q&A"}</button></footer>
    </section>
  </div>, document.body);
}
