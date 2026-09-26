import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  BookMarked,
  BookOpen,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Clock3,
  FileScan,
  FileQuestion,
  Images,
  Flag,
  FolderOpen,
  Highlighter,
  Info,
  Link2,
  MessageCircleQuestion,
  MessageSquareText,
  NotebookPen,
  RotateCcw,
  Send,
  Sparkles,
  Settings2,
  Timer,
  X,
} from "lucide-react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { DayCompletionParade } from "../../components/rewards/DayCompletionParade";
import { PetCelebration } from "../../components/rewards/PetCelebration";
import { AnnotationChapterGroups } from "../../components/annotations/AnnotationChapterGroups";
import {
  annotationChapterNumber,
  annotationContextGroupId,
  annotationMetadata,
} from "../../components/annotations/annotationDisplay";
import {
  InlineCaptureEditor,
  type ResourceCaptureInput,
} from "../../components/annotations/InlineCaptureEditor";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { TodoProgressBadge } from "../../components/TodoProgressBadge";
import { ProgressBar } from "../../components/ProgressBar";
import { BookChapterProgress } from "../../components/resources/BookChapterProgress";
import { BookExerciseProgress } from "../../components/resources/BookExerciseProgress";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import { petCelebrationDuration } from "../../config/petCelebrations";
import { statusTone } from "../../lib/progress";
import {
  combinedExerciseReviewStatus,
  exerciseNumbersForTask,
  exerciseNumbersInText,
  exerciseReviewCounts,
  parseExerciseReviewProgress,
  type ExerciseReviewProgress,
} from "../../lib/exerciseReview";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  EntityNoteSaveInput,
  ExamQuestion,
  Resource,
  ResourceChapterStatus,
  Skill,
  StudyDay,
  Task,
  TaskStatus,
} from "../../types/tracker";
import {
  dayEstimatedMinutes,
  dayOptionalMinutes,
  dayVisibleSections,
  dayTasks,
  dayRemainingWork,
  dayTone,
  dayToneLabel,
  formatPlannedTime,
  formatTrackedTime,
  isDayClosed,
  isDayFullyComplete,
} from "./dayPresentation";
import { ExerciseQaReview } from "./ExerciseQaReview";
import { TaskAdministration } from "./TaskAdministration";
import "./task-flow.css";

type RoadmapViewProps = {
  onPlanChanged: () => Promise<void>;
  activeDayId: string;
  course: Course;
  onActiveDayChange: (dayId: string) => void;
  onAnnotationChange: (
    annotation: Annotation,
    changes: {
      kind?: AnnotationKind;
      status?: AnnotationStatus;
      postponed?: boolean;
      skipped?: boolean;
    },
  ) => void;
  onCollectPdfAnnotations: (resourceId: string) => void;
  onExportToZotero: (resourceId: string) => void;
  onCreateCapture: (resourceId: string, input: ResourceCaptureInput) => void;
  onImportMaccyImages: (
    resourceId: string,
    taskId: string,
    count: number,
  ) => void;
  onChapterProgressChange: (
    resource: Resource,
    chapter: Resource["chapters"][number],
    status: ResourceChapterStatus,
  ) => void;
  onDayClosedChange: (day: StudyDay, closed: boolean) => void;
  onExerciseProgressChange: (
    resource: Resource,
    exercise: string,
    status: ResourceChapterStatus,
  ) => void;
  onExerciseReviewChange: (task: Task, progress: ExerciseReviewProgress) => void;
  onDayNoteSave: (day: StudyDay, noteHtml: string) => void | boolean | Promise<void | boolean>;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onNoteDelete: (note: Task["notes"][number]) => void;
  onNoteAttentionChange: (
    note: NonNullable<Task["notes"][number]>,
    attention: NonNullable<Task["notes"][number]>["attention"],
  ) => void;
  onOpenDiscussion: (resourceId: string, taskId?: string) => void;
  onCopyNextQuestions: (dayId: string, task: Task) => void;
  onOpenTaskQa: (dayId: string, task: Task) => void;
  onCopyTask: (dayId: string, task: Task) => void;
  onCopyTaskWithNotes: (dayId: string, task: Task) => void;
  onInsertTaskReview: (dayId: string, task: Task) => void;
  onOpenResource: (resourceId: string) => void;
  onPrepareExerciseScreenshots: (task: Task) => void;
  onUploadImageQuestions: (
    resourceId: string,
    taskId: string,
    files: File[],
  ) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
  onToggleTaskTimer: (day: StudyDay, task: Task, resources: Resource[]) => void;
  taskTimer: {
    activeTaskId?: string | null;
    busy: boolean;
    configured: boolean;
    error: string;
    online: boolean;
    trackedSecondsByTask: Record<string, number>;
  };
};

type TaskRowProps = {
  dayId: string;
  discussionQuestionIds: Set<string>;
  examQuestionById: Map<string, ExamQuestion>;
  resourceById: Map<string, Resource>;
  task: Task;
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onCollectPdfAnnotations: RoadmapViewProps["onCollectPdfAnnotations"];
  onExportToZotero: RoadmapViewProps["onExportToZotero"];
  onChapterProgressChange: RoadmapViewProps["onChapterProgressChange"];
  onCreateCapture: RoadmapViewProps["onCreateCapture"];
  onImportMaccyImages: RoadmapViewProps["onImportMaccyImages"];
  onExerciseProgressChange: RoadmapViewProps["onExerciseProgressChange"];
  onExerciseReviewChange: RoadmapViewProps["onExerciseReviewChange"];
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onNoteDelete: RoadmapViewProps["onNoteDelete"];
  onNoteAttentionChange: RoadmapViewProps["onNoteAttentionChange"];
  onOpenDiscussion: RoadmapViewProps["onOpenDiscussion"];
  onCopyNextQuestions: RoadmapViewProps["onCopyNextQuestions"];
  onOpenTaskQa: RoadmapViewProps["onOpenTaskQa"];
  onCopyTask: RoadmapViewProps["onCopyTask"];
  onCopyTaskWithNotes: RoadmapViewProps["onCopyTaskWithNotes"];
  onInsertTaskReview: RoadmapViewProps["onInsertTaskReview"];
  onOpenResource: (resourceId: string) => void;
  onPrepareExerciseScreenshots: RoadmapViewProps["onPrepareExerciseScreenshots"];
  onUploadImageQuestions: RoadmapViewProps["onUploadImageQuestions"];
  onStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
  onToggleTimer: () => void;
  timer: {
    active: boolean;
    busy: boolean;
    configured: boolean;
    error: string;
    online: boolean;
    trackedSeconds: number;
  };
};

function taskTimerText(task: Task, trackedSeconds: number): string {
  const actualMinutes = Math.max(1, Math.round(trackedSeconds / 60));
  if (task.status === "done") {
    return trackedSeconds > 0 ? `${actualMinutes}m` : "—";
  }
  if (task.estimatedMinutes) {
    return trackedSeconds > 0
      ? `${actualMinutes}/${task.estimatedMinutes}m`
      : `${task.estimatedMinutes}m`;
  }
  return trackedSeconds > 0 ? `${actualMinutes}m` : "Time";
}

function TaskRow({
  dayId,
  discussionQuestionIds,
  examQuestionById,
  resourceById,
  task,
  onAnnotationChange,
  onCollectPdfAnnotations,
  onExportToZotero,
  onChapterProgressChange,
  onCreateCapture,
  onImportMaccyImages,
  onExerciseProgressChange,
  onExerciseReviewChange,
  onNoteSave,
  onNoteDelete,
  onNoteAttentionChange,
  onOpenDiscussion,
  onCopyNextQuestions,
  onOpenTaskQa,
  onCopyTask,
  onCopyTaskWithNotes,
  onInsertTaskReview,
  onOpenResource,
  onPrepareExerciseScreenshots,
  onUploadImageQuestions,
  onStatusChange,
  onToggleTimer,
  timer,
}: TaskRowProps) {
  const [noteDirty, setNoteDirty] = useState(false);
  const reward = useCompletionReward();
  const celebrateTask = reward.celebrate;
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [compactDetailsOpen, setCompactDetailsOpen] = useState(false);
  const [quickCaptureResourceId, setQuickCaptureResourceId] = useState("");
  const [paperNoteResourceId, setPaperNoteResourceId] = useState("");
  const [exerciseQaOpen, setExerciseQaOpen] = useState(false);
  const [armedMaccyResourceId, setArmedMaccyResourceId] = useState("");
  const completed = task.status === "done";
  const linkedResources = task.resourceIds
    .map((resourceId) => resourceById.get(resourceId))
    .filter((resource): resource is Resource => Boolean(resource));
  const paperNoteResource = linkedResources.find(
    (resource) => resource.id === paperNoteResourceId && resource.kind === "paper",
  );
  const paperNote = paperNoteResource?.notes.find((note) => note.kind === "resource");
  const linkedQuestions = task.examQuestionIds
    .map((questionId) => examQuestionById.get(questionId))
    .filter((question): question is ExamQuestion => Boolean(question));
  const captures = linkedResources
    .flatMap((resource) =>
      resource.annotations.map((annotation) => ({ annotation, resource })),
    )
    .filter(({ annotation }) => annotation.status !== "archived")
    .sort((left, right) => {
      const leftQuestion =
        ["question", "todo"].includes(left.annotation.kind) &&
        left.annotation.status === "open" &&
        !left.annotation.postponed &&
        !left.annotation.skipped;
      const rightQuestion =
        ["question", "todo"].includes(right.annotation.kind) &&
        right.annotation.status === "open" &&
        !right.annotation.postponed &&
        !right.annotation.skipped;
      if (leftQuestion !== rightQuestion) return leftQuestion ? -1 : 1;
      return left.annotation.createdAt.localeCompare(right.annotation.createdAt);
    });
  const taskCaptures = captures.filter((capture) =>
    isCaptureRelevantToTask(capture, dayId, task.resourceChapterNumbers?.[capture.resource.id] ?? task.chapterNumbers),
  );
  const nextTaskQuestions = taskCaptures.filter(
    ({ annotation }) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open" &&
      !annotation.postponed &&
      !annotation.skipped &&
      (annotation.discussionResponseCount ?? 0) === 0,
  );
  const copiedUnansweredCount = nextTaskQuestions.filter(({ annotation }) =>
    discussionQuestionIds.has(annotation.id),
  ).length;
  const mappedTaskQuestions = taskCaptures.filter(
    ({ annotation }) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status !== "archived" &&
      (annotation.discussionResponseCount ?? 0) > 0,
  );
  const taskResourceNotes = taskCaptures.filter(
    ({ annotation }) => {
      if (annotation.kind !== "note") return false;
      const metadata = annotationMetadata(annotation);
      const createdDayId = metadata.createdDayId;
      const createdTaskId = metadata.createdTaskId ?? metadata.sourceTaskId;
      return (
        (typeof createdDayId !== "string" || createdDayId === dayId) &&
        (typeof createdTaskId !== "string" || createdTaskId === task.id)
      );
    },
  );
  const taskOpenQuestionCount = task.openQuestionCount;
  const taskNote = task.notes.find((note) => note.kind === "task");
  const exerciseSolutionNotes = task.notes.filter(
    (note) => note.kind === "exercise_solution",
  );
  const exerciseSolutionGroups = [...exerciseSolutionNotes.reduce((groups, note) => {
    const markdown = note.document.markdown ?? note.document.plainText;
    const label = markdown.match(/^#\s+(.+)$/m)?.[1] ?? "Exercise material";
    const current = groups.get(label) ?? [];
    current.push(note);
    groups.set(label, current);
    return groups;
  }, new Map<string, typeof exerciseSolutionNotes>()).entries()];
  const exerciseNumbers =
    task.title.toLowerCase().includes("exercise")
      ? [...task.title.matchAll(/\b(\d+\.\d+)\b/g)].map((match) => match[1])
      : [];
  const exerciseReview = parseExerciseReviewProgress(
    task.notes.find((note) => note.kind === "exercise_review"),
  );
  const exerciseAnswerNumbers = [...new Set(
    exerciseSolutionNotes.flatMap((note) =>
      [...(note.document.markdown ?? note.document.plainText).matchAll(
        /\bExercise\s+(\d+(?:\.\d+)+)\b/gi,
      )].map((match) => match[1]),
    ),
  )].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const exerciseBook = linkedResources.find((resource) => resource.kind === "book");
  const chapterExerciseNumbers = exerciseBook
    ? exerciseNumbersForTask(task, exerciseBook)
    : exerciseAnswerNumbers;
  const exerciseStats = exerciseReviewCounts(
    chapterExerciseNumbers,
    exerciseNumbers,
    exerciseReview,
  );
  const previousTaskOpenQuestionCount = useRef(taskOpenQuestionCount);
  const shouldCompact = completed && taskOpenQuestionCount === 0;
  const showTaskDetails = !shouldCompact || compactDetailsOpen;

  useEffect(() => {
    const previous = previousTaskOpenQuestionCount.current;
    previousTaskOpenQuestionCount.current = taskOpenQuestionCount;
    if (completed && previous > 0 && taskOpenQuestionCount === 0) {
      const frame = window.requestAnimationFrame(() =>
        celebrateTask(petCelebrationDuration("task")),
      );
      return () => window.cancelAnimationFrame(frame);
    }
  }, [celebrateTask, completed, taskOpenQuestionCount]);

  function toggleDone() {
    const nextStatus = task.status === "done" ? "todo" : "done";
    if (nextStatus === "done") {
      reward.celebrate(petCelebrationDuration("task"));
      if (timer.active) onToggleTimer();
    }
    onStatusChange(dayId, task.id, nextStatus);
  }

  function toggleLater() {
    onStatusChange(dayId, task.id, task.status === "later" ? "todo" : "later");
  }

  function toggleSkipped() {
    onStatusChange(dayId, task.id, task.status === "skipped" ? "todo" : "skipped");
  }

  return (
    <article
      className={`taskRow tone-${statusTone(task.status)} ${taskOpenQuestionCount ? "hasQuestions" : ""} ${shouldCompact && !showTaskDetails ? "isCompactDone" : ""} ${timer.active ? "isCurrentTask" : ""} ${reward.active ? "taskCelebrated" : ""}`}
      data-status={task.status}
      data-task-id={task.id}
    >
      <PetCelebration token={reward.token} variant="task" />
      <button
        className="taskStatus"
        aria-label={task.status === "done" ? "Mark task incomplete" : "Mark task complete"}
        onClick={toggleDone}
        title={task.status === "done" ? "Mark incomplete" : "Complete task"}
        type="button"
      >
        {completed ? <CheckCircle2 size={19} /> : <Circle size={19} />}
        <CompletionBurst token={reward.token} />
      </button>
      <div className="taskBody">
        <div className="taskTitleRow">
          <h3 title={task.title}>{task.title}</h3>
          <div className="taskTools">
          <div className="taskBadges taskFacts">
            {task.isOptional ? <span className="taskMetaBadge">Optional</span> : null}
            {task.taskType ? <span className="taskMetaBadge">{task.taskType}</span> : null}
            <button
              aria-label={timer.active ? "Stop task timer" : "Start task timer"}
              className={`taskMetaBadge taskTimerBadge ${timer.active ? "active" : ""}`}
              disabled={(completed && !timer.active) || timer.busy || !timer.online || !timer.configured}
              onClick={onToggleTimer}
              title={
                completed && !timer.active
                  ? timer.trackedSeconds > 0
                    ? "Actual tracked time for this completed task"
                    : "No task-specific time was recorded"
                  : timer.error ||
                (!timer.online
                  ? "Start the tracker API to enable timing"
                  : !timer.configured
                    ? "Configure Toggl to enable timing"
                    : timer.active
                      ? "Stop timing this task"
                      : "Start timing this task")
              }
              type="button"
            >
              <Timer size={11} /> {taskTimerText(task, timer.trackedSeconds)}
            </button>
            <TodoProgressBadge counts={task.todoCounts} compact />
            {taskOpenQuestionCount - (task.todoCounts?.open ?? 0) > 0 ? (
              <span
                className="taskMetaBadge question"
                title="Open questions scoped to this task/chapter"
              >
                <CircleHelp size={11} /> {taskOpenQuestionCount - (task.todoCounts?.open ?? 0)}
              </span>
            ) : null}
          </div>
          <div className="taskBadges taskStudyActions" role="group" aria-label={`Study actions for ${task.title}`}>
            <button className="taskMetaBadge taskTutorAction taskIconAction" disabled={noteDirty} aria-label="Copy for tutor"
              data-track="task.copy" onClick={() => onCopyTask(dayId, task)}
              title={noteDirty ? "Save the task note before copying" : "Copy for tutor · choose note sections and preview"} type="button">
              <Copy size={12}/>
            </button>
            {taskResourceNotes.length ? (
              <button className="taskMetaBadge taskTutorAction taskIconAction" disabled={noteDirty} aria-label={`Copy with ${taskResourceNotes.length} resource notes`}
                data-track="task.copy-notes" onClick={() => onCopyTaskWithNotes(dayId, task)}
                title={noteDirty ? "Save the task note before copying" : "Copy the task with linked questions and resource notes, including their screenshots"} type="button">
                <NotebookPen size={12}/>
              </button>
            ) : null}
            <button className="taskMetaBadge taskTutorAction taskIconAction" disabled={noteDirty} aria-label="Import review"
              data-track="task.import" onClick={() => onInsertTaskReview(dayId, task)}
              title={noteDirty ? "Save the task note before inserting a review" : "Import tutor review and open Q&A"} type="button">
              <ClipboardPaste size={12}/>
            </button>
            {nextTaskQuestions.length ? (
              <button
                className="taskMetaBadge copyNextQuestions"
                aria-label={`Copy next ${nextTaskQuestions.length} questions`}
                data-track="task.next" onClick={() => onCopyNextQuestions(dayId, task)}
                title={
                  copiedUnansweredCount
                    ? `Copy unanswered questions again with the same stable IDs (${copiedUnansweredCount} already copied)`
                    : "Copy this task's next unanswered questions into its existing day discussion"
                }
                type="button"
              >
                <Copy size={11} /> Next {nextTaskQuestions.length}
              </button>
            ) : null}
            {mappedTaskQuestions.length || taskNote?.document.markdown?.includes("<!-- tutor-review:") ? (
              <button
                className="taskMetaBadge taskQaLaunch"
                data-track="task.qa" onClick={() => onOpenTaskQa(dayId, task)}
                title="Review only tutor answers mapped to this task"
                type="button"
              >
                <Sparkles size={11} /> Q&A {mappedTaskQuestions.length || ""}
              </button>
            ) : null}
            {linkedResources
              .filter((resource) => resource.kind === "book")
              .map((resource) => (
                <BookChapterProgress
                  compact
                  key={resource.id}
                  onChange={onChapterProgressChange}
                  preferredChapterNumbers={task.resourceChapterNumbers?.[resource.id] ?? task.chapterNumbers}
                  resource={resource}
                />
              ))}
            {linkedResources
              .filter((resource) => resource.kind === "book")
              .map((resource) => (
                <BookExerciseProgress
                  key={`exercises:${resource.id}`}
                  onChange={onExerciseProgressChange}
                  resource={resource}
                  task={task}
                />
              ))}
            {task.status === "later" ? (
              <span className="taskStateLabel later"><Clock3 size={11} /> Later</span>
            ) : null}
            {task.status === "skipped" ? (
              <span className="taskStateLabel skipped"><X size={11} /> Skipped</span>
            ) : null}
            {task.rationale?.plainText ? (
              <button
                aria-expanded={rationaleOpen}
                className={`taskMetaBadge taskRationaleToggle taskIconAction ${rationaleOpen ? "active" : ""}`}
                aria-label="Why this task"
                title="Why this task"
                onClick={() => setRationaleOpen((current) => !current)}
                type="button"
              >
                <Info size={12} />
              </button>
            ) : null}
            {exerciseNumbers.length ? (
              <button
                className="taskMetaBadge exerciseScreenshots taskIconAction"
                aria-label="Screenshot exercise solutions"
                onClick={() => onPrepareExerciseScreenshots(task)}
                title={`Render grouped handwritten solutions from the chapter containing Exercises ${exerciseNumbers.join(", ")} into the ChatGPT attachment folder`}
                type="button"
              >
                <Images size={12} />
              </button>
            ) : null}
            {exerciseNumbers.length && exerciseBook ? (
              <button
                className="taskMetaBadge exerciseQaLaunch"
                onClick={() => setExerciseQaOpen(true)}
                title={`Review book exercises · ${exerciseStats.requiredReviewed}/${exerciseStats.requiredTotal} required · ${exerciseStats.totalReviewed}/${exerciseStats.total} chapter`}
                type="button"
              >
                <Sparkles size={11} /> Exercises {exerciseStats.requiredReviewed}/{exerciseStats.requiredTotal}
              </button>
            ) : null}
            {shouldCompact ? (
              <button
                aria-expanded={showTaskDetails}
                className="taskMetaBadge compactTaskToggle"
                onClick={() => setCompactDetailsOpen((current) => !current)}
                title={showTaskDetails ? "Hide completed task details" : "Show completed task details"}
                type="button"
              >
                <ChevronDown className={showTaskDetails ? "expanded" : ""} size={11} />
                {showTaskDetails ? "Less" : "Details"}
              </button>
            ) : null}
          </div>
          </div>
        </div>
        {showTaskDetails ? (
          <>
        {task.rationale?.plainText && rationaleOpen ? (
          <div className="taskRationale">
            <MarkdownMath>
              {task.rationale.markdown ?? task.rationale.plainText}
            </MarkdownMath>
          </div>
        ) : null}
        {linkedResources.length || linkedQuestions.length ? (
          <div className="taskLinks">
            {linkedResources.map((resource) => (
              <span className="taskResourceActions" key={resource.id}>
                <button
                  className={`taskLink resource-${resource.status}`}
                  onClick={() => onOpenResource(resource.id)}
                  title={resource.version?.localPath ?? resource.title}
                  type="button"
                >
                  <BookOpen size={12} />
                  {resource.title}
                </button>
                {resource.canonicalUrl ? (
                  <a
                    className="taskLinkIcon"
                    href={resource.canonicalUrl}
                    rel="noreferrer"
                    target="_blank"
                    title={`Open information page for ${resource.title}`}
                  >
                    <Link2 size={12} />
                  </a>
                ) : null}
                <button
                  className="taskLinkIcon"
                  onClick={() => onOpenResource(resource.id)}
                  title={`Open ${resource.title}`}
                  type="button"
                >
                  <FolderOpen size={12} />
                </button>
                <button
                  className="taskLinkIcon"
                  onClick={() => onOpenDiscussion(resource.id, task.id)}
                  title={`Open discussion for ${resource.title}`}
                  type="button"
                >
                  <MessageSquareText size={12} />
                </button>
                {resource.kind === "paper" ? (
                  <button
                    aria-pressed={paperNoteResourceId === resource.id}
                    className={`taskLinkIcon paperNote ${paperNoteResourceId === resource.id ? "active" : ""}`}
                    onClick={() =>
                      setPaperNoteResourceId((current) =>
                        current === resource.id ? "" : resource.id,
                      )
                    }
                    title={`Edit the final paper note for ${resource.title}`}
                    type="button"
                  >
                    <NotebookPen size={12} />
                  </button>
                ) : null}
                {resource.kind === "paper" ? (
                  <button
                    className="taskLinkIcon zotero"
                    disabled={
                      !["read", "review"].includes(resource.status) ||
                      !resource.notes
                        .find((note) => note.kind === "resource")
                        ?.document.plainText.trim()
                    }
                    onClick={() => onExportToZotero(resource.id)}
                    title={
                      !["read", "review"].includes(resource.status)
                        ? "Mark the paper read before saving it to Zotero"
                        : !resource.notes
                            .find((note) => note.kind === "resource")
                            ?.document.plainText.trim()
                          ? "Save the final paper note before sending it to Zotero"
                          : "Approve the final note and save this paper to Zotero"
                    }
                    type="button"
                  >
                    <Send size={12} />
                  </button>
                ) : null}
                <button
                  className="taskLinkIcon"
                  onClick={() =>
                    setQuickCaptureResourceId((current) =>
                      current === resource.id ? "" : resource.id,
                    )
                  }
                  title={`Add a question about ${resource.title}`}
                  type="button"
                >
                  <MessageCircleQuestion size={12} />
                </button>
                <button
                  aria-label={`Choose how many recent Maccy pictures to load for ${resource.title}`}
                  className={`taskLinkIcon lectureNoteImport ${armedMaccyResourceId === resource.id ? "armed" : ""}`}
                  onBlur={() => setArmedMaccyResourceId("")}
                  onClick={() => setArmedMaccyResourceId(resource.id)}
                  onKeyDown={(event) => {
                    if (armedMaccyResourceId !== resource.id) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setArmedMaccyResourceId("");
                      event.currentTarget.blur();
                      return;
                    }
                    if (!/^[1-9]$/.test(event.key)) return;
                    event.preventDefault();
                    onImportMaccyImages(resource.id, task.id, Number(event.key));
                    setArmedMaccyResourceId("");
                    event.currentTarget.blur();
                  }}
                  title={`Click, then press 1–9 to load that many recent Maccy pictures for ${resource.title}`}
                  type="button"
                >
                  <ClipboardPaste size={12} />
                </button>
                <label
                  className="taskLinkIcon lectureNoteImport"
                  title={`Choose lecture-note pictures for ${resource.title}`}
                >
                  <Images size={12} />
                  <input
                    accept="image/png,image/jpeg,image/tiff,image/heic,image/heif"
                    className="lectureNoteFileInput"
                    hidden
                    multiple
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      if (files.length) {
                        onUploadImageQuestions(resource.id, task.id, files);
                      }
                    }}
                    type="file"
                  />
                </label>
                {resource.version?.localPath?.toLowerCase().endsWith(".pdf") ||
                resource.localFiles.some((file) =>
                  file.localPath.toLowerCase().endsWith(".pdf"),
                ) ? (
                  <button
                    className="taskLinkIcon collect"
                    onClick={() => onCollectPdfAnnotations(resource.id)}
                    title={`Collect PDF captures from ${resource.title}`}
                    type="button"
                  >
                    <FileScan size={12} />
                  </button>
                ) : null}
              </span>
            ))}
            {linkedQuestions.map((question) => {
              const questionResource = resourceById.get(question.id);
              const sourceResourceId = questionResource?.parentResourceId ?? question.id;
              return (
                <span className="taskResourceActions" key={question.id}>
                  <button
                    className="taskLink exam"
                    onClick={() => onOpenResource(sourceResourceId)}
                    type="button"
                  >
                    <FileQuestion size={12} />
                    {question.label}{question.topic ? ` · ${question.topic}` : ""}
                  </button>
                  <button
                    className="taskLinkIcon"
                    onClick={() => onOpenDiscussion(sourceResourceId, task.id)}
                    title={`Open discussion for ${question.label}`}
                    type="button"
                  >
                    <MessageSquareText size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
        {paperNoteResource ? (
          <div className="taskPaperNote">
            <div className="taskPaperNoteHeader">
              <div>
                <NotebookPen size={14} />
                <strong>{paperNoteResource.title}</strong>
                <span>Only this resource note is sent to Zotero.</span>
              </div>
              <button
                className="commandButton subtle"
                disabled={
                  !["read", "review"].includes(paperNoteResource.status) ||
                  !paperNote?.document.plainText.trim()
                }
                onClick={() => onExportToZotero(paperNoteResource.id)}
                type="button"
              >
                <Send size={14} /> Approve note &amp; save to Zotero
              </button>
            </div>
            <EntityNoteEditor
              defaultOpen
              key={`${paperNote?.id ?? paperNoteResource.id}:${paperNote?.revision ?? 0}`}
              label="Paper note"
              note={paperNote}
              onSave={(markdown) =>
                onNoteSave({
                  entityId: paperNoteResource.id,
                  entityType: "resource",
                  html: markdown,
                  kind: "resource",
                  note: paperNote,
                })
              }
              placeholder="Your final summary, critique, and useful takeaways from this paper…"
            />
          </div>
        ) : null}
        {quickCaptureResourceId ? (
          <InlineCaptureEditor
            compact
            initialKind="question"
            onCancel={() => setQuickCaptureResourceId("")}
            onSubmit={(input) => {
              onCreateCapture(quickCaptureResourceId, input);
              setQuickCaptureResourceId("");
            }}
            resourceTitle={resourceById.get(quickCaptureResourceId)?.title ?? "resource"}
          />
        ) : null}
        {captures.length ? (
          <TaskCapturePanel
            captures={captures}
            chapterNumbers={task.chapterNumbers}
            resourceChapterNumbers={task.resourceChapterNumbers}
            dayId={dayId}
            onAnnotationChange={onAnnotationChange}
            onNoteSave={onNoteSave}
            onOpenDiscussion={(resourceId) =>
              onOpenDiscussion(resourceId, task.id)
            }
            onOpenResource={onOpenResource}
          />
        ) : null}
        {exerciseSolutionNotes.length ? (
          <details className="taskExerciseSolutions">
            <summary>
              <BookMarked size={14} />
              <span>Tutor exercise material</span>
              <strong>{exerciseSolutionNotes.length}</strong>
            </summary>
            <div className="taskExerciseSolutionList">
              {exerciseSolutionGroups.map(([label, notes]) => {
                const mappedExercises = exerciseNumbersInText(label);
                const reviewStatus = combinedExerciseReviewStatus(
                  mappedExercises,
                  exerciseReview,
                );
                return (
                <details
                  className={`taskExerciseSolution review-${reviewStatus}`}
                  key={label}
                >
                  <summary>
                    <span>{label}</span>
                    <small>
                      {reviewStatus === "unreviewed" ? "new" : reviewStatus} · {notes.length} tutor answer{notes.length === 1 ? "" : "s"}
                    </small>
                  </summary>
                  <div className="taskExerciseAnswerStack">
                    {notes.map((note, index) => (
                      <EntityNoteEditor
                        deleteLabel="Unlink from task"
                        key={`${note.id}:${note.revision}`}
                        label={notes.length > 1 ? `Answer ${index + 1}` : "Tutor answer"}
                        note={note}
                        onDelete={onNoteDelete}
                        onSave={(html) =>
                          onNoteSave({
                            entityId: task.id,
                            entityType: "task",
                            html,
                            kind: "exercise_solution",
                            note,
                          })
                        }
                        placeholder="Edit this tutor solution or highlight the useful parts…"
                      />
                    ))}
                  </div>
                </details>
                );
              })}
            </div>
          </details>
        ) : null}
        {exerciseQaOpen && exerciseBook ? (
          <ExerciseQaReview
            onChange={(progress) => onExerciseReviewChange(task, progress)}
            onClose={() => setExerciseQaOpen(false)}
            onNoteDelete={onNoteDelete}
            onNoteSave={onNoteSave}
            resource={exerciseBook}
            task={task}
          />
        ) : null}
        <EntityNoteEditor
          key={`${taskNote?.id ?? task.id}:${taskNote?.revision ?? 0}`}
          label="Task note"
          onDirtyChange={setNoteDirty}
          note={taskNote}
          onAttentionChange={onNoteAttentionChange}
          onSave={(html) =>
            onNoteSave({
              entityId: task.id,
              entityType: "task",
              html,
              kind: "task",
              note: taskNote,
            })
          }
          placeholder="Question, answer, implementation detail, or reminder..."
        />
          </>
        ) : null}
      </div>
      {showTaskDetails ? (
      <div className="taskActions" aria-label={`Actions for ${task.title}`}>
        <button
          aria-label={task.status === "later" ? "Return task to to-do" : "Do task later"}
          className={task.status === "later" ? "taskActionButton later active" : "taskActionButton later"}
          onClick={toggleLater}
          title={task.status === "later" ? "Return task to open work" : "Save task for later"}
          type="button"
        >
          <Clock3 size={15} />
          <span className="srOnly">{task.status === "later" ? "Later" : "Do later"}</span>
        </button>
        <button
          aria-label={task.status === "skipped" ? "Return skipped task to to-do" : "Skip task"}
          className={task.status === "skipped" ? "taskActionButton skipped active" : "taskActionButton skipped"}
          onClick={toggleSkipped}
          title={task.status === "skipped" ? "Return task to open work" : "Skip this task"}
          type="button"
        >
          <X size={15} />
          <span className="srOnly">{task.status === "skipped" ? "Skipped" : "Skip"}</span>
        </button>
      </div>
      ) : null}
    </article>
  );
}

function isCaptureRelevantToTask(
  {
    annotation,
    resource,
  }: { annotation: Annotation; resource: Resource },
  dayId: string,
  chapterNumbers: number[],
): boolean {
  if (resource.kind !== "book") return true;
  if (annotationMetadata(annotation).createdDayId === dayId) return true;
  const chapterNumber = annotationChapterNumber(annotation);
  return (
    chapterNumbers.length > 0 &&
    chapterNumber !== null &&
    chapterNumbers.includes(chapterNumber)
  );
}

function TaskCapturePanel({
  captures,
  chapterNumbers,
  resourceChapterNumbers,
  dayId,
  onAnnotationChange,
  onNoteSave,
  onOpenDiscussion,
  onOpenResource,
}: {
  captures: Array<{ annotation: Annotation; resource: Resource }>;
  chapterNumbers: number[];
  resourceChapterNumbers?: Record<string, number[]>;
  dayId: string;
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onNoteSave: RoadmapViewProps["onNoteSave"];
  onOpenDiscussion: (resourceId: string) => void;
  onOpenResource: RoadmapViewProps["onOpenResource"];
}) {
  const chapterScope = new Set(chapterNumbers);
  const isRelevantToTask = (capture: {
    annotation: Annotation;
    resource: Resource;
  }) => isCaptureRelevantToTask(capture, dayId, resourceChapterNumbers?.[capture.resource.id] ?? chapterNumbers);
  const taskCaptures = captures.filter(isRelevantToTask);
  const activeQuestions = taskCaptures.filter(
    (capture) =>
      ["question", "todo"].includes(capture.annotation.kind) &&
      capture.annotation.status === "open" &&
      !capture.annotation.postponed &&
      !capture.annotation.skipped,
  );
  const postponedQuestions = taskCaptures.filter(
    ({ annotation }) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open" &&
      annotation.postponed,
  );
  const allQuestions = taskCaptures.filter(({ annotation }) =>
    ["question", "todo"].includes(annotation.kind),
  );
  const logicalQuestionCount = (
    questions: Array<{ annotation: Annotation; resource: Resource }>,
  ) =>
    new Set(
      questions.map(({ annotation, resource }) => {
        const groupId = annotationContextGroupId(annotation);
        return groupId ? `${resource.id}:${groupId}` : annotation.id;
      }),
    ).size;
  const activeQuestionCount = logicalQuestionCount(activeQuestions);
  const postponedQuestionCount = logicalQuestionCount(postponedQuestions);
  const allQuestionCount = logicalQuestionCount(allQuestions);
  const [open, setOpen] = useState(false);
  const [captureFilter, setCaptureFilter] = useState<
    "all" | "active" | "questions" | "later"
  >("all");
  const showingQuestionsOnly =
    captureFilter === "active" && activeQuestions.length > 0;
  const showingPostponedOnly =
    captureFilter === "later" && postponedQuestions.length > 0;
  const showingAllQuestionsOnly =
    captureFilter === "questions" && allQuestions.length > 0;
  const importedCaptures = taskCaptures.filter(({ annotation }) =>
    ["drawboard_cloud", "drawboard_cloud_ink", "pdf_import"].includes(
      annotation.origin,
    ),
  );
  const visibleCaptures = showingQuestionsOnly
    ? activeQuestions
    : showingPostponedOnly
      ? postponedQuestions
      : showingAllQuestionsOnly
        ? allQuestions
        : taskCaptures;
  const manualQuestions = visibleCaptures.filter(
    ({ annotation, resource }) =>
      (resource.kind !== "book" || chapterScope.size === 0) &&
      ["question", "todo"].includes(annotation.kind) &&
      !["drawboard_cloud", "drawboard_cloud_ink", "pdf_import"].includes(
        annotation.origin,
      ),
  );
  const manualQuestionGroups = [
    ...manualQuestions
      .reduce((groups, capture) => {
        const current = groups.get(capture.resource.id) ?? {
          annotations: [] as Annotation[],
          resource: capture.resource,
        };
        current.annotations.push(capture.annotation);
        groups.set(capture.resource.id, current);
        return groups;
      }, new Map<string, { annotations: Annotation[]; resource: Resource }>())
      .values(),
  ];
  const groupedCaptures = visibleCaptures.filter(
    ({ annotation }) =>
      !manualQuestions.some(
        ({ annotation: question }) => question.id === annotation.id,
      ),
  );
  const captureGroups = [
    ...groupedCaptures
      .reduce((groups, capture) => {
        const current = groups.get(capture.resource.id) ?? {
          annotations: [] as Annotation[],
          resource: capture.resource,
        };
        current.annotations.push(capture.annotation);
        groups.set(capture.resource.id, current);
        return groups;
      }, new Map<string, { annotations: Annotation[]; resource: Resource }>())
      .values(),
  ];

  return (
    <section className="taskCapturePanel">
      <div className="taskCaptureToggle">
        <span>
          {activeQuestionCount ? (
            <button
              aria-pressed={showingQuestionsOnly}
              className={`question ${showingQuestionsOnly ? "active" : ""}`}
              onClick={() => {
                setCaptureFilter((current) =>
                  current === "active" ? "all" : "active",
                );
                setOpen(true);
              }}
              title="Show open questions and to-dos"
              type="button"
            >
              <CircleHelp size={12} />
              {activeQuestionCount} open item
              {activeQuestionCount === 1 ? "" : "s"}
            </button>
          ) : null}
          {allQuestionCount ? (
            <button
              aria-pressed={showingAllQuestionsOnly}
              className={`question history ${showingAllQuestionsOnly ? "active" : ""}`}
              onClick={() => {
                setCaptureFilter((current) =>
                  current === "questions" ? "all" : "questions",
                );
                setOpen(true);
              }}
              title="Show every question from this task, including understood and skipped questions"
              type="button"
            >
              <BookMarked size={12} />
              {allQuestionCount} all question{allQuestionCount === 1 ? "" : "s"}
            </button>
          ) : null}
          {postponedQuestionCount ? (
            <button
              aria-pressed={showingPostponedOnly}
              className={`later ${showingPostponedOnly ? "active" : ""}`}
              onClick={() => {
                setCaptureFilter((current) =>
                  current === "later" ? "all" : "later",
                );
                setOpen(true);
              }}
              title="Show only questions saved for later"
              type="button"
            >
              <Clock3 size={12} />
              {postponedQuestionCount} later
            </button>
          ) : null}
          {importedCaptures.length ? (
            <strong className="capture">
              <Highlighter size={12} />
              {importedCaptures.length} PDF capture
              {importedCaptures.length === 1 ? "" : "s"}
            </strong>
          ) : null}
          {!activeQuestionCount &&
          !postponedQuestionCount &&
          !importedCaptures.length ? (
            <strong className="capture">
              <Archive size={12} />
              {taskCaptures.length} capture{taskCaptures.length === 1 ? "" : "s"}
            </strong>
          ) : null}
        </span>
        <button
          aria-expanded={open}
          aria-label={open ? "Hide task captures" : "Show task captures"}
          className="taskCaptureExpand"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <ChevronDown className={open ? "expanded" : ""} size={14} />
        </button>
      </div>
      {open ? (
        <div className="taskCaptureGroupedList">
          {manualQuestionGroups.map(({ annotations, resource }) => (
            <ResourceQuestionShelf
              annotations={annotations}
              initiallyOpen={
                showingQuestionsOnly ||
                showingAllQuestionsOnly ||
                annotations.some((annotation) => annotation.status === "open")
              }
              key={`${resource.id}:${captureFilter}`}
              onAnnotationChange={onAnnotationChange}
              onDiscuss={() => onOpenDiscussion(resource.id)}
              onNoteSave={onNoteSave}
              onOpenResource={() => onOpenResource(resource.id)}
              resource={resource}
            />
          ))}
          {captureGroups.map(({ annotations, resource }) => {
            const relevantQuestions = annotations.filter(
              (annotation) =>
                isRelevantToTask({ annotation, resource }) &&
                ["question", "todo"].includes(annotation.kind) &&
                annotation.status === "open" &&
                !annotation.postponed &&
                !annotation.skipped,
            ).length;
            return (
            <section className="taskCaptureResourceGroup" key={resource.id}>
              <header>
                <button
                  onClick={() => onOpenResource(resource.id)}
                  type="button"
                >
                  <BookOpen size={12} />
                  <span>{resource.title}</span>
                </button>
                <strong>
                  {relevantQuestions ? `${relevantQuestions} Q · ` : ""}
                  {annotations.length}
                </strong>
              </header>
              <AnnotationChapterGroups
                annotations={annotations}
                initiallyExpandCaptures={showingQuestionsOnly || showingPostponedOnly}
                initiallyOpenAll={showingQuestionsOnly || showingPostponedOnly}
                preferredChapterNumbers={
                  resource.kind === "book" ? resourceChapterNumbers?.[resource.id] ?? chapterNumbers : []
                }
                onAnnotationChange={onAnnotationChange}
                onDiscuss={() => onOpenDiscussion(resource.id)}
                onNoteSave={onNoteSave}
              />
            </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function ResourceQuestionShelf({
  annotations,
  initiallyOpen,
  onAnnotationChange,
  onDiscuss,
  onNoteSave,
  onOpenResource,
  resource,
}: {
  annotations: Annotation[];
  initiallyOpen: boolean;
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onDiscuss: () => void;
  onNoteSave: RoadmapViewProps["onNoteSave"];
  onOpenResource: () => void;
  resource: Resource;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <section className="taskQuestionShelf">
      <header>
        <button onClick={onOpenResource} type="button">
          <BookOpen size={12} />
          <span>{resource.title}</span>
        </button>
        <button
          aria-expanded={open}
          aria-label={open ? "Collapse resource questions" : "Expand resource questions"}
          className="taskQuestionShelfToggle"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <strong>{annotations.length}</strong>
          <ChevronDown className={open ? "expanded" : ""} size={13} />
        </button>
      </header>
      {open ? (
        <AnnotationChapterGroups
          annotations={annotations}
          flat
          initiallyExpandCaptures={initiallyOpen}
          onAnnotationChange={onAnnotationChange}
          onDiscuss={onDiscuss}
          onNoteSave={onNoteSave}
        />
      ) : null}
    </section>
  );
}

type DayCardProps = {
  onManageTasks: () => void;
  accent: string;
  day: StudyDay;
  discussionQuestionIds: Set<string>;
  examQuestionById: Map<string, ExamQuestion>;
  resourceById: Map<string, Resource>;
  skillById: Map<string, Skill>;
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onCollectPdfAnnotations: RoadmapViewProps["onCollectPdfAnnotations"];
  onExportToZotero: RoadmapViewProps["onExportToZotero"];
  onChapterProgressChange: RoadmapViewProps["onChapterProgressChange"];
  onCreateCapture: RoadmapViewProps["onCreateCapture"];
  onImportMaccyImages: RoadmapViewProps["onImportMaccyImages"];
  onExerciseProgressChange: RoadmapViewProps["onExerciseProgressChange"];
  onExerciseReviewChange: RoadmapViewProps["onExerciseReviewChange"];
  onDayNoteSave: RoadmapViewProps["onDayNoteSave"];
  onEntityNoteSave: (input: EntityNoteSaveInput) => void;
  onNoteDelete: RoadmapViewProps["onNoteDelete"];
  onNoteAttentionChange: RoadmapViewProps["onNoteAttentionChange"];
  onOpenDiscussion: RoadmapViewProps["onOpenDiscussion"];
  onCopyNextQuestions: RoadmapViewProps["onCopyNextQuestions"];
  onOpenTaskQa: RoadmapViewProps["onOpenTaskQa"];
  onCopyTask: RoadmapViewProps["onCopyTask"];
  onCopyTaskWithNotes: RoadmapViewProps["onCopyTaskWithNotes"];
  onInsertTaskReview: RoadmapViewProps["onInsertTaskReview"];
  onOpenResource: (resourceId: string) => void;
  onPrepareExerciseScreenshots: RoadmapViewProps["onPrepareExerciseScreenshots"];
  onUploadImageQuestions: RoadmapViewProps["onUploadImageQuestions"];
  onClosedChange: (day: StudyDay, closed: boolean) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
  onToggleTaskTimer: RoadmapViewProps["onToggleTaskTimer"];
  taskTimer: RoadmapViewProps["taskTimer"];
};

function DayCard({
  onManageTasks,
  accent,
  day,
  discussionQuestionIds,
  examQuestionById,
  resourceById,
  skillById,
  onAnnotationChange,
  onCollectPdfAnnotations,
  onExportToZotero,
  onChapterProgressChange,
  onCreateCapture,
  onImportMaccyImages,
  onExerciseProgressChange,
  onExerciseReviewChange,
  onDayNoteSave,
  onEntityNoteSave,
  onNoteDelete,
  onNoteAttentionChange,
  onOpenDiscussion,
  onCopyNextQuestions,
  onOpenTaskQa,
  onCopyTask,
  onCopyTaskWithNotes,
  onInsertTaskReview,
  onOpenResource,
  onPrepareExerciseScreenshots,
  onUploadImageQuestions,
  onClosedChange,
  onTaskStatusChange,
  onToggleTaskTimer,
  taskTimer,
}: DayCardProps) {
  const reward = useCompletionReward();
  const tasks = dayTasks(day);
  const remaining = dayRemainingWork(day);
  const plannedMinutes = dayEstimatedMinutes(day);
  const optionalMinutes = dayOptionalMinutes(day);
  const trackedMinutes = day.trackedSeconds / 60;
  const timeRatio = plannedMinutes ? trackedMinutes / plannedMinutes : 0;
  const isClosed = isDayClosed(day);
  const isFullyComplete = isDayFullyComplete(day);
  const shouldCompact = isClosed || isFullyComplete;
  const [compactDetailsOpen, setCompactDetailsOpen] = useState(false);
  const containsCurrentTask = tasks.some(
    (task) => task.id === taskTimer.activeTaskId,
  );
  const showDetails = containsCurrentTask || !shouldCompact || compactDetailsOpen;
  const tone = dayTone(day);
  const stopWhen = day.sections
    .filter((section) => section.title.toLowerCase() === "stop when")
    .flatMap((section) => section.tasks);
  const skills = day.skillIds
    .map((skillId) => skillById.get(skillId))
    .filter((skill): skill is Skill => Boolean(skill));

  function toggleClosed() {
    const nextClosed = !isClosed;
    if (nextClosed) reward.celebrate(petCelebrationDuration("day"));
    onClosedChange(day, nextClosed);
  }

  return (
    <article
      className={`dayCard tone-${tone} ${isFullyComplete ? "isFullyComplete" : ""} ${!showDetails ? "isCompact" : ""} ${reward.active ? "dayCelebrated" : ""}`}
      data-day-id={day.id}
      id={day.id}
    >
      <CompletionBurst token={reward.token} variant="day" />
      <DayCompletionParade
        complete={day.progress.done >= day.progress.required}
        token={reward.token}
      />
      <header className="dayHeader">
        <div className="dayHeaderMain">
          <span className="dayNumber">D{day.number}</span>
          <div>
            <p className="eyebrow">{day.date}</p>
            <h2>{day.title}</h2>
            <p>{day.purpose}</p>
          </div>
        </div>
        <div className="dayHeaderActions">
          <button className="commandButton subtle" type="button" onClick={onManageTasks} aria-label={`Manage tasks for Day ${day.number}`} title="Manage tasks"><Settings2 size={16}/></button>
          <span className={`dayStatePill tone-${tone}`}>
            {tone === "complete" ? <CheckCircle2 size={14} /> : null}
            {tone === "question" ? <CircleHelp size={14} /> : null}
            {tone === "later" ? <Clock3 size={14} /> : null}
            {tone === "open" ? <Circle size={14} /> : null}
            {dayToneLabel(day)}
          </span>
          <button className={isClosed ? "commandButton subtle" : "commandButton"} onClick={toggleClosed} type="button">
            {isClosed ? <RotateCcw size={16} /> : <CheckCheck size={16} />}
            <span>{isClosed ? "Reopen" : "Close day"}</span>
          </button>
        </div>
      </header>
      <ProgressBar accent={accent} label={`${day.title} progress`} value={day.progress.ratio} />
      <div className="daySummary">
        <span><Check size={14} /> {day.progress.done}/{day.progress.required} core</span>
        <span><CircleHelp size={14} /> {Math.max(0, day.openQuestionCount - (day.todoCounts?.open ?? 0))} questions</span>
        <TodoProgressBadge counts={day.todoCounts} />
        <span>
          <Clock3 size={14} /> {tasks.filter((task) => task.status === "later").length + day.postponedQuestionCount} later
        </span>
        {plannedMinutes ? (
          <span
            className={`dayTimeBudget ${timeRatio >= 1 ? "complete" : ""}`}
            style={{ "--time-progress": `${Math.min(100, Math.round(timeRatio * 100))}%` } as React.CSSProperties}
            title={`${formatPlannedTime(plannedMinutes - optionalMinutes) || "0m"} core + ${formatPlannedTime(optionalMinutes) || "0m"} optional. Skipped tasks excluded.`}
          >
            <Timer size={14} />
            <b>{formatTrackedTime(day.trackedSeconds) || "0m"}</b>
            <em>/ {formatPlannedTime(plannedMinutes)} planned</em>
            {optionalMinutes ? <small>incl. {formatPlannedTime(optionalMinutes)} optional</small> : null}
            <i aria-hidden="true"><i /></i>
          </span>
        ) : day.trackedSeconds ? (
          <span><Timer size={14} /> {formatTrackedTime(day.trackedSeconds)}</span>
        ) : null}
        {shouldCompact ? (
          <button
            className="dayDetailsToggle"
            onClick={() => setCompactDetailsOpen((current) => !current)}
            type="button"
          >
            <ChevronDown className={showDetails ? "expanded" : ""} size={14} />
            <span>{showDetails ? "Hide details" : "Show tasks"}</span>
          </button>
        ) : null}
      </div>
      {showDetails ? (
        <div className="dayMomentum" aria-label="Remaining core work">
          <span>{remaining.count ? <><Sparkles size={15}/><strong>{remaining.count} core {remaining.count === 1 ? "step" : "steps"} left</strong>
            {remaining.minutes ? <small>{formatPlannedTime(remaining.minutes)} estimated{remaining.unestimated ? " + unestimated work" : ""}</small> : null}</>
            : <><CheckCircle2 size={15}/><strong>Core plan complete</strong><small>Your notes and answers are here whenever you return.</small></>}</span>
          {remaining.next ? <button type="button" onClick={() => {
            const target = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(remaining.next!.id)}"]`);
            const details = target?.closest("details"); if (details) details.open = true;
            target?.scrollIntoView({behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center"});
            target?.querySelector<HTMLButtonElement>(".taskStatus")?.focus({preventScroll: true});
          }} title={remaining.next.title}>Next step <ChevronDown size={13}/></button> : null}
        </div>
      ) : null}
      {showDetails ? (
        <div className="dayBody">
        <div className="taskList">
          {dayVisibleSections(day).map((section) => {
            const taskRows = section.tasks.map((task) => (
              <TaskRow
                dayId={day.id}
                discussionQuestionIds={discussionQuestionIds}
                examQuestionById={examQuestionById}
                key={task.id}
                onAnnotationChange={onAnnotationChange}
                onCollectPdfAnnotations={onCollectPdfAnnotations}
                onExportToZotero={onExportToZotero}
                onChapterProgressChange={onChapterProgressChange}
                onCreateCapture={onCreateCapture}
                onImportMaccyImages={onImportMaccyImages}
                onExerciseProgressChange={onExerciseProgressChange}
                onExerciseReviewChange={onExerciseReviewChange}
                onStatusChange={onTaskStatusChange}
                onNoteSave={onEntityNoteSave}
                onNoteDelete={onNoteDelete}
                onNoteAttentionChange={onNoteAttentionChange}
                onOpenDiscussion={onOpenDiscussion}
                onCopyNextQuestions={onCopyNextQuestions}
                onOpenTaskQa={onOpenTaskQa}
                onCopyTask={onCopyTask}
                onCopyTaskWithNotes={onCopyTaskWithNotes}
                onInsertTaskReview={onInsertTaskReview}
                onOpenResource={onOpenResource}
                onPrepareExerciseScreenshots={onPrepareExerciseScreenshots}
                onUploadImageQuestions={onUploadImageQuestions}
                onToggleTimer={() => onToggleTaskTimer(day, task, task.resourceIds
                  .map((resourceId) => resourceById.get(resourceId))
                  .filter((resource): resource is Resource => Boolean(resource)))}
                resourceById={resourceById}
                task={task}
                timer={{
                  active: taskTimer.activeTaskId === task.id,
                  busy: taskTimer.busy,
                  configured: taskTimer.configured,
                  error: taskTimer.error,
                  online: taskTimer.online,
                  trackedSeconds: taskTimer.trackedSecondsByTask[task.id] ?? 0,
                }}
              />
            ));
            if (section.defaultCollapsed || section.title === "Imported legacy tasks") {
              return (
                <details className="taskSection taskSectionCollapsed" key={section.id}>
                  <summary className="taskSectionHeader">
                    <h3>{section.title}</h3>
                    <span>{section.tasks.length}</span>
                  </summary>
                  <div className="taskSectionRows">{taskRows}</div>
                </details>
              );
            }
            return (
              <section className="taskSection" key={section.id}>
                <header className="taskSectionHeader">
                  <h3>{section.title}</h3>
                  <span>{section.tasks.length}</span>
                </header>
                <div className="taskSectionRows">{taskRows}</div>
              </section>
            );
          })}
        </div>
        <aside className="dayFocusRail">
          <section>
            <h3>Purpose</h3>
            <p>{day.purpose || day.topic || "No purpose recorded."}</p>
          </section>
          <section>
            <h3>Skills</h3>
            <div className="dayFocusTags">
              {skills.length ? skills.map((skill) => <span key={skill.id}>{skill.name}</span>) : <em>No linked skills</em>}
            </div>
          </section>
          {stopWhen.length ? (
            <section>
              <h3><Flag size={13} /> Stop when</h3>
              {stopWhen.map((task) => <p className="stopWhenText" key={task.id}>{task.title}</p>)}
            </section>
          ) : null}
        </aside>
        </div>
      ) : null}
      {showDetails ? (
        <div className="dayNotes">
          <EntityNoteEditor
            key={day.id}
            label="Day notes"
            note={day.notes[0]}
            placeholder={`Notes for ${day.title}`}
            onSave={(markdown) => onDayNoteSave(day, markdown)}
          />
        </div>
      ) : null}
    </article>
  );
}

export function RoadmapView({
  onPlanChanged,
  activeDayId,
  course,
  onActiveDayChange,
  onAnnotationChange,
  onCollectPdfAnnotations,
  onExportToZotero,
  onChapterProgressChange,
  onCreateCapture,
  onImportMaccyImages,
  onExerciseProgressChange,
  onExerciseReviewChange,
  onDayClosedChange,
  onDayNoteSave,
  onNoteSave,
  onNoteDelete,
  onNoteAttentionChange,
  onOpenDiscussion,
  onCopyNextQuestions,
  onOpenTaskQa,
  onCopyTask,
  onCopyTaskWithNotes,
  onInsertTaskReview,
  onOpenResource,
  onPrepareExerciseScreenshots,
  onUploadImageQuestions,
  onTaskStatusChange,
  onToggleTaskTimer,
  taskTimer,
}: RoadmapViewProps) {
  const [administrationDay, setAdministrationDay] = useState("");
  const initialCourseAnchorRef = useRef("");
  const resourceById = useMemo(
    () => new Map(course.resources.map((resource) => [resource.id, resource])),
    [course.resources],
  );
  const skillById = useMemo(
    () => new Map(course.skills.map((skill) => [skill.id, skill])),
    [course.skills],
  );
  const examQuestionById = useMemo(
    () =>
      new Map(
        course.exams.flatMap((exam) =>
          exam.questions.map((question) => [question.id, question] as const),
        ),
      ),
    [course.exams],
  );
  const discussionQuestionIds = useMemo(
    () =>
      new Set(
        course.discussions.flatMap((discussion) => discussion.questionIds),
      ),
    [course.discussions],
  );

  useLayoutEffect(() => {
    if (!activeDayId || initialCourseAnchorRef.current === course.id) return;
    const target = document.getElementById(activeDayId);
    if (!target) return;
    initialCourseAnchorRef.current = course.id;
    target.scrollIntoView({ behavior: "auto", block: "start" });
  }, [activeDayId, course.id]);

  useEffect(() => {
    if (!taskTimer.activeTaskId) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-task-id="${CSS.escape(taskTimer.activeTaskId ?? "")}"]`,
        )
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [course.id, taskTimer.activeTaskId]);

  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-day-id]"));
    if (!cards.length) return;
    let frame = 0;

    function updateActiveDay() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchor = 118;
        const visibleCards = cards.filter((card) => card.getBoundingClientRect().bottom > anchor);
        const activeCard = (visibleCards.length ? visibleCards : cards).reduce((closest, card) =>
          Math.abs(card.getBoundingClientRect().top - anchor) <
          Math.abs(closest.getBoundingClientRect().top - anchor)
            ? card
            : closest,
        );
        const dayId = activeCard.dataset.dayId;
        if (dayId) onActiveDayChange(dayId);
      });
    }

    updateActiveDay();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateActiveDay);
    cards.forEach((card) => resizeObserver?.observe(card));
    window.addEventListener("scroll", updateActiveDay, { passive: true });
    window.addEventListener("resize", updateActiveDay);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", updateActiveDay);
      window.removeEventListener("resize", updateActiveDay);
    };
  }, [course.id, course.days.length, onActiveDayChange]);

  return (
    <section className="dayStack">
      <div className="roadmapAdministration"><button className="commandButton subtle" type="button" onClick={() => setAdministrationDay(activeDayId || course.days[0]?.id || "")}>Manage tasks</button></div>
      {administrationDay && <TaskAdministration course={course} initialDayId={administrationDay} onChanged={onPlanChanged} onClose={() => setAdministrationDay("")}/>}
      {course.days.map((day) => (
        <DayCard
          onManageTasks={() => setAdministrationDay(day.id)}
          accent={course.accent}
          day={day}
          discussionQuestionIds={discussionQuestionIds}
          examQuestionById={examQuestionById}
          key={day.id}
          onAnnotationChange={onAnnotationChange}
          onCollectPdfAnnotations={onCollectPdfAnnotations}
          onExportToZotero={onExportToZotero}
          onChapterProgressChange={onChapterProgressChange}
          onCreateCapture={onCreateCapture}
          onImportMaccyImages={onImportMaccyImages}
          onExerciseProgressChange={onExerciseProgressChange}
          onExerciseReviewChange={onExerciseReviewChange}
          onClosedChange={onDayClosedChange}
          onDayNoteSave={onDayNoteSave}
          onEntityNoteSave={onNoteSave}
          onNoteDelete={onNoteDelete}
          onNoteAttentionChange={onNoteAttentionChange}
          onOpenDiscussion={onOpenDiscussion}
          onCopyNextQuestions={onCopyNextQuestions}
          onOpenTaskQa={onOpenTaskQa}
          onCopyTask={onCopyTask}
          onCopyTaskWithNotes={onCopyTaskWithNotes}
          onInsertTaskReview={onInsertTaskReview}
          onOpenResource={onOpenResource}
          onPrepareExerciseScreenshots={onPrepareExerciseScreenshots}
          onUploadImageQuestions={onUploadImageQuestions}
          onTaskStatusChange={onTaskStatusChange}
          onToggleTaskTimer={onToggleTaskTimer}
          resourceById={resourceById}
          skillById={skillById}
          taskTimer={taskTimer}
        />
      ))}
    </section>
  );
}
