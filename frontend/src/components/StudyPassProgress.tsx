import { RotateCcw, Sparkles } from "lucide-react";
import { ProgressBar } from "./ProgressBar";
import "./study-pass-progress.css";

export function StudyPassProgress({ label, done, total, detail, onRestart, restartDisabled = false, tone = "reading" }: {
  label: string; done: number; total: number; detail: string;
  onRestart?: () => void; restartDisabled?: boolean; tone?: "reading" | "understood";
}) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return <section className={`studyPassProgress ${tone}${total > 0 && done >= total ? " complete" : ""}`}>
    <div className="studyPassHeading"><span>{label}</span><strong>{done}<small> / {total}</small></strong>
      {onRestart && <button type="button" disabled={restartDisabled} onClick={onRestart} title="Start a fresh pass. Saved answers and reading history are kept."><RotateCcw size={12} /> New pass</button>}
    </div>
    <div className="studyPassTrack"><ProgressBar label={label} value={ratio} />
      <div className="studyPassMilestones" aria-hidden="true">{[.25, .5, .75, 1].map(mark => <i className={ratio >= mark ? "reached" : ""} key={mark} />)}</div>
    </div>
    <p role="status"><Sparkles size={12} /><span>{detail}</span></p>
  </section>;
}
