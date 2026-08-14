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
import { taskExerciseSourceUrl } from "../../api/trackerApi";
import { DiscussionMarkdownSurface } from "../../components/editor/DiscussionMarkdownSurface";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { importPastedMarkdown } from "../../lib/discussionImport";
import {
  exerciseAnswerSections,
  exerciseNumbersForTask,
  exerciseNumbersInText,
  exerciseReviewCounts,
  parseExerciseReviewProgress,
  type ExerciseReviewProgress,
  type ExerciseReviewStatus,
} from "../../lib/exerciseReview";
import type {
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
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState("");
  const exercise = allNumbers[activeIndex];
  const notes = answerNotes.filter((note) =>
    exerciseLabel(note.document.markdown ?? note.document.plainText).includes(exercise),
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

  function importTutorSolutions(markdownInput: string) {
    const imported = importPastedMarkdown(markdownInput);
    const mapped = exerciseAnswerSections(imported).map((section) => ({
      numbers: section.exercises,
      markdown: section.markdown,
    }));
    if (!mapped.length) {
      setImportMessage("No Exercise n.m headings were found in this response.");
      return;
    }
    const existingContent = answerNotes.map(
      (note) => note.document.markdown ?? note.document.plainText,
    );
    const newSections = mapped.filter(
      ({ markdown }) =>
        !existingContent.some((content) => content.includes(markdown)),
    );
    newSections.forEach(({ numbers, markdown }) =>
      onNoteSave({
        entityId: task.id,
        entityType: "task",
        html: `# ${solutionHeading(numbers)} — tutor material\n\n${markdown}`,
        kind: "exercise_solution",
      }),
    );
    const duplicates = mapped.length - newSections.length;
    setImportMessage(
      `${newSections.length} new tutor section${newSections.length === 1 ? "" : "s"} mapped${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}.`,
    );
    setBulkDraft("");
    setBulkEditorOpen(false);
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
          <button className="exerciseQaPaste" onClick={() => setBulkEditorOpen((current) => !current)} type="button">
            {bulkEditorOpen ? "Close tutor import" : "Add tutor answers"}
          </button>
          <button aria-label="Close exercise QA" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        {bulkEditorOpen ? (
          <section className="exerciseQaBulkEditor">
            <header>
              <div>
                <strong>One response for the whole chapter</strong>
                <small>Paste once. Headings such as “## Exercise 6.6” are mapped automatically; shared headings can name several exercises.</small>
              </div>
            </header>
            <DiscussionMarkdownSurface
              contentType="markdown"
              editable
              markdown={bulkDraft}
              onCancel={() => setBulkEditorOpen(false)}
              onChange={setBulkDraft}
              onSave={importTutorSolutions}
              placeholder="Paste the complete tutor response with Exercise n.m headings…"
            />
          </section>
        ) : null}
        {exercise ? (
          <div className="exerciseQaWorkspace">
            <section className="exerciseQaSource">
              <header><strong>Exercise {exercise}</strong><span>Annotated book source</span></header>
              <img
                alt={`Annotated solution group containing Exercise ${exercise}`}
                key={exercise}
                src={taskExerciseSourceUrl(task.id, exercise)}
              />
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
                  defaultEditing
                  defaultOpen
                  deleteLabel="Delete response fully"
                  key={`${note.id}:${note.revision}`}
                  label={`Tutor answer${notes.length > 1 ? ` ${index + 1}` : ""}`}
                  note={note}
                  onDelete={onNoteDelete}
                  onSave={(markdown) => saveSolution(note, markdown)}
                  placeholder="Edit the tutor solution, formulas, or useful highlights…"
                  showDeleteInSummary
                />
              )) : (
                <EntityNoteEditor
                  defaultEditing
                  defaultOpen
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
