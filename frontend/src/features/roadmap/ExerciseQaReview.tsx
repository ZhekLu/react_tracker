import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FastForward,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { annotationImageUrl, pdfReaderPageUrl } from "../../api/trackerApi";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import {
  annotationExerciseNumbers,
  exerciseNumbersForTask,
  exerciseNumbersInText,
  exerciseReviewCounts,
  parseExerciseReviewProgress,
  type ExerciseReviewProgress,
  type ExerciseReviewStatus,
} from "../../lib/exerciseReview";
import type { Annotation, Resource, Task } from "../../types/tracker";

type ExerciseQaReviewProps = {
  onChange: (progress: ExerciseReviewProgress) => void;
  onClose: () => void;
  resource: Resource;
  task: Task;
};

function exerciseLabel(noteMarkdown: string): string[] {
  return exerciseNumbersInText(noteMarkdown.match(/^#\s+(.+)$/m)?.[1] ?? noteMarkdown);
}

function pageForExercise(resource: Resource, exercise: string): number | null {
  const matching = resource.annotations
    .filter((annotation) => annotationExerciseNumbers(annotation).includes(exercise))
    .sort(
      (left, right) =>
        Number(right.origin.includes("ink")) - Number(left.origin.includes("ink")) ||
        (left.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER),
    );
  return matching[0]?.anchor?.pageNumber ?? null;
}

function sourceAnnotation(
  resource: Resource,
  exercise: string,
): Annotation | undefined {
  return resource.annotations.find(
    (annotation) =>
      annotationExerciseNumbers(annotation).includes(exercise) &&
      annotation.anchor?.pageNumber,
  );
}

export function ExerciseQaReview({
  onChange,
  onClose,
  resource,
  task,
}: ExerciseQaReviewProps) {
  const answerNotes = task.notes.filter((note) => note.kind === "exercise_solution");
  const chapterNumbers = task.chapterNumbers;
  const taskNumbers = exerciseNumbersInText(task.title);
  const allNumbers = exerciseNumbersForTask(task, resource);
  const reviewNote = task.notes.find((note) => note.kind === "exercise_review");
  const [progress, setProgress] = useState(() => parseExerciseReviewProgress(reviewNote));
  const [activeIndex, setActiveIndex] = useState(0);
  const exercise = allNumbers[activeIndex];
  const notes = answerNotes.filter((note) =>
    exerciseLabel(note.document.markdown ?? note.document.plainText).includes(exercise),
  );
  const source = sourceAnnotation(resource, exercise);
  const pageNumber = pageForExercise(resource, exercise);
  const counts = exerciseReviewCounts(allNumbers, taskNumbers, progress);
  const completion = counts.total ? counts.totalReviewed / counts.total : 0;

  function setStatus(status: ExerciseReviewStatus) {
    const next = { ...progress, [exercise]: status };
    setProgress(next);
    onChange(next);
    if (activeIndex < allNumbers.length - 1) setActiveIndex(activeIndex + 1);
  }

  return createPortal(
    <div className="exerciseQaBackdrop">
      <main className="exerciseQaSession" role="dialog" aria-modal="true">
        <header className="exerciseQaHeader">
          <span className="qaReviewBadge"><Sparkles size={15} /> Exercise QA</span>
          <div>
            <strong>Chapter {chapterNumbers.join(", ")} exercises</strong>
            <small>
              Required {counts.requiredReviewed}/{counts.requiredTotal} · Chapter {counts.totalReviewed}/{counts.total}
            </small>
          </div>
          <div className="exerciseQaProgress"><span style={{ width: `${Math.max(3, completion * 100)}%` }} /></div>
          <strong>{Math.round(completion * 100)}%</strong>
          <button aria-label="Close exercise QA" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        {exercise ? (
          <div className="exerciseQaWorkspace">
            <section className="exerciseQaSource">
              <header><strong>Exercise {exercise}</strong><span>{pageNumber ? `p. ${pageNumber}` : "No source page"}</span></header>
              {pageNumber ? (
                <img
                  alt={`Annotated book page for Exercise ${exercise}`}
                  onError={(event) => {
                    event.currentTarget.src = pdfReaderPageUrl(resource.id, pageNumber);
                  }}
                  src={annotationImageUrl(resource.id, `drawboard-page-${pageNumber}`)}
                />
              ) : (
                <div className="exerciseQaEmpty">No collected book annotation locates this exercise yet.</div>
              )}
              {source?.anchor?.quote ? <blockquote>{source.anchor.quote}</blockquote> : null}
            </section>
            <section className="exerciseQaAnswers">
              <header>
                <div><span>{activeIndex + 1} of {allNumbers.length}</span><h2>Exercise {exercise}</h2></div>
                <div className="exerciseQaStateButtons">
                  <button className={progress[exercise] === "later" ? "later active" : "later"} onClick={() => setStatus("later")} type="button"><Clock3 size={14} /> Review later</button>
                  <button className={progress[exercise] === "understood" ? "understood active" : "understood"} onClick={() => setStatus("understood")} type="button"><CheckCircle2 size={14} /> Understood</button>
                  <button className={progress[exercise] === "skipped" ? "skipped active" : "skipped"} onClick={() => setStatus("skipped")} type="button"><FastForward size={14} /> Skip</button>
                </div>
              </header>
              {notes.length ? notes.map((note, index) => (
                <article className="exerciseQaTutorAnswer" key={note.id}>
                  <small>Tutor answer {notes.length > 1 ? index + 1 : ""}</small>
                  <MarkdownMath>{note.document.markdown ?? note.document.plainText}</MarkdownMath>
                </article>
              )) : <div className="exerciseQaEmpty">No tutor answer is mapped yet. Mark it later, or skip it if it is unnecessary.</div>}
            </section>
          </div>
        ) : <div className="exerciseQaEmpty">Collect or map chapter exercises first.</div>}
        <footer className="exerciseQaNav">
          <button disabled={activeIndex === 0} onClick={() => setActiveIndex(activeIndex - 1)} type="button"><ArrowLeft size={16} /> Previous</button>
          <span>Exercise {exercise ?? "—"} · {progress[exercise] ?? "unreviewed"}</span>
          <button disabled={activeIndex >= allNumbers.length - 1} onClick={() => setActiveIndex(activeIndex + 1)} type="button">Next <ArrowRight size={16} /></button>
        </footer>
      </main>
    </div>,
    document.body,
  );
}
