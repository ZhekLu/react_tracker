import { useState } from "react";
import { DiscussionMarkdownSurface } from "../../components/editor/DiscussionMarkdownSurface";
import { checkEditorInWorker } from "../../lib/checkEditorInWorker";
import example from "../../../../docs/course-note-example.md?raw";
import guide from "../../../../docs/editor-guide.md?raw";
import "./note-playground.css";

const storageKey = "tracker:note-playground:v1";
type Draft = {markdown: string; source: string};
function initialDraft(): Draft {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (typeof saved?.markdown === "string" && typeof saved?.source === "string") return saved;
  } catch { /* A blocked browser store must not prevent using the editor. */ }
  return {markdown: example, source: example};
}
function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], {type: "text/markdown;charset=utf-8"}));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NotePlayground() {
  const [draft, setDraft] = useState(initialDraft);
  const [showGuide, setShowGuide] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [result, setResult] = useState<{source: string; message: string} | null>(null);
  const [checking, setChecking] = useState(false);
  const [previous, setPrevious] = useState<Draft | null>(null);
  const dirty = draft.source !== draft.markdown;
  function updateDraft(next: Draft) {
    setDraft(next);
    try {window.localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false);}
    catch {setStorageError(true);}
  }
  function replace(value: string) {setPrevious(draft); updateDraft({markdown: value, source: value}); setResult(null);}
  async function check() {
    const source = draft.source;
    setChecking(true);
    try {
      const checked = await checkEditorInWorker(source);
      setResult({source, message: checked.checks.length ? checked.checks.join(" · ") : "Passed: text, formulas, highlights and structure survive save/reopen."});
    } catch {setResult({source, message: "The check could not run. Your practice draft is still here."});}
    finally {setChecking(false);}
  }
  return <section className="notePlayground">
    <header><div><h1>Note playground</h1><p>Markdown for writing, LaTeX for mathematics. Experiment here with the same editor used in your course notes.</p></div>
      <button className="commandButton" aria-expanded={showGuide} onClick={() => setShowGuide(!showGuide)}>{showGuide ? "Close writing guide" : "Writing guide"}</button>
    </header>
    {showGuide ? <section className="playgroundGuide" aria-label="Writing guide"><button className="commandButton subtle" onClick={() => download(guide, "tracker-editor-guide.md")}>Download guide .md</button><DiscussionMarkdownSurface markdown={guide}/></section> : null}
    <p className="playgroundNotice">Practice only — your course notes stay separate. This draft is kept in this browser. Download a copy to keep it elsewhere.</p>
    {storageError ? <p role="alert">Browser storage is unavailable. Keep this page open or download your draft before leaving.</p> : null}
    <div className="playgroundActions">
      <button className="commandButton subtle" onClick={() => replace(example)}>Load example</button>
      <button className="commandButton subtle" onClick={() => replace("")}>Start blank</button>
      {previous ? <button className="commandButton subtle" onClick={() => {updateDraft(previous); setPrevious(null);}}>Undo reset</button> : null}
      <button className="commandButton subtle" onClick={() => download(draft.source, "my-course-note.md")}>Download note .md</button>
      <button className="commandButton" disabled={checking} onClick={() => void check()}>{checking ? "Checking…" : "Check save/reopen"}</button>
    </div>
    {result && result.source === draft.source ? <p role="status">{result.message}</p> : null}
    <div className="playgroundSplit">
      <section aria-label="Source pane"><header><h2>Markdown source</h2><button className="commandButton" disabled={!dirty} onClick={() => updateDraft({...draft, markdown: draft.source})}>Apply Markdown</button></header>
        <p>{dirty ? "Source has changes. Apply them to continue in the visual editor." : "Visual edits appear here. Apply after changing the source."}</p>
        <textarea aria-label="Playground Markdown" spellCheck={false} value={draft.source} onChange={event => updateDraft({...draft, source: event.target.value})}/>
      </section>
      <section aria-label="Visual pane"><header><h2>Visual editor</h2><span>{dirty ? "Waiting for Apply Markdown" : "Click a formula · try the highlighter"}</span></header>
        <div className={`playgroundVisual ${dirty ? "sourcePending" : ""}`} inert={dirty}>
          <DiscussionMarkdownSurface editable markdown={draft.markdown} onChange={markdown => updateDraft({markdown, source: markdown})} showActions={false} showSourceToggle={false}/>
        </div>
      </section>
    </div>
  </section>;
}
