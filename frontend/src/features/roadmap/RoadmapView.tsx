import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleHelp,
  Clock3,
  FileScan,
  FileQuestion,
  Flag,
  FolderOpen,
  Highlighter,
  Info,
  Link2,
  MessageCircleQuestion,
  MessageSquareText,
  NotebookPen,
  RotateCcw,
  Timer,
  X,
} from "lucide-react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { DayCompletionParade } from "../../components/rewards/DayCompletionParade";
import { PetCelebration } from "../../components/rewards/PetCelebration";
import { AnnotationChapterGroups } from "../../components/annotations/AnnotationChapterGroups";
import { annotationChapterNumber } from "../../components/annotations/annotationDisplay";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { ProgressBar } from "../../components/ProgressBar";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import { petCelebrationDuration } from "../../config/petCelebrations";
import { statusTone } from "../../lib/progress";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  EntityNoteSaveInput,
  ExamQuestion,
  Resource,
  Skill,
  StudyDay,
  Task,
  TaskStatus,
} from "../../types/tracker";
import {
  dayEstimatedMinutes,
  dayTasks,
  dayTone,
  dayToneLabel,
  formatPlannedTime,
  formatTrackedTime,
  isDayClosed,
  isDayFullyComplete,
} from "./dayPresentation";

type RoadmapViewProps = {
  activeDayId: string;
  course: Course;
  onActiveDayChange: (dayId: string) => void;
  onAnnotationChange: (
    annotation: Annotation,
    changes: { kind?: AnnotationKind; status?: AnnotationStatus },
  ) => void;
  onCollectPdfAnnotations: (resourceId: string) => void;
  onDayClosedChange: (day: StudyDay, closed: boolean) => void;
  onDayNoteSave: (day: StudyDay, noteHtml: string) => void;
  onFlagQuestion: (
    resourceId: string,
    label: string,
    initialText?: string,
  ) => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onNoteAttentionChange: (
    note: NonNullable<Task["notes"][number]>,
    attention: NonNullable<Task["notes"][number]>["attention"],
  ) => void;
  onOpenDiscussion: (resourceId: string, taskId?: string) => void;
  onOpenResource: (resourceId: string) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

const RichNoteEditor = lazy(() =>
  import("../../components/editor/RichNoteEditor").then((module) => ({
    default: module.RichNoteEditor,
  })),
);

type TaskRowProps = {
  dayId: string;
  examQuestionById: Map<string, ExamQuestion>;
  resourceById: Map<string, Resource>;
  task: Task;
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onCollectPdfAnnotations: RoadmapViewProps["onCollectPdfAnnotations"];
  onFlagQuestion: RoadmapViewProps["onFlagQuestion"];
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onNoteAttentionChange: RoadmapViewProps["onNoteAttentionChange"];
  onOpenDiscussion: RoadmapViewProps["onOpenDiscussion"];
  onOpenResource: (resourceId: string) => void;
  onStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

function TaskRow({
  dayId,
  examQuestionById,
  resourceById,
  task,
  onAnnotationChange,
  onCollectPdfAnnotations,
  onFlagQuestion,
  onNoteSave,
  onNoteAttentionChange,
  onOpenDiscussion,
  onOpenResource,
  onStatusChange,
}: TaskRowProps) {
  const reward = useCompletionReward();
  const completed = task.status === "done";
  const linkedResources = task.resourceIds
    .map((resourceId) => resourceById.get(resourceId))
    .filter((resource): resource is Resource => Boolean(resource));
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
        left.annotation.status === "open";
      const rightQuestion =
        ["question", "todo"].includes(right.annotation.kind) &&
        right.annotation.status === "open";
      if (leftQuestion !== rightQuestion) return leftQuestion ? -1 : 1;
      return left.annotation.createdAt.localeCompare(right.annotation.createdAt);
    });
  const taskOpenQuestionCount = task.openQuestionCount;

  function toggleDone() {
    const nextStatus = task.status === "done" ? "todo" : "done";
    if (nextStatus === "done") {
      reward.celebrate(petCelebrationDuration("task"));
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
      className={`taskRow tone-${statusTone(task.status)} ${taskOpenQuestionCount ? "hasQuestions" : ""} ${reward.active ? "taskCelebrated" : ""}`}
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
          <h3>{task.title}</h3>
          <div className="taskBadges">
            {task.isOptional ? <span className="taskMetaBadge">Optional</span> : null}
            {task.taskType ? <span className="taskMetaBadge">{task.taskType}</span> : null}
            {task.estimatedMinutes ? (
              <span className="taskMetaBadge"><Timer size={11} /> {task.estimatedMinutes}m</span>
            ) : null}
            {taskOpenQuestionCount ? (
              <span
                className="taskMetaBadge question"
                title="Open questions scoped to this task/chapter"
              >
                <CircleHelp size={11} /> {taskOpenQuestionCount}
              </span>
            ) : null}
            {task.status === "later" ? (
              <span className="taskStateLabel later"><Clock3 size={11} /> Later</span>
            ) : null}
            {task.status === "skipped" ? (
              <span className="taskStateLabel skipped"><X size={11} /> Skipped</span>
            ) : null}
          </div>
        </div>
        {task.rationale?.plainText ? (
          <details className="taskRationale">
            <summary><Info size={12} /> Why this</summary>
            <MarkdownMath>
              {task.rationale.markdown ?? task.rationale.plainText}
            </MarkdownMath>
          </details>
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
                <button
                  className="taskLinkIcon"
                  onClick={() => onFlagQuestion(resource.id, resource.title)}
                  title={`Add a question about ${resource.title}`}
                  type="button"
                >
                  <MessageCircleQuestion size={12} />
                </button>
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
        {captures.length ? (
          <TaskCapturePanel
            captures={captures}
            chapterNumbers={task.chapterNumbers}
            onAnnotationChange={onAnnotationChange}
            onNoteSave={onNoteSave}
            onOpenDiscussion={(resourceId) =>
              onOpenDiscussion(resourceId, task.id)
            }
            onOpenResource={onOpenResource}
          />
        ) : null}
        <EntityNoteEditor
          key={`${task.notes[0]?.id ?? task.id}:${task.notes[0]?.revision ?? 0}`}
          label="Task note"
          note={task.notes[0]}
          onAttentionChange={onNoteAttentionChange}
          onSave={(html) =>
            onNoteSave({
              entityId: task.id,
              entityType: "task",
              html,
              kind: "task",
              note: task.notes[0],
            })
          }
          placeholder="Question, answer, implementation detail, or reminder..."
        />
      </div>
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
    </article>
  );
}

function TaskCapturePanel({
  captures,
  chapterNumbers,
  onAnnotationChange,
  onNoteSave,
  onOpenDiscussion,
  onOpenResource,
}: {
  captures: Array<{ annotation: Annotation; resource: Resource }>;
  chapterNumbers: number[];
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onNoteSave: RoadmapViewProps["onNoteSave"];
  onOpenDiscussion: (resourceId: string) => void;
  onOpenResource: RoadmapViewProps["onOpenResource"];
}) {
  const chapterScope = new Set(chapterNumbers);
  const isRelevantToTask = ({
    annotation,
    resource,
  }: {
    annotation: Annotation;
    resource: Resource;
  }) => {
    if (resource.kind !== "book" || chapterScope.size === 0) return true;
    const chapterNumber = annotationChapterNumber(annotation);
    return chapterNumber !== null && chapterScope.has(chapterNumber);
  };
  const activeQuestions = captures.filter(
    (capture) =>
      isRelevantToTask(capture) &&
      ["question", "todo"].includes(capture.annotation.kind) &&
      capture.annotation.status === "open",
  );
  const [open, setOpen] = useState(activeQuestions.length > 0);
  const [questionsOnly, setQuestionsOnly] = useState(false);
  const showingQuestionsOnly = questionsOnly && activeQuestions.length > 0;
  const previousActiveQuestionCount = useRef(activeQuestions.length);
  const importedCaptures = captures.filter(({ annotation }) =>
    ["drawboard_cloud", "drawboard_cloud_ink", "pdf_import"].includes(
      annotation.origin,
    ),
  );
  const visibleCaptures = showingQuestionsOnly ? activeQuestions : captures;
  const manualQuestions = visibleCaptures.filter(
    ({ annotation, resource }) =>
      (resource.kind !== "book" || chapterScope.size === 0) &&
      ["question", "todo"].includes(annotation.kind) &&
      !["drawboard_cloud", "drawboard_cloud_ink", "pdf_import"].includes(
        annotation.origin,
      ),
  );
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

  useEffect(() => {
    if (activeQuestions.length > previousActiveQuestionCount.current) {
      setOpen(true);
    }
    previousActiveQuestionCount.current = activeQuestions.length;
  }, [activeQuestions.length]);

  return (
    <section className="taskCapturePanel">
      <div className="taskCaptureToggle">
        <span>
          {activeQuestions.length ? (
            <button
              aria-pressed={showingQuestionsOnly}
              className={`question ${showingQuestionsOnly ? "active" : ""}`}
              onClick={() => {
                setQuestionsOnly((current) => !current);
                setOpen(true);
              }}
              title="Show only open questions and expand them"
              type="button"
            >
              <CircleHelp size={12} />
              {activeQuestions.length} active question
              {activeQuestions.length === 1 ? "" : "s"}
            </button>
          ) : null}
          {importedCaptures.length ? (
            <strong className="capture">
              <Highlighter size={12} />
              {importedCaptures.length} PDF capture
              {importedCaptures.length === 1 ? "" : "s"}
            </strong>
          ) : null}
          {!activeQuestions.length && !importedCaptures.length ? (
            <strong className="capture">
              <Archive size={12} />
              {captures.length} capture{captures.length === 1 ? "" : "s"}
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
          {manualQuestions.length ? (
            <section className="taskQuestionShelf">
              <header>
                <span>
                  <CircleHelp size={12} />
                  Questions added for this task
                </span>
                <strong>{manualQuestions.length}</strong>
              </header>
              <AnnotationChapterGroups
                annotations={manualQuestions.map(
                  ({ annotation }) => annotation,
                )}
                flat
                initiallyExpandCaptures={showingQuestionsOnly}
                onAnnotationChange={onAnnotationChange}
                onDiscuss={(annotation) => {
                  const resource = manualQuestions.find(
                    ({ annotation: candidate }) =>
                      candidate.id === annotation.id,
                  )?.resource;
                  if (resource) onOpenDiscussion(resource.id);
                }}
                onNoteSave={onNoteSave}
              />
            </section>
          ) : null}
          {captureGroups.map(({ annotations, resource }) => {
            const relevantQuestions = annotations.filter(
              (annotation) =>
                isRelevantToTask({ annotation, resource }) &&
                ["question", "todo"].includes(annotation.kind) &&
                annotation.status === "open",
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
                initiallyExpandCaptures={showingQuestionsOnly}
                initiallyOpenAll={showingQuestionsOnly}
                preferredChapterNumbers={
                  resource.kind === "book" ? chapterNumbers : []
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

type DayCardProps = {
  accent: string;
  day: StudyDay;
  examQuestionById: Map<string, ExamQuestion>;
  resourceById: Map<string, Resource>;
  skillById: Map<string, Skill>;
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onCollectPdfAnnotations: RoadmapViewProps["onCollectPdfAnnotations"];
  onDayNoteSave: (day: StudyDay, noteHtml: string) => void;
  onEntityNoteSave: (input: EntityNoteSaveInput) => void;
  onNoteAttentionChange: RoadmapViewProps["onNoteAttentionChange"];
  onFlagQuestion: RoadmapViewProps["onFlagQuestion"];
  onOpenDiscussion: RoadmapViewProps["onOpenDiscussion"];
  onOpenResource: (resourceId: string) => void;
  onClosedChange: (day: StudyDay, closed: boolean) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

function DayCard({
  accent,
  day,
  examQuestionById,
  resourceById,
  skillById,
  onAnnotationChange,
  onCollectPdfAnnotations,
  onDayNoteSave,
  onEntityNoteSave,
  onNoteAttentionChange,
  onFlagQuestion,
  onOpenDiscussion,
  onOpenResource,
  onClosedChange,
  onTaskStatusChange,
}: DayCardProps) {
  const reward = useCompletionReward();
  const tasks = dayTasks(day);
  const plannedMinutes = dayEstimatedMinutes(day);
  const trackedMinutes = day.trackedSeconds / 60;
  const timeRatio = plannedMinutes ? trackedMinutes / plannedMinutes : 0;
  const isClosed = isDayClosed(day);
  const isFullyComplete = isDayFullyComplete(day);
  const shouldCompact = isClosed || isFullyComplete;
  const [compactDetailsOpen, setCompactDetailsOpen] = useState(false);
  const showDetails = !shouldCompact || compactDetailsOpen;
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
        <span><CircleHelp size={14} /> {day.openQuestionCount} questions</span>
        <span><Clock3 size={14} /> {tasks.filter((task) => task.status === "later").length} later</span>
        {plannedMinutes ? (
          <span
            className={`dayTimeBudget ${timeRatio >= 1 ? "complete" : ""}`}
            style={{ "--time-progress": `${Math.min(100, Math.round(timeRatio * 100))}%` } as React.CSSProperties}
            title={`${Math.round(timeRatio * 100)}% of the planned study time tracked`}
          >
            <Timer size={14} />
            <b>{formatTrackedTime(day.trackedSeconds) || "0m"}</b>
            <em>/ {formatPlannedTime(plannedMinutes)} planned</em>
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
        <div className="dayBody">
        <div className="taskList">
          {day.sections.map((section) => {
            const taskRows = section.tasks.map((task) => (
              <TaskRow
                dayId={day.id}
                examQuestionById={examQuestionById}
                key={task.id}
                onAnnotationChange={onAnnotationChange}
                onCollectPdfAnnotations={onCollectPdfAnnotations}
                onFlagQuestion={onFlagQuestion}
                onStatusChange={onTaskStatusChange}
                onNoteSave={onEntityNoteSave}
                onNoteAttentionChange={onNoteAttentionChange}
                onOpenDiscussion={onOpenDiscussion}
                onOpenResource={onOpenResource}
                resourceById={resourceById}
                task={task}
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
        <DayNotes
          content={day.notes[0]?.document.markdown ?? ""}
          dayTitle={day.title}
          onSave={(noteHtml) => onDayNoteSave(day, noteHtml)}
        />
      ) : null}
    </article>
  );
}

function DayNotes({
  content,
  dayTitle,
  onSave,
}: {
  content: string;
  dayTitle: string;
  onSave: (noteHtml: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(content);

  function saveDraft() {
    onSave(draft);
  }

  return (
    <details className="dayNotes" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <NotebookPen size={16} />
        <span>Day notes</span>
      </summary>
      {open ? (
        <div className="dayNotesBody">
          <Suspense fallback={<div className="editorLoading">Loading editor...</div>}>
            <RichNoteEditor initialContent={draft} onChange={setDraft} placeholder={`Notes for ${dayTitle}`} />
          </Suspense>
          <div className="noteActions">
            <button className="commandButton subtle" onClick={saveDraft} type="button">
              Save notes
            </button>
          </div>
        </div>
      ) : null}
    </details>
  );
}

export function RoadmapView({
  activeDayId,
  course,
  onActiveDayChange,
  onAnnotationChange,
  onCollectPdfAnnotations,
  onDayClosedChange,
  onDayNoteSave,
  onFlagQuestion,
  onNoteSave,
  onNoteAttentionChange,
  onOpenDiscussion,
  onOpenResource,
  onTaskStatusChange,
}: RoadmapViewProps) {
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

  useLayoutEffect(() => {
    if (!activeDayId || initialCourseAnchorRef.current === course.id) return;
    const target = document.getElementById(activeDayId);
    if (!target) return;
    initialCourseAnchorRef.current = course.id;
    target.scrollIntoView({ behavior: "auto", block: "start" });
  }, [activeDayId, course.id]);

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
      {course.days.map((day) => (
        <DayCard
          accent={course.accent}
          day={day}
          examQuestionById={examQuestionById}
          key={day.id}
          onAnnotationChange={onAnnotationChange}
          onCollectPdfAnnotations={onCollectPdfAnnotations}
          onClosedChange={onDayClosedChange}
          onDayNoteSave={onDayNoteSave}
          onEntityNoteSave={onNoteSave}
          onNoteAttentionChange={onNoteAttentionChange}
          onFlagQuestion={onFlagQuestion}
          onOpenDiscussion={onOpenDiscussion}
          onOpenResource={onOpenResource}
          onTaskStatusChange={onTaskStatusChange}
          resourceById={resourceById}
          skillById={skillById}
        />
      ))}
    </section>
  );
}
