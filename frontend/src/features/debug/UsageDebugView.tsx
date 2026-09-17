import { useEffect, useState } from "react";
import { debugRequest } from "../../lib/insertDebug";
import { applyUsageSettings, usageFailure, type UsageSettings } from "../../lib/usageLog";
import "./usage-debug.css";

type Summary = UsageSettings & {event_count: number; sessions: number; active_minutes: Record<string, number>; searches: number; empty_searches: number; failed_requests: number; slow_requests: number; actions: {view: string; action: string; count: number}[]; sequences: {sequence: string; count: number}[]; repeated_actions: {action: string; count: number}[]};
function localDay() {const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
const label = (action: string) => action.replaceAll(".", " · ").replaceAll("_", " ");
export function UsageDebugView({courseId}: {courseId: string}) {
  const [day, setDay] = useState(localDay);
  const [all, setAll] = useState(true);
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const start = all ? new Date(0) : new Date(`${day}T00:00:00`);
    const end = all ? new Date(Date.now() + 86_400_000) : new Date(start);
    if (!all) end.setDate(end.getDate()+1);
    void debugRequest<Summary>(`/usage/summary?${new URLSearchParams({course_id:courseId,start:start.toISOString(),end:end.toISOString()})}`)
      .then(value => {if (active) {setSummary(value); setError(usageFailure()); applyUsageSettings(value);}})
      .catch(e => {if (active) setError(String(e));});
    return () => {active = false;};
  }, [courseId, day, all, revision]);
  async function configure(action: "start" | "stop" | "clear") {
    setBusy(true);
    try {
      const value = await debugRequest<UsageSettings>("/usage/settings", {method:"POST", body:JSON.stringify({action})});
      applyUsageSettings(value); setRevision(n => n+1); setError("");
    } catch (e) {setError(String(e));} finally {setBusy(false);}
  }
  function exportSummary() {
    if (!summary) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({range:all ? "last seven retained days" : day, course_id:courseId, ...summary},null,2)], {type:"application/json"}));
    const a = document.createElement("a"); a.href=url; a.download=`tracker-usage-${localDay()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  return <section className="usageDebug">
    <header><p className="eyebrow">Temporary local observations</p><h1>Where your clicks and time go</h1><p>Use a few days of normal study to find repeated work and difficult navigation.</p></header>
    <div className="usageCaptureState"><strong>{summary?.recording ? `Recording until ${new Date(summary.until).toLocaleString()}` : summary ? "Recording stopped" : "Loading…"}</strong>
      <button disabled={busy || !summary} className="commandButton subtle" onClick={() => void configure(summary?.recording ? "stop" : "start")}>{summary?.recording ? "Stop recording" : "Record for 3 days"}</button>
      <button disabled={busy || !summary} className="commandButton subtle" onClick={() => void configure("clear")}>Delete usage data & stop</button>
    </div>
    <p className="debugRetention">Stored only on this computer, separately from study backups. Events expire after 7 days (maximum 50,000). No notes, responses, search phrases, URLs, keystrokes, or clipboard contents are recorded. Recording controls apply to all courses; this report shows the selected course.</p>
    {error && <p role="alert">{error}</p>}
    <div className="debugFilters"><label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)}/> All retained days</label>
      <input aria-label="Usage date" type="date" disabled={all} value={day} onChange={e => {if (e.target.value) setDay(e.target.value);}}/>
      <button className="commandButton subtle" onClick={() => setRevision(n => n+1)}>Refresh</button><button disabled={!summary} className="commandButton subtle" onClick={exportSummary}>Export summary</button>
    </div>
    {summary && <>
      <div className="usageMetrics"><article><strong>{Object.values(summary.active_minutes).reduce((a,b) => a+b,0).toFixed(1)} min</strong><span>Recent-interaction time</span></article>
        <article><strong>{summary.empty_searches} / {summary.searches}</strong><span>Searches with no results</span></article>
        <article><strong>{summary.failed_requests}</strong><span>Failed API requests</span></article>
        <article><strong>{summary.slow_requests}</strong><span>Requests over 1.5 seconds</span></article></div>
      {!summary.event_count && <p>No observations yet. Use the tracker normally, then refresh this report. Events are sent about every 10 seconds.</p>}
      <p className="usageCaveat">Time counts only a focused, visible tracker with activity in the last 30 seconds. It undercounts quiet reading. Repeated actions are clues to inspect, not proof of wasted effort; generic controls are grouped by type.</p>
      <div className="usageTables"><section><h2>Time by view</h2><table><thead><tr><th>View</th><th>Minutes</th></tr></thead><tbody>{Object.entries(summary.active_minutes).sort((a,b) => b[1]-a[1]).map(([view,min]) => <tr key={view}><td>{view}</td><td>{min.toFixed(1)}</td></tr>)}</tbody></table></section>
        <section><h2>Frequent actions</h2><table><thead><tr><th>View / action</th><th>Count</th></tr></thead><tbody>{summary.actions.map(a => <tr key={`${a.view}:${a.action}`}><td>{a.view} / {label(a.action)}</td><td>{a.count}</td></tr>)}</tbody></table></section>
        <section><h2>Repeated within one second</h2><table><thead><tr><th>Action</th><th>Pairs</th></tr></thead><tbody>{summary.repeated_actions.map(a => <tr key={a.action}><td>{label(a.action)}</td><td>{a.count}</td></tr>)}</tbody></table></section>
        <section><h2>Common next actions</h2><p>Same session, within 30 seconds.</p><table><thead><tr><th>Sequence</th><th>Count</th></tr></thead><tbody>{summary.sequences.map(a => <tr key={a.sequence}><td>{label(a.sequence)}</td><td>{a.count}</td></tr>)}</tbody></table></section>
      </div>
    </>}
  </section>;
}
