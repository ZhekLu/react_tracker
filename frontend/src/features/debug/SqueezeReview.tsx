import { useEffect, useRef, useState } from "react";
import { DiscussionMarkdownSurface } from "../../components/editor/DiscussionMarkdownSurface";
import { canonicalizePastedMarkdown } from "../../lib/discussionImport";
import { debugRequest } from "../../lib/insertDebug";
import { canAttachUnit, canJoinUnit, createSqueezeDraft, decideSqueeze, renderSqueezeUnits, type SqueezeDraft } from "../../lib/squeezeMarkdown";
import "./squeeze-review.css";

type Summary = {id: string; title: string; source: string; raw_length: number};
type Review = Summary & {raw: string; state: SqueezeDraft | null; revision: number};
function download(value: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], {type}));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function recovery(record: Review): SqueezeDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(`tracker:squeeze:${record.id}`) ?? "null");
    if (saved?.revision === record.revision && Array.isArray(saved.draft?.units)) return saved.draft;
  } catch { /* Server copy remains available. */ }
  return record.state ?? createSqueezeDraft(canonicalizePastedMarkdown(record.raw));
}

export function SqueezeReview({courseId}: {courseId: string}) {
  const [records, setRecords] = useState<Summary[]>([]);
  const [record, setRecord] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const query = `?${new URLSearchParams({course_id: courseId})}`;
  useEffect(() => {
    let active = true;
    void (async () => {
      let list = await debugRequest<Summary[]>(`/squeeze-reviews${query}`);
      if (!list.length) list = await debugRequest<Summary[]>(`/squeeze-reviews/load-recent${query}`, {method: "POST"});
      let preferred: string | null = null;
      try {preferred = localStorage.getItem(`tracker:squeeze-response:${courseId}`);}
      catch { /* Open the newest example when browser preferences are unavailable. */ }
      const selected = list.find(item => item.id === preferred) ?? list[0];
      const first = selected ? await debugRequest<Review>(`/squeeze-reviews/${selected.id}`) : null;
      if (active) {setRecords(list); setRecord(first);}
    })().catch(reason => {if (active) setError(String(reason));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [query, courseId]);
  const recordId = record?.id;
  useEffect(() => {
    if (recordId) {
      try {localStorage.setItem(`tracker:squeeze-response:${courseId}`, recordId);}
      catch { /* This preference is independent of server-saved decisions. */ }
    }
  }, [courseId, recordId]);
  async function select(id: string) {
    if (busy || loading || id === record?.id) return;
    setLoading(true); setError("");
    try {setRecord(await debugRequest<Review>(`/squeeze-reviews/${id}`));}
    catch (reason) {setError(String(reason));}
    finally {setLoading(false);}
  }
  async function loadRecent() {
    setLoading(true); setError("");
    try {
      const list = await debugRequest<Summary[]>(`/squeeze-reviews/load-recent${query}`, {method: "POST"});
      setRecords(list);
      if (!record && list[0]) setRecord(await debugRequest<Review>(`/squeeze-reviews/${list[0].id}`));
      if (!list.length) setError("No retained raw pastes for this course. Add a historical response below.");
    } catch (reason) {setError(String(reason));}
    finally {setLoading(false);}
  }
  async function add() {
    setLoading(true); setError("");
    try {
      const added = await debugRequest<Review>("/squeeze-reviews", {method: "POST", body: JSON.stringify({course_id: courseId, title: title.trim() || "Historical tutor response", raw})});
      setRecords(await debugRequest<Summary[]>(`/squeeze-reviews${query}`));
      setRecord(added); setRaw(""); setTitle("");
    } catch (reason) {setError(String(reason));}
    finally {setLoading(false);}
  }
  async function exportAll() {
    try {download(JSON.stringify(await debugRequest(`/squeeze-reviews/export${query}`), null, 2), "squeeze-review-corpus.json", "application/json");}
    catch (reason) {setError(String(reason));}
  }
  const index = records.findIndex(item => item.id === record?.id);
  return <section className="squeezeReview">
    <header><div><h1>Squeeze review</h1><p>Review real tutor responses, one fragment at a time. Corrections become examples for improving the parser.</p></div>
      <button className="commandButton subtle" disabled={busy || loading} onClick={() => void loadRecent()}>Load recent raw pastes</button>
      <button className="commandButton subtle" disabled={busy || loading || !records.length} onClick={() => void exportAll()}>Export all decisions</button>
    </header>
    <p className="squeezeNotice">Review copies and decisions stay on this computer with no automatic expiry. Raw paste logs expire after seven days; these selected examples are retained separately. Export JSON to keep the original, suggestions and labels together.</p>
    {error && <p role="alert">{error}</p>}
    <div className="squeezeResponseNav">
      <button className="commandButton subtle" disabled={busy || loading || index <= 0} onClick={() => void select(records[index - 1].id)}>← Previous response</button>
      <label>Response <select aria-label="Review response" disabled={busy || loading} value={record?.id ?? ""} onChange={event => void select(event.target.value)}>
        {!records.length && <option value="">No saved examples</option>}
        {records.map(item => <option key={item.id} value={item.id}>{item.title} · {item.raw_length.toLocaleString()} characters</option>)}
      </select></label>
      <button className="commandButton subtle" disabled={busy || loading || index < 0 || index >= records.length - 1} onClick={() => void select(records[index + 1].id)}>Next response →</button>
    </div>
    {loading && <p role="status">Loading response…</p>}
    {record && <ResponseReview key={record.id} record={record} onBusyChange={setBusy}
      onNavigate={direction => {const next = records[index + direction]; if (next) void select(next.id);}}/>}
    <details className="squeezeAdd"><summary>Add a historical raw response</summary>
      <label>Title<input aria-label="Response title" value={title} maxLength={160} onChange={event => setTitle(event.target.value)}/></label>
      <label>Original response<textarea aria-label="Historical raw response" value={raw} maxLength={250000} rows={8} spellCheck={false} onChange={event => setRaw(event.target.value)}/></label>
      <button className="commandButton" disabled={busy || loading || !raw.trim()} onClick={() => void add()}>Parse & review response</button>
    </details>
  </section>;
}

function ResponseReview({record, onBusyChange, onNavigate}: {record: Review; onBusyChange: (busy: boolean) => void; onNavigate: (direction: number) => void}) {
  const [draft, setDraft] = useState(() => recovery(record));
  const [selected, setSelected] = useState(() => {
    try {return Math.max(0, Math.min(draft.units.length - 1, Number(localStorage.getItem(`tracker:squeeze-cursor:${record.id}`)) || 0));}
    catch {return 0;}
  });
  const [edit, setEdit] = useState<string | null>(null);
  const [undo, setUndo] = useState<SqueezeDraft[]>([]);
  const [revision, setRevision] = useState(record.revision);
  const [saved, setSaved] = useState(JSON.stringify(record.state));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef(draft);
  const signature = JSON.stringify(draft);
  const dirty = signature !== saved;
  const output = renderSqueezeUnits(draft.units);
  const unit = draft.units[selected];
  useEffect(() => {onBusyChange(dirty || saving || edit !== null);}, [dirty, saving, edit, onBusyChange]);
  useEffect(() => {
    if (!dirty || saving || saveError) return;
    const timer = setTimeout(() => {
      setSaving(true);
      void debugRequest<Review>(`/squeeze-reviews/${record.id}`, {method: "PUT", body: JSON.stringify({revision, state: draft, markdown: output})})
        .then(result => {
          setRevision(result.revision); setSaved(signature);
          try {
            if (JSON.stringify(latest.current) === signature) localStorage.removeItem(`tracker:squeeze:${record.id}`);
            else localStorage.setItem(`tracker:squeeze:${record.id}`, JSON.stringify({revision: result.revision, draft: latest.current}));
          } catch {setStorageError(true);}
        }).catch(reason => setSaveError(String(reason))).finally(() => setSaving(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [dirty, saving, saveError, record.id, revision, draft, output, signature]);
  useEffect(() => {
    try {localStorage.setItem(`tracker:squeeze-cursor:${record.id}`, String(selected));}
    catch { /* Selection recovery is optional; decision recovery reports errors separately. */ }
    const list = panel.current?.querySelector<HTMLElement>(".squeezeFragments");
    const row = panel.current?.querySelector<HTMLElement>(`[data-unit="${selected}"]`);
    if (!list || !row) return;
    const bounds = list.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, [selected, record.id]);
  function update(next: SqueezeDraft) {
    if (next === draft) return;
    setUndo(items => [...items.slice(-49), draft]);
    latest.current = next; setDraft(next);
    try {localStorage.setItem(`tracker:squeeze:${record.id}`, JSON.stringify({revision, draft: next}));}
    catch {setStorageError(true);}
  }
  function decide(command: Parameters<typeof decideSqueeze>[2]) {update(decideSqueeze(draft, selected, command));}
  function restore() {
    const previous = undo.at(-1);
    if (!previous) return;
    const changed = draft.units.findIndex((item, index) => JSON.stringify(item) !== JSON.stringify(previous.units[index]));
    const at = changed >= 0 ? changed : selected;
    const before = draft.units[at];
    const after = previous.units[at];
    const restored = {...previous, actions: [...draft.actions, {command: "undo", unitId: before?.id ?? "", at: new Date().toISOString(),
      before: {text: before?.text ?? "", layout: before?.layout ?? "block", join: before?.join ?? false},
      after: {text: after?.text ?? "", layout: after?.layout ?? "block", join: after?.join ?? false}, previous: previous.units[at - 1]?.text ?? ""}]};
    latest.current = restored; setDraft(restored); setUndo(items => items.slice(0, -1));
    setSelected(at);
    try {localStorage.setItem(`tracker:squeeze:${record.id}`, JSON.stringify({revision, draft: restored}));}
    catch {setStorageError(true);}
  }
  let start = selected;
  while (start > 0 && draft.units[start].join && canJoinUnit(draft.units, start)) start--;
  let end = selected + 1;
  while (end < draft.units.length && draft.units[end].join && canJoinUnit(draft.units, end)) end++;
  const previous = draft.units[start - 1];
  const following = draft.units[end];
  const context = draft.units.slice(previous?.kind === "paragraph" && previous.text.length < 500 ? start - 1 : start,
    following?.kind === "paragraph" && following.text.length < 500 ? end + 1 : end);
  const reviewed = draft.units.filter(item => item.reviewedJoin || item.reviewedLayout).length;
  return <div ref={panel} className="squeezeWorkbench" tabIndex={0} aria-label="Squeeze keyboard review" onKeyDown={event => {
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]") || edit !== null || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {if (key === "z") {event.preventDefault(); restore();} return;}
    const command = ({w: "join", s: "separate", a: "inline", d: "block"} as const)[key as "w" | "s" | "a" | "d"];
    if (command) {event.preventDefault(); decide(command);}
    else if (["arrowup", "arrowdown"].includes(key)) {event.preventDefault(); setSelected(value => Math.max(0, Math.min(draft.units.length - 1, value + (key === "arrowdown" ? 1 : -1))));}
    else if (["arrowleft", "arrowright"].includes(key) && !dirty && !saving) {event.preventDefault(); onNavigate(key === "arrowright" ? 1 : -1);}
    else if (key === "enter" && event.target === panel.current) {event.preventDefault(); decide("accept"); setSelected(value => Math.min(draft.units.length - 1, value + 1));}
  }}>
    <div className="squeezeKeyGuide"><span><kbd>↑</kbd><kbd>↓</kbd> fragment · <kbd>←</kbd><kbd>→</kbd> response</span>
      <span><kbd>W</kbd> join previous · <kbd>S</kbd> separate · <kbd>A</kbd> inline · <kbd>D</kbd> block · <kbd>Enter</kbd> accept & next · <kbd>Ctrl/⌘ Z</kbd> undo</span></div>
    <div className="squeezeStatus"><span>{reviewed} / {draft.units.length} fragments reviewed · {draft.actions.length} decisions</span>
      <span role="status">{saveError ? "Save failed — draft kept here" : saving || dirty ? "Saving decisions…" : "All decisions saved"}</span>
      <button className="commandButton subtle" onClick={() => download(JSON.stringify({...record, state: draft, markdown: output}, null, 2), "squeeze-review-draft.json", "application/json")}>Export this draft</button>
      <button className="commandButton subtle" onClick={() => download(output, "reviewed-response.md", "text/markdown")}>Download Markdown</button>
    </div>
    {saveError && <p role="alert">{saveError} <button className="commandButton" onClick={() => setSaveError("")}>Retry save</button></p>}
    {storageError && <p role="alert">Browser recovery storage is unavailable. Export your draft if the server save fails.</p>}
    <div className="squeezeColumns">
      <section className="squeezeFragments" aria-label="Response fragments">{draft.units.map((item, index) => <button type="button" key={item.id} data-unit={index}
        className={`squeezeFragment ${index === selected ? "selected" : ""}`} aria-pressed={index === selected} disabled={edit !== null}
        onClick={() => {setSelected(index); panel.current?.focus({preventScroll: true});}}>
        <span className="squeezeFragmentMeta">{index + 1} · {item.kind} · {["math", "text"].includes(item.kind) ? `${item.layout} · ` : ""}{item.join ? "joined" : "separate"} {item.reviewedJoin || item.reviewedLayout ? "· reviewed" : "· auto"}</span>
        <span className="squeezeFragmentSource">{item.text}</span>
      </button>)}</section>
      <section className="squeezeDetail" aria-label="Selected fragment review">
        {unit && <><h2>Fragment {selected + 1} · {unit.kind}</h2><p>Parser suggestion: {unit.reason}</p>
          <div className="squeezeCommands">
            <button className="commandButton" disabled={edit !== null || !canAttachUnit(draft.units, selected)} onClick={() => decide("join")}>W · Join previous</button>
            <button className="commandButton" disabled={edit !== null || !selected} onClick={() => decide("separate")}>S · Separate</button>
            <button className="commandButton" disabled={edit !== null || !["math", "text"].includes(unit.kind)} onClick={() => decide("inline")}>A · Inline</button>
            <button className="commandButton" disabled={edit !== null || !["math", "text"].includes(unit.kind)} onClick={() => decide("block")}>D · Block</button>
            <button className="commandButton subtle" disabled={edit !== null} onClick={() => {decide("accept"); setSelected(value => Math.min(draft.units.length - 1, value + 1)); panel.current?.focus();}}>Accept & next</button>
            <button className="commandButton subtle" disabled={edit !== null || !undo.length} onClick={restore}>Undo decision</button>
            <button className="commandButton subtle" disabled={edit !== null} onClick={() => setEdit(unit.text)}>Edit fragment</button>
          </div>
          {edit !== null && <div className="squeezeEdit"><textarea aria-label="Edit selected fragment" rows={8} spellCheck={false} value={edit} onChange={event => setEdit(event.target.value)}/>
            <button className="commandButton" disabled={!edit.trim()} onClick={() => {update(decideSqueeze(draft, selected, "edit", edit)); setEdit(null); panel.current?.focus();}}>Apply edit</button>
            <button className="commandButton subtle" onClick={() => setEdit(null)}>Cancel edit</button></div>}
          <h3>Live paragraph context</h3><div className="squeezePreview"><DiscussionMarkdownSurface markdown={renderSqueezeUnits(context)}/></div>
          <details><summary>Original fragment</summary><pre>{unit.source}</pre></details>
        </>}
      </section>
    </div>
    <details className="squeezeFull"><summary>Full reviewed response</summary><FullPreview markdown={output}/></details>
    <details className="squeezeFull"><summary>Original raw paste</summary><pre>{record.raw}</pre></details>
  </div>;
}

function FullPreview({markdown}: {markdown: string}) {
  const [open, setOpen] = useState(false);
  return open ? <DiscussionMarkdownSurface markdown={markdown}/> : <button className="commandButton subtle" onClick={() => setOpen(true)}>Render full response</button>;
}
