import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleDashed,
  CircleHelp,
  Clock3,
  FileScan,
  FileQuestion,
  Flag,
  Highlighter,
  Info,
  MessageCircleQuestion,
  MessageSquareText,
  NotebookPen,
  RotateCcw,
  Timer,
} from "lucide-react";
import type { ComponentType } from "react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { AnnotationChapterGroups } from "../../components/annotations/AnnotationChapterGroups";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useCompletionReward } from "../../hooks/useCompletionReward";
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
} from "./dayPresentation";

type RoadmapViewProps = {
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
  onOpenDiscussion: (resourceId: string, taskId?: string) => void;
  onOpenResource: (resourceId: string) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

const statusIcon: Record<TaskStatus, ComponentType<{ size?: number }>> = {
  done: CheckCircle2,
  in_progress: CircleDashed,
  later: Clock3,
  skipped: Circle,
  todo: Circle,
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
  onOpenDiscussion,
  onOpenResource,
  onStatusChange,
}: TaskRowProps) {
  const reward = useCompletionReward();
  const Icon = statusIcon[task.status];
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

  function toggleDone() {
    const nextStatus = task.status === "done" ? "todo" : "done";
    if (nextStatus === "done") reward.celebrate();
    onStatusChange(dayId, task.id, nextStatus);
  }

  function toggleLater() {
    onStatusChange(dayId, task.id, task.status === "later" ? "todo" : "later");
  }

  return (
    <article
      className={`taskRow tone-${statusTone(task.status)} ${task.openQuestionCount ? "hasQuestions" : ""}`}
      data-status={task.status}
    >
      <button
        className="taskStatus"
        aria-label={task.status === "done" ? "Mark task incomplete" : "Mark task complete"}
        onClick={toggleDone}
        title={task.status === "done" ? "Mark incomplete" : "Complete task"}
        type="button"
      >
        <Icon size={18} />
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
            {task.openQuestionCount ? (
              <span className="taskMetaBadge question">
                <CircleHelp size={11} /> {task.openQuestionCount}
              </span>
            ) : null}
            {task.status !== "todo" ? <StatusBadge status={task.status} /> : null}
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
                {resource.version?.localPath
                  ?.toLowerCase()
                  .endsWith(".pdf") ? (
                  <button
                    className="taskLinkIcon"
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
      <div className="taskActions">
        <label className="workflowSelect">
          <span className="srOnly">Status for {task.title}</span>
          <select
            aria-label={`Status for ${task.title}`}
            onChange={(event) =>
              onStatusChange(dayId, task.id, event.target.value as TaskStatus)
            }
            value={task.status}
          >
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="later">Do later</option>
            <option value="skipped">Skipped</option>
          </select>
        </label>
        <button
          className={task.status === "later" ? "taskActionButton active" : "taskActionButton"}
          onClick={toggleLater}
          title={task.status === "later" ? "Return task to open work" : "Save task for later"}
          type="button"
        >
          <Clock3 size={14} />
          <span>{task.status === "later" ? "Later" : "Do later"}</span>
        </button>
      </div>
    </article>
  );
}

function TaskCapturePanel({
  captures,
  onAnnotationChange,
  onNoteSave,
  onOpenDiscussion,
  onOpenResource,
}: {
  captures: Array<{ annotation: Annotation; resource: Resource }>;
  onAnnotationChange: RoadmapViewProps["onAnnotationChange"];
  onNoteSave: RoadmapViewProps["onNoteSave"];
  onOpenDiscussion: (resourceId: string) => void;
  onOpenResource: RoadmapViewProps["onOpenResource"];
}) {
  const [open, setOpen] = useState(captures.length > 0);
  const previousCount = useRef(captures.length);
  const activeQuestions = captures.filter(
    ({ annotation }) =>
      ["question", "todo"].includes(annotation.kind) &&
      annotation.status === "open",
  );
  const importedCaptures = captures.filter(({ annotation }) =>
    ["drawboard_cloud", "drawboard_cloud_ink", "pdf_import"].includes(
      annotation.origin,
    ),
  );
  const manualQuestions = captures.filter(
    ({ annotation }) =>
      ["question", "todo"].includes(annotation.kind) &&
      !["drawboard_cloud", "drawboard_cloud_ink", "pdf_import"].includes(
        annotation.origin,
      ),
  );
  const groupedCaptures = captures.filter(
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
    if (captures.length > previousCount.current) setOpen(true);
    previousCount.current = captures.length;
  }, [captures.length]);

  return (
    <section className="taskCapturePanel">
      <button
        aria-expanded={open}
        className="taskCaptureToggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>
          {activeQuestions.length ? (
            <strong className="question">
              <CircleHelp size={12} />
              {activeQuestions.length} active question
              {activeQuestions.length === 1 ? "" : "s"}
            </strong>
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
        <ChevronDown className={open ? "expanded" : ""} size={14} />
      </button>
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
          {captureGroups.map(({ annotations, resource }) => (
            <section className="taskCaptureResourceGroup" key={resource.id}>
              <header>
                <button
                  onClick={() => onOpenResource(resource.id)}
                  type="button"
                >
                  <BookOpen size={12} />
                  <span>{resource.title}</span>
                </button>
                <strong>{annotations.length}</strong>
              </header>
              <AnnotationChapterGroups
                annotations={annotations}
                onAnnotationChange={onAnnotationChange}
                onDiscuss={() => onOpenDiscussion(resource.id)}
                onNoteSave={onNoteSave}
              />
            </section>
          ))}
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
  const tone = dayTone(day);
  const stopWhen = day.sections
    .filter((section) => section.title.toLowerCase() === "stop when")
    .flatMap((section) => section.tasks);
  const skills = day.skillIds
    .map((skillId) => skillById.get(skillId))
    .filter((skill): skill is Skill => Boolean(skill));

  function toggleClosed() {
    const nextClosed = !isClosed;
    if (nextClosed) reward.celebrate(1100);
    onClosedChange(day, nextClosed);
  }

  return (
    <article
      className={`dayCard tone-${tone} ${reward.active ? "dayCelebrated" : ""}`}
      data-day-id={day.id}
      id={day.id}
    >
      <CompletionBurst token={reward.token} variant="day" />
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
      <ProgressBar accent={accent} label={`${day.title} progress`} showValue value={day.progress.ratio} />
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
      </div>
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
      <DayNotes
        content={day.notes[0]?.document.markdown ?? ""}
        dayTitle={day.title}
        onSave={(noteHtml) => onDayNoteSave(day, noteHtml)}
      />
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
  course,
  onActiveDayChange,
  onAnnotationChange,
  onCollectPdfAnnotations,
  onDayClosedChange,
  onDayNoteSave,
  onFlagQuestion,
  onNoteSave,
  onOpenDiscussion,
  onOpenResource,
  onTaskStatusChange,
}: RoadmapViewProps) {
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
    window.addEventListener("scroll", updateActiveDay, { passive: true });
    window.addEventListener("resize", updateActiveDay);
    return () => {
      cancelAnimationFrame(frame);
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
