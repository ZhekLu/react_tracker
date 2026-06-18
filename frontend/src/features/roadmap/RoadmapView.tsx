import { lazy, Suspense } from "react";
import { CheckCircle2, Circle, CircleHelp, Clock3 } from "lucide-react";
import type { ComponentType } from "react";
import { ProgressBar } from "../../components/ProgressBar";
import { statusTone } from "../../lib/progress";
import type { Course, Task, TaskStatus } from "../../types/tracker";

type RoadmapViewProps = {
  course: Course;
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

function TaskRow({ task }: { task: Task }) {
  const Icon = statusIcon[task.status];
  return (
    <article className={`taskRow tone-${statusTone(task.status)}`}>
      <button className="taskStatus" aria-label={`Task status: ${task.status}`}>
        <Icon size={18} />
      </button>
      <div className="taskBody">
        <h3>{task.title}</h3>
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

export function RoadmapView({ course }: RoadmapViewProps) {
  return (
    <div className="roadmapLayout">
      <aside className="dayRail" aria-label="Days">
        {course.days.map((day) => (
          <a className="dayRailItem" href={`#${day.id}`} key={day.id}>
            <span>D{day.number}</span>
            <ProgressBar value={day.progress} label={`${day.title} progress`} />
          </a>
        ))}
      </aside>

      <section className="dayStack">
        {course.days.map((day) => (
          <article className="dayCard" id={day.id} key={day.id}>
            <header className="dayHeader">
              <div>
                <p className="eyebrow">Day {day.number} · {day.date}</p>
                <h2>{day.title}</h2>
                <p>{day.purpose}</p>
              </div>
              <span className={day.closed ? "stateBadge blue" : "stateBadge"}>{day.closed ? "Closed" : "Open"}</span>
            </header>
            <ProgressBar value={day.progress} label={`${day.title} progress`} />
            <div className="taskList">
              {day.tasks.map((task) => (
                <TaskRow task={task} key={task.id} />
              ))}
            </div>
            <Suspense fallback={<div className="editorLoading">Loading editor...</div>}>
              <RichNoteEditor placeholder={`Notes for ${day.title}`} />
            </Suspense>
          </article>
        ))}
      </section>
    </div>
  );
}
