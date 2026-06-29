import { lazy, Suspense, useState } from "react";
import {
  Check,
  CheckCircle2,
  CheckCheck,
  Circle,
  CircleDashed,
  CircleHelp,
  Clock3,
  NotebookPen,
  RotateCcw,
} from "lucide-react";
import type { ComponentType } from "react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { ProgressBar } from "../../components/ProgressBar";
import { ProgressRing } from "../../components/ui/ProgressRing";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import { statusTone } from "../../lib/progress";
import type { Course, StudyDay, Task, TaskStatus } from "../../types/tracker";

type RoadmapViewProps = {
  course: Course;
  onDayClosedChange: (day: StudyDay, closed: boolean) => void;
  onDayNoteSave: (day: StudyDay, noteHtml: string) => void;
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
  task: Task;
  onStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

function TaskRow({ dayId, task, onStatusChange }: TaskRowProps) {
  const reward = useCompletionReward();
  const Icon = statusIcon[task.status];

  function toggleDone() {
    const nextStatus = task.status === "done" ? "todo" : "done";
    if (nextStatus === "done") reward.celebrate();
    onStatusChange(dayId, task.id, nextStatus);
  }

  return (
    <article className={`taskRow tone-${statusTone(task.status)}`} data-status={task.status}>
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
          <StatusBadge compact status={task.status} />
        </div>
        {task.rationale?.plainText ? <p>{task.rationale.plainText}</p> : null}
        <div className="tagRow">
          {task.skillIds.map((skillId) => (
            <span className="tag" key={skillId}>
              {skillId}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

type DayCardProps = {
  accent: string;
  day: StudyDay;
  onClosedChange: (day: StudyDay, closed: boolean) => void;
  onNoteSave: (day: StudyDay, noteHtml: string) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

function DayCard({ accent, day, onClosedChange, onNoteSave, onTaskStatusChange }: DayCardProps) {
  const reward = useCompletionReward();
  const tasks = day.sections.flatMap((section) => section.tasks);
  const isClosed = day.status === "closed" || day.status === "completed";

  function toggleClosed() {
    const nextClosed = !isClosed;
    if (nextClosed) reward.celebrate(1100);
    onClosedChange(day, nextClosed);
  }

  return (
    <article className={`dayCard ${reward.active ? "dayCelebrated" : ""}`} id={day.id}>
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
          <StatusBadge status={isClosed ? "done" : "todo"} />
          <button className={isClosed ? "commandButton subtle" : "commandButton"} onClick={toggleClosed} type="button">
            {isClosed ? <RotateCcw size={16} /> : <CheckCheck size={16} />}
            <span>{isClosed ? "Reopen" : "Close day"}</span>
          </button>
        </div>
      </header>
      <ProgressBar accent={accent} label={`${day.title} progress`} showValue value={day.progress.ratio} />
      <div className="daySummary">
        <span><Check size={14} /> {tasks.filter((task) => task.status === "done").length}/{tasks.length} tasks</span>
        <span><CircleHelp size={14} /> {day.openQuestionCount} questions</span>
        <span><Clock3 size={14} /> {tasks.filter((task) => task.status === "later").length} later</span>
      </div>
      <div className="taskList">
        {day.sections.map((section) => (
          <section className="taskSection" key={section.id}>
            <header className="taskSectionHeader">
              <h3>{section.title}</h3>
              <span>{section.tasks.length}</span>
            </header>
            {section.tasks.map((task) => (
              <TaskRow dayId={day.id} key={task.id} onStatusChange={onTaskStatusChange} task={task} />
            ))}
          </section>
        ))}
      </div>
      <DayNotes
        content={day.notes[0]?.document.markdown ?? ""}
        dayTitle={day.title}
        onSave={(noteHtml) => onNoteSave(day, noteHtml)}
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

export function RoadmapView({ course, onDayClosedChange, onDayNoteSave, onTaskStatusChange }: RoadmapViewProps) {
  return (
    <div className="roadmapLayout">
      <aside className="dayRail" aria-label="Days">
        {course.days.map((day) => (
          <a className="dayRailItem" href={`#${day.id}`} key={day.id}>
            <ProgressRing accent={course.accent} label={`Day ${day.number}`} size="small" value={day.progress.ratio} />
            <span className="dayRailText">
              <strong>Day {day.number}</strong>
              <small>{day.title}</small>
            </span>
          </a>
        ))}
      </aside>

      <section className="dayStack">
        {course.days.map((day) => (
          <DayCard
            accent={course.accent}
            day={day}
            key={day.id}
            onClosedChange={onDayClosedChange}
            onNoteSave={onDayNoteSave}
            onTaskStatusChange={onTaskStatusChange}
          />
        ))}
      </section>
    </div>
  );
}
