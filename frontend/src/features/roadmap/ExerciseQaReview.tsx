import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FastForward,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { taskExerciseSourceUrl } from "../../api/trackerApi";
import { metadataText } from "../../components/annotations/annotationDisplay";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { importPastedMarkdown } from "../../lib/discussionImport";
import { discussionAnswerSections } from "../../lib/discussionText";
import {
  annotationExerciseNumbers,
  exerciseNumbersForTask,
  exerciseNumbersInText,
  exerciseReviewCounts,
  parseExerciseReviewProgress,
  type ExerciseReviewProgress,
  type ExerciseReviewStatus,
} from "../../lib/exerciseReview";
import type {
  Annotation,
  EntityNoteSaveInput,
  Note,
  Resource,
  Task,
} from "../../types/tracker";

type ExerciseQaReviewProps = {
  onChange: (progress: ExerciseReviewProgress) => void;
  onClose: () => void;
  onNoteDelete: (note: Note) => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
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

function exerciseSourceImages(resource: Resource, exercise: string): string[] {
  return [...new Set(
    resource.annotations
      .filter((annotation) => annotationExerciseNumbers(annotation).includes(exercise))
      .flatMap((annotation) => [
        metadataText(annotation, "contextImageUrl"),
      ])
      .filter(Boolean),
  )];
}

function solutionHeading(exercises: string[]): string {
  return exercises.length === 1
    ? `Exercise ${exercises[0]}`
    : `Exercises ${exercises.join(", ")}`;
}

export function ExerciseQaReview({
  onChange,
  onClose,
  onNoteDelete,
  onNoteSave,
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
  const [importMessage, setImportMessage] = useState("");
  const exercise = allNumbers[activeIndex];
  const notes = answerNotes.filter((note) =>
    exerciseLabel(note.document.markdown ?? note.document.plainText).includes(exercise),
  );
  const source = sourceAnnotation(resource, exercise);
  const pageNumber = pageForExercise(resource, exercise);
  const contextImages = useMemo(
    () => exerciseSourceImages(resource, exercise),
    [exercise, resource],
  );
  const counts = exerciseReviewCounts(allNumbers, taskNumbers, progress);
  const completion = counts.total ? counts.totalReviewed / counts.total : 0;

  function setStatus(status: ExerciseReviewStatus) {
    const next = { ...progress, [exercise]: status };
    setProgress(next);
    onChange(next);
    if (activeIndex < allNumbers.length - 1) setActiveIndex(activeIndex + 1);
  }

  function saveSolution(note: Note | undefined, markdown: string) {
    const labels = exerciseNumbersInText(markdown);
    const content = labels.length
      ? markdown
      : `# Exercise ${exercise}\n\n${markdown}`;
    onNoteSave({
      entityId: task.id,
      entityType: "task",
      html: content,
      kind: "exercise_solution",
      note,
    });
  }

  async function pasteTutorSolutions() {
    try {
      const imported = importPastedMarkdown(await navigator.clipboard.readText());
      const parsed = discussionAnswerSections(imported);
      const sections = parsed.sections.length
        ? parsed.sections
        : [{ markdown: imported }];
      const mapped = sections.flatMap((section) => {
        const numbers = exerciseNumbersInText(section.markdown);
        return numbers.length ? [{ numbers, markdown: section.markdown }] : [];
      });
      if (!mapped.length) {
        setImportMessage("No Exercise n.m headings were found in the clipboard.");
        return;
      }
      mapped.forEach(({ numbers, markdown }) =>
        onNoteSave({
          entityId: task.id,
          entityType: "task",
          html: `# ${solutionHeading(numbers)} — tutor material\n\n${markdown}`,
          kind: "exercise_solution",
        }),
      );
      setImportMessage(
        `${mapped.length} tutor section${mapped.length === 1 ? "" : "s"} mapped.`,
      );
    } catch {
      setImportMessage("Clipboard access failed. Paste into the open exercise editor instead.");
    }
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
          <button className="exerciseQaPaste" onClick={pasteTutorSolutions} type="button">
            Paste tutor solutions
          </button>
          <button aria-label="Close exercise QA" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        {exercise ? (
          <div className="exerciseQaWorkspace">
            <section className="exerciseQaSource">
              <header><strong>Exercise {exercise}</strong><span>{pageNumber ? `p. ${pageNumber}` : "Book source"}</span></header>
              {contextImages.length ? contextImages.map((image, index) => (
                <img
                  alt={`Annotated solution area ${index + 1} for Exercise ${exercise}`}
                  key={image}
                  src={image}
                />
              )) : (
                <img
                  alt={`Book statement for Exercise ${exercise}`}
                  src={taskExerciseSourceUrl(task.id, exercise)}
                />
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
              {importMessage ? <p className="exerciseQaImportMessage">{importMessage}</p> : null}
              {notes.length ? notes.map((note, index) => (
                <EntityNoteEditor
                  deleteLabel="Unlink tutor answer"
                  key={`${note.id}:${note.revision}`}
                  label={`Tutor answer${notes.length > 1 ? ` ${index + 1}` : ""}`}
                  note={note}
                  onDelete={onNoteDelete}
                  onSave={(markdown) => saveSolution(note, markdown)}
                  placeholder="Edit the tutor solution, formulas, or useful highlights…"
                />
              )) : (
                <EntityNoteEditor
                  key={`new:${exercise}`}
                  label="Add tutor answer"
                  onSave={(markdown) => saveSolution(undefined, markdown)}
                  placeholder="Paste or write the tutor solution for this exercise…"
                />
              )}
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
