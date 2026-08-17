import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FastForward,
  PenLine,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { taskExerciseSourceUrl } from "../../api/trackerApi";
import { DiscussionMarkdownSurface } from "../../components/editor/DiscussionMarkdownSurface";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { importPastedMarkdown } from "../../lib/discussionImport";
import { parseExerciseProgress } from "../../lib/exerciseProgress";
import {
  exerciseAnswerSections,
  exerciseNumbersForTask,
  exerciseNumbersInText,
  exerciseReviewCounts,
  exerciseVisualStatus,
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

type SolutionKind = "exercise_solution" | "exercise_my_solution";

type ExerciseQaReviewProps = {
  onChange: (progress: ExerciseReviewProgress) => void;
  onClose: () => void;
  onNoteDelete: (note: Note) => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  resource: Resource;
  task: Task;
};

function exerciseLabel(noteMarkdown: string): string[] {
  return exerciseNumbersInText(
    noteMarkdown.match(/^#\s+(.+)$/m)?.[1] ?? noteMarkdown,
  );
}

function solutionHeading(exercises: string[]): string {
  return exercises.length === 1
    ? `Exercise ${exercises[0]}`
    : `Exercises ${exercises.join(", ")}`;
}

function noteCoversExercise(note: Note, exercise: string): boolean {
  return exerciseLabel(
    note.document.markdown ?? note.document.plainText,
  ).includes(exercise);
}

export function ExerciseQaReview({
  onChange,
  onClose,
  onNoteDelete,
  onNoteSave,
  resource,
  task,
}: ExerciseQaReviewProps) {
  const tutorNotes = task.notes.filter(
    (note) => note.kind === "exercise_solution",
  );
  const mySolutionNotes = task.notes.filter(
    (note) => note.kind === "exercise_my_solution",
  );
  const chapterNumbers = task.chapterNumbers;
  const requiredNumbers = exerciseNumbersInText(task.title);
  const allNumbers = exerciseNumbersForTask(task, resource);
  const resourceProgress = parseExerciseProgress(
    resource.notes.find((note) => note.kind === "exercise_progress"),
  );
  const reviewNote = task.notes.find((note) => note.kind === "exercise_review");
  const [progress, setProgress] = useState(() =>
    parseExerciseReviewProgress(reviewNote),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [sessionMode, setSessionMode] = useState<"review" | "solve">("review");
  const [importMessage, setImportMessage] = useState("");
  const [bulkKind, setBulkKind] = useState<SolutionKind | null>(null);
  const [bulkDraft, setBulkDraft] = useState("");
  const reviewNumbers = allNumbers.filter(
    (number) =>
      requiredNumbers.includes(number) ||
      [...tutorNotes, ...mySolutionNotes].some((note) =>
        noteCoversExercise(note, number),
      ) ||
      resourceProgress[number] !== "unread",
  );
  const sessionNumbers = sessionMode === "solve"
    ? allNumbers
    : reviewNumbers.length
      ? reviewNumbers
      : requiredNumbers;
  const exercise = sessionNumbers[activeIndex];
  const answers = exercise
    ? tutorNotes.filter((note) => noteCoversExercise(note, exercise))
    : [];
  const mySolutions = exercise
    ? mySolutionNotes.filter((note) => noteCoversExercise(note, exercise))
    : [];
  const counts = exerciseReviewCounts(allNumbers, requiredNumbers, progress);
  const completion = counts.total ? counts.totalReviewed / counts.total : 0;

  function setStatus(status: ExerciseReviewStatus) {
    if (!exercise) return;
    const next = { ...progress, [exercise]: status };
    setProgress(next);
    onChange(next);
    if (activeIndex < sessionNumbers.length - 1) {
      setActiveIndex(activeIndex + 1);
    }
  }

  function saveSolution(
    note: Note | undefined,
    markdown: string,
    kind: SolutionKind,
  ) {
    if (!exercise) return;
    const labels = exerciseNumbersInText(markdown);
    const content = labels.length
      ? markdown
      : `# Exercise ${exercise}\n\n${markdown}`;
    onNoteSave({
      entityId: task.id,
      entityType: "task",
      html: content,
      kind,
      note,
    });
  }

  function importSolutions(markdownInput: string, kind: SolutionKind) {
    const imported = importPastedMarkdown(markdownInput);
    const mapped = exerciseAnswerSections(imported).map((section) => ({
      numbers: section.exercises,
      markdown: section.markdown,
    }));
    if (!mapped.length) {
      setImportMessage("No Exercise n.m headings were found in this response.");
      return;
    }
    const notesForKind = kind === "exercise_solution" ? tutorNotes : mySolutionNotes;
    const existingContent = notesForKind.map(
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
        html: `# ${solutionHeading(numbers)} — ${kind === "exercise_solution" ? "tutor material" : "my solution"}\n\n${markdown}`,
        kind,
      }),
    );
    const duplicates = mapped.length - newSections.length;
    setImportMessage(
      `${newSections.length} new ${kind === "exercise_solution" ? "tutor" : "personal"} section${newSections.length === 1 ? "" : "s"} mapped${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}.`,
    );
    setBulkDraft("");
    setBulkKind(null);
  }

  function selectSessionMode(mode: "review" | "solve") {
    setSessionMode(mode);
    setActiveIndex(0);
  }

  function openExercise(number: string) {
    if (sessionNumbers.includes(number)) {
      setActiveIndex(sessionNumbers.indexOf(number));
      return;
    }
    setSessionMode("solve");
    setActiveIndex(allNumbers.indexOf(number));
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
          <div className="exerciseQaModeButtons">
            <button className={sessionMode === "review" ? "active" : ""} onClick={() => selectSessionMode("review")} type="button">Review mapped</button>
            <button className={sessionMode === "solve" ? "active" : ""} onClick={() => selectSessionMode("solve")} type="button">Solve chapter</button>
          </div>
          <div className="exerciseQaImportButtons">
            <button className="exerciseQaPaste" onClick={() => setBulkKind(bulkKind === "exercise_my_solution" ? null : "exercise_my_solution")} type="button"><PenLine size={13} /> Add my solutions</button>
            <button className="exerciseQaPaste" onClick={() => setBulkKind(bulkKind === "exercise_solution" ? null : "exercise_solution")} type="button">Add tutor answers</button>
          </div>
          <button aria-label="Close exercise QA" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <nav className="exerciseQaMap" aria-label="Chapter exercise map">
          {allNumbers.map((number) => (
            <button
              aria-label={`Open Exercise ${number}`}
              className={`exercise-state-${exerciseVisualStatus(number, task, resource)} ${number === exercise ? "current" : ""}`}
              key={number}
              onClick={() => openExercise(number)}
              title={`Exercise ${number} · ${exerciseVisualStatus(number, task, resource).replaceAll("-", " ")}`}
              type="button"
            >
              {number}
            </button>
          ))}
        </nav>
        {bulkKind ? (
          <section className="exerciseQaBulkEditor">
            <header>
              <div>
                <strong>{bulkKind === "exercise_solution" ? "Tutor answers" : "My solutions"} for the whole chapter</strong>
                <small>Paste once. Headings such as “## Exercise 6.6” are mapped automatically; shared headings can name several exercises.</small>
              </div>
            </header>
            <DiscussionMarkdownSurface
              contentType="markdown"
              editable
              markdown={bulkDraft}
              onCancel={() => setBulkKind(null)}
              onChange={setBulkDraft}
              onSave={(markdown) => importSolutions(markdown, bulkKind)}
              placeholder={`Paste ${bulkKind === "exercise_solution" ? "the tutor response" : "your solutions"} with Exercise n.m headings…`}
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
                <div><span>{activeIndex + 1} of {sessionNumbers.length}</span><h2>Exercise {exercise}</h2></div>
                <div className="exerciseQaStateButtons">
                  <button className={progress[exercise] === "later" ? "later active" : "later"} onClick={() => setStatus("later")} type="button"><Clock3 size={14} /> Review later</button>
                  <button className={progress[exercise] === "understood" ? "understood active" : "understood"} onClick={() => setStatus("understood")} type="button"><CheckCircle2 size={14} /> Understood</button>
                  <button className={progress[exercise] === "skipped" ? "skipped active" : "skipped"} onClick={() => setStatus("skipped")} type="button"><FastForward size={14} /> Skip</button>
                </div>
              </header>
              {importMessage ? <p className="exerciseQaImportMessage">{importMessage}</p> : null}
              <section className="exerciseQaAnswerGroup mine">
                <h3>My solution</h3>
                {mySolutions.map((note, index) => (
                  <EntityNoteEditor
                    defaultEditing
                    defaultOpen
                    deleteLabel="Delete my solution fully"
                    key={`${note.id}:${note.revision}`}
                    label={`My solution${mySolutions.length > 1 ? ` ${index + 1}` : ""}`}
                    note={note}
                    onDelete={onNoteDelete}
                    onSave={(markdown) => saveSolution(note, markdown, "exercise_my_solution")}
                    placeholder="Solve the exercise here; formulas and highlights are preserved…"
                    showDeleteInSummary
                  />
                ))}
                {!mySolutions.length ? (
                  <EntityNoteEditor
                    defaultEditing
                    defaultOpen
                    key={`my:${exercise}`}
                    label="Add my solution"
                    onSave={(markdown) => saveSolution(undefined, markdown, "exercise_my_solution")}
                    placeholder="Write your solution for this exercise…"
                  />
                ) : null}
              </section>
              <section className="exerciseQaAnswerGroup tutor">
                <h3>Tutor answers</h3>
                {answers.map((note, index) => (
                  <EntityNoteEditor
                    defaultEditing
                    defaultOpen
                    deleteLabel="Delete response fully"
                    key={`${note.id}:${note.revision}`}
                    label={`Tutor answer${answers.length > 1 ? ` ${index + 1}` : ""}`}
                    note={note}
                    onDelete={onNoteDelete}
                    onSave={(markdown) => saveSolution(note, markdown, "exercise_solution")}
                    placeholder="Edit the tutor solution, formulas, or useful highlights…"
                    showDeleteInSummary
                  />
                ))}
                {!answers.length ? (
                  <EntityNoteEditor
                    defaultEditing
                    defaultOpen
                    key={`tutor:${exercise}`}
                    label="Add tutor answer"
                    onSave={(markdown) => saveSolution(undefined, markdown, "exercise_solution")}
                    placeholder="Paste or write the tutor solution for this exercise…"
                  />
                ) : null}
              </section>
            </section>
          </div>
        ) : <div className="exerciseQaEmpty">Collect or map chapter exercises first.</div>}
        <footer className="exerciseQaNav">
          <button disabled={activeIndex === 0} onClick={() => setActiveIndex(activeIndex - 1)} type="button"><ArrowLeft size={16} /> Previous</button>
          <span>Exercise {exercise ?? "—"} · {exercise ? progress[exercise] ?? "unreviewed" : "unreviewed"}</span>
          <button disabled={activeIndex >= sessionNumbers.length - 1} onClick={() => setActiveIndex(activeIndex + 1)} type="button">Next <ArrowRight size={16} /></button>
        </footer>
      </main>
    </div>,
    document.body,
  );
}
