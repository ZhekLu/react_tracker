import { useEffect, useState } from "react";
import { DiscussionMarkdownSurface } from "../../components/editor/DiscussionMarkdownSurface";
import { debugRequest, insertDebugFailure, type DebugFixture, type InsertRecord, type InsertSummary } from "../../lib/insertDebug";
import { checkEditorInWorker } from "../../lib/checkEditorInWorker";
import "./insert-debug.css";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateRange(day: string, all: boolean) {
  const start = all ? new Date(0) : new Date(`${day}T00:00:00`);
  const end = all ? new Date(Date.now() + 86_400_000) : new Date(start);
  if (!all) end.setDate(end.getDate() + 1);
  return {start: start.toISOString(), end: end.toISOString()};
}

export function InsertDebugView({courseId}: {courseId: string}) {
  const [day, setDay] = useState(today);
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState("all");
  const [revision, setRevision] = useState(0);
  const [records, setRecords] = useState<InsertSummary[]>([]);
  const [retained, setRetained] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [record, setRecord] = useState<InsertRecord | null>(null);
  const [error, setError] = useState(insertDebugFailure);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const showError = () => setError(insertDebugFailure());
    window.addEventListener("tracker:debug-error", showError);
    return () => window.removeEventListener("tracker:debug-error", showError);
  }, []);
  useEffect(() => {
    let active = true;
    const range = dateRange(day, all);
    void debugRequest<{records: InsertSummary[]; retained_count: number}>(`/inserts?${new URLSearchParams({course_id: courseId, ...range})}`)
      .then(data => { if (active) {setRecords(data.records); setRetained(data.retained_count); setError(insertDebugFailure());} })
      .catch(e => {if (active) setError(String(e));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [courseId, day, all, revision]);
  useEffect(() => {
    let active = true;
    if (selectedId) void debugRequest<InsertRecord>(`/inserts/${selectedId}`)
      .then(value => {if (active) setRecord(value);}).catch(e => {if (active) setError(String(e));});
    return () => {active = false;};
  }, [selectedId]);
  const visible = records.filter(item => filter === "all" || (filter === "checks" ? item.checks.length > 0 : item.status === filter));
  async function exportFixtures() {
    try {
      const fixtures = await debugRequest<DebugFixture[]>("/fixtures");
      const url = URL.createObjectURL(new Blob([JSON.stringify(fixtures, null, 2)], {type: "application/json"}));
      const a = document.createElement("a"); a.href = url; a.download = "editor-regressions.json"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {setError(String(e));}
  }
  return <section className="insertDebug">
    <header><div><h1>Editor debug</h1><p>Review pasted text and saved notes. Compare parsing now with a fresh save/reopen.</p></div>
      <button className="commandButton" onClick={() => void exportFixtures()}>Export test fixtures</button></header>
    <p className="debugRetention">Full records expire after 7 days (up to 500 records / 20 MB). Completing a review deletes its full text; only the small fixture you choose is kept. Study notes keep their normal history.</p>
    {error && <p role="alert" className="debugError">{error}</p>}
    <div className="debugFilters">
      <label>Insert date <input aria-label="Insert date" type="date" value={day} disabled={all} onChange={e => {if (e.target.value) {setDay(e.target.value); setSelectedId("");}}}/></label>
      <label><input type="checkbox" checked={all} onChange={e => {setAll(e.target.checked); setSelectedId("");}}/> All retained days ({retained})</label>
      <select aria-label="Review filter" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">All inserts</option><option value="pending">Unreviewed</option><option value="incorrect">Incorrect</option><option value="improvement">Could improve</option><option value="checks">Check failures</option>
      </select>
      <button className="commandButton" onClick={() => setRevision(n => n + 1)}>Refresh</button>
    </div>
    <div className="debugWorkspace"><nav aria-label="Insert records">
      {loading ? <p>Loading inserts…</p> : !visible.length ? <p>No inserts in this view.</p> : null}
      {visible.map(item => <button className={selectedId === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
        <strong>{new Date(item.created_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})} · {item.source.startsWith("Save ") ? "Saved content" : item.source}</strong>
        <span>{item.status} · {item.outcome}</span><small>{item.checks.length ? item.checks.join(" · ") : "Save/reopen checks passed"}</small>
      </button>)}
    </nav>
      {record && record.id === selectedId ? <InsertReview key={record.id} record={record} onChanged={() => setRevision(n => n + 1)} onDone={() => {setSelectedId(""); setRevision(n => n + 1);}}/> : <p>Select an insert to compare and review it.</p>}
    </div>
  </section>;
}

function InsertReview({record, onChanged, onDone}: {record: InsertRecord; onChanged: () => void; onDone: () => void}) {
  const [status, setStatus] = useState(record.status);
  const [feedback, setFeedback] = useState(record.feedback);
  const [stage, setStage] = useState<"parsed" | "serialized" | "reopened">("reopened");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fixture, setFixture] = useState<DebugFixture>({title: "", kind: "roundtrip", input: "", expected: ""});
  const [useFixture, setUseFixture] = useState(false);
  const [rerun, setRerun] = useState<string | null>(null);
  async function runChecks() {
    setBusy(true); setError("");
    try {
      const result = await checkEditorInWorker(record.parsed);
      setRerun(result.checks.length ? result.checks.join("; ") : "Current editor: all save/reopen checks passed.");
    } catch (e) {setError(String(e));} finally {setBusy(false);}
  }
  async function action(operation: "flag" | "complete" | "discard") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (operation === "discard") {await debugRequest(`/inserts/${record.id}`, {method: "DELETE"}); onDone(); return;}
      await debugRequest(`/inserts/${record.id}`, {method: "PATCH", body: JSON.stringify({status, feedback})});
      if (operation === "complete") {
        await debugRequest(`/inserts/${record.id}/complete`, {method: "POST", body: JSON.stringify({fixture: useFixture || status !== "pending" ? fixture : null})});
        onDone();
      } else {onChanged(); setNotice("Review flag and feedback saved.");}
    } catch (e) {setError(String(e));} finally {setBusy(false);}
  }
  return <article className="debugReview">
    <h2>{record.source.startsWith("Save ") ? "Saved content" : record.source}</h2>
    <p>{new Date(record.created_at).toLocaleString()} · {record.outcome} · {record.parser_version}</p>
    <p>{record.checks.length ? record.checks.join("; ") : "Automatic checks passed: text, formulas, marks, and structure survive save/reopen."}</p>
    <button className="commandButton subtle" disabled={busy} onClick={() => void runChecks()}>Run checks with current editor</button>
    {rerun && <p role="status">{rerun}</p>}
    <div className="debugCompare"><div><h3>Original input</h3>
      <textarea aria-label="Original input" readOnly value={record.input} onSelect={event => {
        const {selectionStart, selectionEnd, value} = event.currentTarget;
        if (selectionEnd > selectionStart && selectionEnd - selectionStart <= 3000) setFixture(f => ({...f, input: value.slice(selectionStart, selectionEnd)}));
      }}/><small>Select a short problem passage to use as fixture input.</small></div>
      <div><label>Compare stage <select value={stage} onChange={e => setStage(e.target.value as typeof stage)}><option value="parsed">After import</option><option value="serialized">Serialized Markdown</option><option value="reopened">After reopening</option></select></label>
        <div className="debugPreview"><DiscussionMarkdownSurface key={stage} markdown={record[stage]}/></div>
        <details><summary>Markdown source</summary><pre>{record[stage]}</pre></details>
      </div></div>
    <fieldset disabled={busy}><legend>Review result</legend>
      <label>Status <select value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="pending">Looks correct / unreviewed</option><option value="incorrect">Parsed incorrectly</option><option value="improvement">Could use improvement</option></select></label>
      <label>What went wrong / where<textarea maxLength={2000} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Describe the passage and expected formatting…"/></label>
      <button className="commandButton" onClick={() => void action("flag")}>Save flag & feedback</button>
      <label><input type="checkbox" checked={useFixture || status !== "pending"} disabled={status !== "pending"} onChange={e => setUseFixture(e.target.checked)}/> Keep a minimal test fixture</label>
      {(useFixture || status !== "pending") && <div className="debugFixture">
        <p>Keep only the small example needed to reproduce the bug (3,000 characters per field). Edit or anonymize it before completing review.</p>
        <label>Fixture name<input maxLength={120} value={fixture.title} onChange={e => setFixture({...fixture, title: e.target.value})}/></label>
        <label>Check<select value={fixture.kind} onChange={e => setFixture({...fixture, kind: e.target.value as DebugFixture["kind"]})}><option value="roundtrip">Save / reopen formatting</option><option value="paste">Paste import</option></select></label>
        <label>Minimal input<textarea maxLength={3000} value={fixture.input} onChange={e => setFixture({...fixture, input: e.target.value})}/></label>
        <label>Expected Markdown<textarea maxLength={3000} value={fixture.expected} onChange={e => setFixture({...fixture, expected: e.target.value})}/></label>
      </div>}
      <div className="debugActions"><button className="commandButton" onClick={() => void action("complete")}>{useFixture || status !== "pending" ? "Keep fixture & delete full record" : "Reviewed — delete record"}</button>
        <button className="commandButton subtle" onClick={() => void action("discard")}>Discard record</button></div>
    </fieldset>{error && <p role="alert" className="debugError">{error}</p>}{notice && <p role="status">{notice}</p>}
  </article>;
}
