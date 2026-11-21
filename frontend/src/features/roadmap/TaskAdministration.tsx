import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, Copy, Download, History, Settings2, ShieldCheck, Trash2, X } from "lucide-react";
import { changeAdminTask, fetchPatchingGuide, fetchTaskAdministration } from "../../api/trackerApi";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { adminChanges, adminDayContext, type AdminChanges, type AdminCommand, type AdminOverview, type AdminTask } from "../../lib/taskAdmin";
import type { Course, Resource, TaskStatus } from "../../types/tracker";
import { CourseProgressExport } from "../progress/CourseProgressExport";
import "./task-administration.css";

const statusNames: Record<TaskStatus, string> = {
  todo: "To do", in_progress: "In progress", done: "Done", later: "Later", skipped: "Cancelled",
};
const fieldNames: Record<string, string> = {
  title: "Title", status: "Status", resource_ids: "Resources", estimated_minutes: "Estimated minutes",
  is_optional: "Optional", deleted_at: "Removed", protected_fields: "Patch protection",
};

function displayValue(key: string, value: unknown, resources: Resource[]): string {
  if (key === "resource_ids") return (value as string[]).map(id => resources.find(r => r.id === id)?.title ?? id).join(", ") || "No resources";
  if (key === "status") return statusNames[value as TaskStatus];
  if (key === "is_optional") return value ? "Yes" : "No";
  if (key === "protected_fields") return (value as string[]).map(field => fieldNames[field] ?? field).join(", ") || "None";
  return value === null || value === undefined ? "—" : String(value);
}

function TaskEditor({ task, resources, onSaved, onDirty, onBusy }: {
  task: AdminTask; resources: Resource[]; onSaved: () => Promise<void>; onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<AdminChanges>({ title: task.title, status: task.status,
    resource_ids: task.resource_ids, estimated_minutes: task.estimated_minutes, is_optional: Boolean(task.is_optional) });
  const [resourceSearch, setResourceSearch] = useState("");
  const [pending, setPending] = useState<AdminCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const changes = adminChanges(task, draft);
  const dirty = Object.keys(changes).length > 0;
  const valid = Boolean(draft.title?.trim()) && (draft.title?.trim().length ?? 0) <= 2000
    && !/[\r\n]/.test(draft.title ?? "")
    && (draft.estimated_minutes === null || (Number.isInteger(draft.estimated_minutes)
      && Number(draft.estimated_minutes) >= 0 && Number(draft.estimated_minutes) <= 10080));
  function update(next: AdminChanges) {
    const updated = { ...draft, ...next };
    setDraft(updated); setError("");
    onDirty(Object.keys(adminChanges(task, updated)).length > 0);
  }
  function preview(action: AdminCommand["action"]) {
    setError("");
    setPending({ request_id: crypto.randomUUID(), revision: task.revision, action,
      ...(action === "edit" ? changes : {}) });
    onDirty(true);
  }
  async function save() {
    if (!pending || busy) return;
    setBusy(true); onBusy(true); setError("");
    try {
      if (!saved) {
        await changeAdminTask(task.id, pending);
        setSaved(true); onDirty(false);
      }
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save. Your draft is still here.");
    } finally { setBusy(false); onBusy(false); }
  }
  const confirmation = pending?.action === "delete" ? "Delete task"
    : pending?.action === "restore" ? "Restore task"
    : pending?.action === "release" ? "Allow patch edits" : "Save changes";
  return <section className="adminEditor" aria-label="Task editor">
    <header><div><small>{task.section_title || "Tasks"} · revision {task.revision}</small><h3>{task.title}</h3></div>
      <span className="adminStatus">{task.deleted_at ? "Deleted" : statusNames[task.status]}</span></header>
    <p className="adminPreserve"><ShieldCheck size={15}/>{task.note_count} saved note{task.note_count === 1 ? "" : "s"} · Study content stays intact.</p>
    {task.running_timer && <p role="status">A timer is running. Stop it before cancelling or deleting this task.</p>}
    {pending ? <div className="adminConfirmation" role="region" aria-label="Review task change">
      <h4>{confirmation}: {task.title}</h4>
      {pending.action === "edit" ? <dl>{Object.entries(changes).map(([key, value]) => <div key={key}>
        <dt>{fieldNames[key]}</dt><dd><del>{displayValue(key, task[key as keyof AdminTask], resources)}</del>
          <strong>{displayValue(key, value, resources)}</strong></dd></div>)}</dl>
        : <p>{pending.action === "delete"
          ? "This task will disappear from study views. Notes, tutor reviews, shared resources and time records are kept. Restore it from Deleted tasks if needed."
          : pending.action === "restore" ? "Return this task and its existing study history to the plan."
          : "Future patches may replace the fields you edited here. The task itself will not change now."}</p>}
      <p>A database backup and change receipt are saved before this takes effect.</p>
      {error && <p role="alert">{saved ? "Saved successfully, but refreshing failed. " : ""}{error}</p>}
      <footer><button className="commandButton subtle" disabled={busy || saved} onClick={() => { setPending(null); onDirty(dirty); }} type="button">Back to task</button>
        <button className={`commandButton ${pending.action === "delete" ? "danger" : ""}`} disabled={busy} onClick={() => void save()} type="button">
          {busy ? "Saving…" : saved ? "Refresh saved change" : confirmation}</button></footer>
    </div> : task.deleted_at ? <button className="commandButton" onClick={() => preview("restore")} type="button">Restore task…</button> : <>
      <label>Task title<input aria-label="Task title" maxLength={2000} value={draft.title ?? ""} onChange={event => update({title: event.target.value})}/></label>
      <div className="adminFormRow"><label>Status<select aria-label="Task status" value={draft.status} onChange={event => update({status: event.target.value as TaskStatus})}>
        {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label><label>Estimated minutes<input aria-label="Estimated minutes" min={0} max={10080} type="number" value={draft.estimated_minutes ?? ""}
        onChange={event => update({estimated_minutes: event.target.value === "" ? null : Number(event.target.value)})}/></label>
        <label className="adminCheck"><input type="checkbox" checked={Boolean(draft.is_optional)} onChange={event => update({is_optional: event.target.checked})}/> Optional task</label></div>
      <fieldset><legend>Attached resources · {draft.resource_ids?.length ?? 0}</legend>
        <input aria-label="Find resources to attach" placeholder="Find a book, lecture, paper…" value={resourceSearch} onChange={event => setResourceSearch(event.target.value)}/>
        <div className="adminResources">{resources.filter(resource => resource.kind !== "discussion" && resource.title.toLowerCase().includes(resourceSearch.toLowerCase())).map(resource =>
          <label key={resource.id}><input type="checkbox" checked={draft.resource_ids?.includes(resource.id) ?? false}
            onChange={event => update({resource_ids: event.target.checked ? [...(draft.resource_ids ?? []), resource.id] : draft.resource_ids?.filter(id => id !== resource.id)})}/>
            <span>{resource.title}<small>{resource.kind}</small></span></label>)}</div>
      </fieldset>
      {task.protected_fields.length > 0 && <p className="adminProtection">Protected from conflicting patches: {displayValue("protected_fields", task.protected_fields, resources)}.</p>}
      {!valid && <p role="alert">Use a non-empty title and a whole-minute estimate from 0 to 10080, or leave the estimate blank.</p>}
      <footer><button className="commandButton" disabled={!dirty || !valid || (task.running_timer && draft.status === "skipped")} onClick={() => preview("edit")} type="button"><Check size={15}/> Review changes</button>
        <button className="commandButton subtle" disabled={task.running_timer || task.status === "skipped"} onClick={() => update({status: "skipped"})} type="button">Cancel task</button>
        <button className="commandButton danger" disabled={dirty || task.running_timer} onClick={() => preview("delete")} type="button"><Trash2 size={14}/> Delete task…</button>
        {task.protected_fields.length > 0 && <button className="commandButton subtle" disabled={dirty} onClick={() => preview("release")} type="button">Allow patch edits…</button>}</footer>
      <small className="adminIdentity">Task ID: {task.id}</small>
    </>}
  </section>;
}

export function TaskAdministration({ course, initialDayId, onClose, onChanged }: {
  course: Course; initialDayId: string; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [dayId, setDayId] = useState(initialDayId || course.days[0]?.id || "");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState(false);
  const [tab, setTab] = useState<"tasks" | "history" | "guide" | "progress">("tasks");
  const [guide, setGuide] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorSession, setEditorSession] = useState(0);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const navigate = useCallback((action: () => void) => {
    if (saving) return;
    const proceed = () => { setDirty(false); setEditorSession(current => current + 1); action(); };
    if (dirty) setDiscard(() => proceed); else proceed();
  }, [dirty, saving]);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchTaskAdministration(course.id), fetchPatchingGuide()]).then(([overview, reference]) => {
      if (alive) { setData(overview); setGuide(reference.markdown); }
    }).catch(caught => { if (alive) setError(String(caught)); });
    return () => { alive = false; };
  }, [course.id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const siblings = [...document.body.children].filter(el => el !== dialog.current?.parentElement) as HTMLElement[];
    const inert = siblings.map(el => el.inert);
    siblings.forEach(el => { el.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      siblings.forEach((el, index) => { el.inert = inert[index]; });
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (discard) setDiscard(null); else navigate(onClose); }
      if (event.key !== "Tab") return;
      const scope = discard ? dialog.current?.querySelector(".adminDiscard") : dialog.current;
      const controls = [...(scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select, summary, [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, [navigate, onClose, discard]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const tasks = data?.tasks.filter(task => task.day_id === dayId && Boolean(task.deleted_at) === removed && task.title.toLowerCase().includes(query.toLowerCase())) ?? [];
  const selected = tasks.find(task => task.id === selectedId) ?? tasks[0];
  async function refresh() {
    const updated = await fetchTaskAdministration(course.id);
    await onChanged();
    setData(updated); setDirty(false); setNotice("Saved. Backup and change history recorded.");
  }
  async function reload() {
    try {
      const [updated, reference] = await Promise.all([fetchTaskAdministration(course.id), fetchPatchingGuide()]);
      setData(updated); setGuide(reference.markdown); setError(""); setNotice("Latest tasks loaded.");
    } catch (caught) { setError(String(caught)); }
  }
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setNotice(message); }
    catch { setError("Clipboard access failed. You can select and copy the reference text below."); }
  }
  return createPortal(<div className="taskAdminBackdrop"><section className="taskAdminDialog" role="dialog" aria-modal="true" aria-label="Task administration" tabIndex={-1} ref={dialog}>
    <header className="adminHeader"><div><small><Settings2 size={14}/> Plan maintenance</small><h2>Task administration</h2><p>Clean up the plan. Keep your study history.</p></div>
      <button className="commandButton subtle" disabled={saving} onClick={() => navigate(onClose)} type="button" aria-label="Exit task administration"><X size={17}/> Exit mode</button></header>
    <nav className="adminNav" aria-label="Administration sections">{(["tasks", "history", "guide"] as const).map(value => <button className="commandButton subtle" aria-pressed={tab === value} key={value} onClick={() => navigate(() => { setTab(value); setDirty(false); })} type="button">
      {value === "tasks" ? <Settings2 size={15}/> : value === "history" ? <History size={15}/> : <BookOpen size={15}/>}{value === "tasks" ? "Tasks" : value === "history" ? "Change history" : "Patch guide"}</button>)}
      <button className="commandButton subtle" aria-pressed={tab === "progress"} type="button" onClick={() => navigate(() => setTab("progress"))}><Download size={15}/> Course progress</button>
      <button className="commandButton subtle" disabled={saving} type="button" onClick={() => navigate(() => { void reload(); })}>Reload latest</button>
      <span><ShieldCheck size={14}/> Backed up · revision checked · recoverable</span></nav>
    {error && <p className="adminError" role="alert">{error}</p>}{notice && <p className="adminNotice" role="status">{notice}</p>}
    {!data && !error && <p>Loading task administration…</p>}
    {tab === "tasks" && data && <><div className="adminFilters"><label>Day<select aria-label="Administration day" value={dayId} onChange={event => { const value = event.target.value; navigate(() => { setDayId(value); setSelectedId(""); }); }}>
      {course.days.map(day => <option key={day.id} value={day.id}>Day {day.number} · {day.title}</option>)}</select></label>
      <input aria-label="Find tasks" placeholder="Find a task…" value={query} onChange={event => { const value = event.target.value; navigate(() => { setQuery(value); setSelectedId(""); }); }}/>
      <select aria-label="Task visibility" value={removed ? "deleted" : "active"} onChange={event => { const value = event.target.value; navigate(() => { setRemoved(value === "deleted"); setSelectedId(""); }); }}>
        <option value="active">All tasks, including cancelled</option><option value="deleted">Deleted tasks</option></select>
      <button className="commandButton subtle" type="button" onClick={() => void copy(adminDayContext(data, dayId, course.resources, course.days.find(day => day.id === dayId)), "Day context copied without notes or tutor responses.")}><Copy size={14}/> Copy day context</button></div>
      <div className="adminWorkspace"><aside aria-label="Tasks to manage"><p>{tasks.length} {removed ? "deleted " : ""}tasks</p>{tasks.map(task => <button key={task.id} type="button" aria-pressed={selected?.id === task.id}
        onClick={() => navigate(() => { setSelectedId(task.id); setDirty(false); })}><strong>{task.title}</strong><span>{task.section_title} · {statusNames[task.status]}</span><small>{task.note_count} notes · {task.resource_ids.length} resources</small></button>)}</aside>
        {selected ? <TaskEditor key={`${selected.id}:${selected.revision}:${editorSession}`} task={selected} resources={course.resources} onSaved={refresh} onDirty={setDirty} onBusy={setSaving}/> : <section className="adminEmpty"><h3>{removed ? "No deleted tasks for this day" : "No matching tasks"}</h3><p>{removed ? "Tasks you remove here can be restored from this list." : "Try a different name or day."}</p></section>}
      </div></>}
    {tab === "history" && <div className="adminHistory"><h3>Recent changes</h3><p>The latest 100 changes, with their backups. Study content is not copied into this log.</p>
      {!data?.history.length && <p>No administration changes yet.</p>}
      {data?.history.map(event => <details key={event.id}><summary><strong>{event.after.title}</strong><span>{event.action} · {new Date(event.created_at).toLocaleString()}</span></summary>
        <dl>{["title", "status", "resource_ids", "estimated_minutes", "is_optional", "deleted_at", "protected_fields"].filter(key => JSON.stringify(event.before[key as keyof AdminTask]) !== JSON.stringify(event.after[key as keyof AdminTask])).map(key => <div key={key}><dt>{fieldNames[key]}</dt><dd>{displayValue(key, event.before[key as keyof AdminTask], course.resources)} → {displayValue(key, event.after[key as keyof AdminTask], course.resources)}</dd></div>)}</dl>
        <small>Backup: {event.backup_path}</small><small>Receipt: {event.id}</small></details>)}</div>}
    {tab === "guide" && <div className="adminGuide"><button className="commandButton" disabled={!guide} type="button" onClick={() => void copy(guide, "Complete patch guide copied.")}><Copy size={15}/> Copy guide</button><MarkdownMath>{guide || "Loading guide…"}</MarkdownMath></div>}
    {tab === "progress" && <CourseProgressExport courseId={course.id}/>}
    {discard && <div className="adminDiscardBackdrop"><div className="adminDiscard" role="alertdialog" aria-modal="true" aria-label="Discard unsaved administration changes"><h3>Leave these unsaved changes?</h3><p>Your saved task is unchanged.</p><button className="commandButton subtle" autoFocus onClick={() => setDiscard(null)} type="button">Keep editing</button><button className="commandButton danger" type="button" onClick={() => { const action = discard; setDiscard(null); setDirty(false); action(); }}>Discard changes</button></div></div>}
  </section></div>, document.body);
}
