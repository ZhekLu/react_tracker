import { lazy, Suspense, useState } from "react";
import { Check, CheckCircle2, CheckCheck, Circle, CircleHelp, Clock3, NotebookPen, RotateCcw } from "lucide-react";
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
  onDayClosedChange: (dayId: string, closed: boolean) => void;
  onDayNoteChange: (dayId: string, noteHtml: string) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

const statusIcon: Record<TaskStatus, ComponentType<{ size?: number }>> = {
  done: CheckCircle2,
  question: CircleHelp,
  later: Clock3,
  todo: Circle,
};

const RichNoteEditor = lazy(() =>
  import("../../components/editor/RichNoteEditor").then((module) => ({ default: module.RichNoteEditor })),
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
        {task.detail ? <p>{task.detail}</p> : null}
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
  onClosedChange: (dayId: string, closed: boolean) => void;
  onNoteChange: (dayId: string, noteHtml: string) => void;
  onTaskStatusChange: (dayId: string, taskId: string, status: TaskStatus) => void;
};

function DayCard({ accent, day, onClosedChange, onNoteChange, onTaskStatusChange }: DayCardProps) {
  const reward = useCompletionReward();

  function toggleClosed() {
    const nextClosed = !day.closed;
    if (nextClosed) reward.celebrate(1100);
    onClosedChange(day.id, nextClosed);
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
          <StatusBadge status={day.closed ? "done" : "todo"} />
          <button className={day.closed ? "commandButton subtle" : "commandButton"} onClick={toggleClosed} type="button">
            {day.closed ? <RotateCcw size={16} /> : <CheckCheck size={16} />}
            <span>{day.closed ? "Reopen" : "Close day"}</span>
          </button>
        </div>
      </header>
      <ProgressBar accent={accent} label={`${day.title} progress`} showValue value={day.progress} />
      <div className="daySummary">
        <span><Check size={14} /> {day.tasks.filter((task) => task.status === "done").length}/{day.tasks.length} tasks</span>
        <span><CircleHelp size={14} /> {day.tasks.filter((task) => task.status === "question").length} questions</span>
        <span><Clock3 size={14} /> {day.tasks.filter((task) => task.status === "later").length} later</span>
      </div>
      <div className="taskList">
        {day.tasks.map((task) => (
          <TaskRow dayId={day.id} key={task.id} onStatusChange={onTaskStatusChange} task={task} />
        ))}
      </div>
      <DayNotes
        content={day.noteHtml ?? ""}
        dayTitle={day.title}
        onChange={(noteHtml) => onNoteChange(day.id, noteHtml)}
      />
    </article>
  );
}

function DayNotes({
  content,
  dayTitle,
  onChange,
}: {
  content: string;
  dayTitle: string;
  onChange: (noteHtml: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details className="dayNotes" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <NotebookPen size={16} />
        <span>Day notes</span>
      </summary>
      {open ? (
        <div className="dayNotesBody">
          <Suspense fallback={<div className="editorLoading">Loading editor...</div>}>
            <RichNoteEditor initialContent={content} onChange={onChange} placeholder={`Notes for ${dayTitle}`} />
          </Suspense>
        </div>
      ) : null}
    </details>
  );
}

export function RoadmapView({ course, onDayClosedChange, onDayNoteChange, onTaskStatusChange }: RoadmapViewProps) {
  return (
    <div className="roadmapLayout">
      <aside className="dayRail" aria-label="Days">
        {course.days.map((day) => (
          <a className="dayRailItem" href={`#${day.id}`} key={day.id}>
            <ProgressRing accent={course.accent} label={`Day ${day.number}`} size="small" value={day.progress} />
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
            onNoteChange={onDayNoteChange}
            onTaskStatusChange={onTaskStatusChange}
          />
        ))}
      </section>
    </div>
  );
}
