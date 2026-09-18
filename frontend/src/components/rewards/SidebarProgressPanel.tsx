import { BookOpen, CheckCheck, CircleHelp, ListTodo, Sparkles, Target } from "lucide-react";
import type { Course, TrackerView } from "../../types/tracker";
import { courseAchievements } from "../../lib/studyActivity";
import { ProgressBar } from "../ProgressBar";
import "./sidebar-progress.css";

export function SidebarProgressPanel({course, onViewChange}: {course: Course; onViewChange: (view: TrackerView) => void}) {
  const stats = courseAchievements(course);
  const remaining = stats.nextMilestone - stats.coreDone;
  return <section className="sidebarMetrics" aria-label="Course achievements">
    <header><Sparkles size={14}/><strong>Your progress</strong><small>Course totals</small></header>
    <div className="sidebarMilestone" aria-live="polite" aria-atomic="true">
      <strong>{stats.taskDone} tasks finished</strong>
      <span>{stats.coreTotal === 0 ? "Questions and to-dos count too."
        : stats.coreDone >= stats.coreTotal ? "Core plan complete. You did it."
        : `${remaining} more to reach ${stats.nextMilestone} core tasks finished`}</span>
    </div>
    <button type="button" className="sidebarAchievement" onClick={() => onViewChange("roadmap")}>
      <span><Target size={14}/> Core tasks <strong>{stats.coreDone}<small> / {stats.coreTotal}</small></strong></span>
      <ProgressBar label="Core tasks completed" value={stats.coreTotal ? stats.coreDone / stats.coreTotal : 0} accent={course.accent}/>
      <small>{stats.bonusDone > 0 ? `+${stats.bonusDone} optional tasks completed` : "Every completed task moves you forward"}</small>
    </button>
    <button type="button" className="sidebarAchievement" onClick={() => onViewChange("discussions")}>
      <span><CircleHelp size={14}/> Understood <strong>{stats.questionDone}<small> / {stats.questionTotal}</small></strong></span>
      <ProgressBar label="Questions understood" value={stats.questionTotal ? stats.questionDone / stats.questionTotal : 0} accent="#a595e8"/>
      <small>{stats.answersReady ? `${stats.answersReady} ${stats.answersReady === 1 ? "answer" : "answers"} ready to review`
        : stats.questionTotal && stats.questionDone === stats.questionTotal ? "Every question understood" : "Build understanding, one question at a time"}</small>
    </button>
    <button type="button" className="sidebarAchievement" onClick={() => onViewChange("notes")}>
      <span><ListTodo size={14}/> To-dos done <strong>{stats.todoDone}<small> / {stats.todoTotal}</small></strong></span>
      <ProgressBar label="To-dos completed" value={stats.todoTotal ? stats.todoDone / stats.todoTotal : 0} accent="#e5bd78"/>
      <small>{stats.todoTotal && stats.todoDone === stats.todoTotal ? "All loose ends tied up" : "Small follow-through counts"}</small>
    </button>
    <details className="sidebarMoreProgress"><summary>Reading, skills & more</summary>
      <button type="button" onClick={() => onViewChange("resources")}><BookOpen size={13}/><span>Reading<small>{stats.resourceStarted} in progress</small></span><strong>{stats.resourceDone}/{stats.resourceTotal}</strong></button>
      <button type="button" onClick={() => onViewChange("skills")}><Sparkles size={13}/><span>Skills covered</span><strong>{stats.skillDone}/{stats.skillTotal}</strong></button>
      {stats.examTotal > 0 && <button type="button" onClick={() => onViewChange("exams")}><CheckCheck size={13}/><span>Exam questions solved</span><strong>{stats.examDone}/{stats.examTotal}</strong></button>}
    </details>
  </section>;
}
