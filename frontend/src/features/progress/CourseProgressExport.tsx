import { useEffect, useRef, useState } from "react";
import { Copy, Download, RefreshCw } from "lucide-react";
import { fetchCourseProgressExport, type CourseProgressExport as ProgressSnapshot } from "../../api/trackerApi";
import "./course-progress-export.css";

export function CourseProgressExport({courseId}: {courseId: string}) {
  const [snapshot, setSnapshot] = useState<{courseId: string; request: number; report: ProgressSnapshot | null; error: string} | null>(null);
  const [request, setRequest] = useState(0);
  const [copyError, setCopyError] = useState("");
  const [notice, setNotice] = useState("");
  const source = useRef<HTMLTextAreaElement>(null);
  const report = snapshot?.courseId === courseId ? snapshot.report : null;
  const busy = snapshot?.courseId !== courseId || snapshot.request !== request;
  const error = copyError || (!busy ? snapshot?.error : "");
  useEffect(() => {
    let alive = true;
    fetchCourseProgressExport(courseId).then(result => {
      if (alive) setSnapshot({courseId, request, report: result, error: ""});
    }).catch(caught => {
      if (alive) setSnapshot(previous => ({courseId, request,
        report: previous?.courseId === courseId ? previous.report : null,
        error: caught instanceof Error ? caught.message : "Could not load course progress."}));
    });
    return () => { alive = false; };
  }, [courseId, request]);
  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.markdown);
      setCopyError(""); setNotice("Course progress copied.");
    } catch {
      source.current?.focus(); source.current?.select();
      setCopyError("Clipboard access failed. The report is selected below; copy it manually or download the file.");
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.markdown], {type: "text/markdown;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url; link.download = report.filename;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Course progress downloaded.");
  }
  return <section className="courseProgressExport" aria-label="Course progress export">
    <header><div><h2>Course progress</h2><p>Reading status, question counts, dated tasks and recorded time. Notes and discussion text are excluded.</p></div></header>
    <div className="courseProgressActions">
      <button type="button" className="commandButton" disabled={!report || busy} onClick={() => void copy()}><Copy size={15}/> Copy report</button>
      <button type="button" className="commandButton" disabled={!report || busy} onClick={download}><Download size={15}/> Download Markdown</button>
      <button type="button" className="commandButton subtle" disabled={busy} onClick={() => {setRequest(value => value + 1); setCopyError(""); setNotice("");}}><RefreshCw size={15}/> {busy ? "Loading progress…" : "Refresh report"}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {report && <><p className="courseProgressTimestamp">Snapshot: {new Date(report.exported_at).toLocaleString()} · Saved course state · Refresh to include later changes.</p>
      <label htmlFor="course-progress-report">Progress report</label>
      <textarea id="course-progress-report" aria-label="Progress report" ref={source} readOnly value={report.markdown} spellCheck={false}/></>}
  </section>;
}
