import {
  BookOpen,
  CalendarDays,
  FileQuestion,
  Layers3,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  SkipForward,
  Sparkles,
  StickyNote,
  Target,
} from "lucide-react";
import { useState, type ComponentType, type CSSProperties } from "react";
import {
  dayEstimatedMinutes,
  dayDisplayTopic,
  formatPlannedTime,
  dayTone,
  formatTrackedTime,
  isDayClosed,
} from "../features/roadmap/dayPresentation";
import type { Course, CourseSummary, TrackerView } from "../types/tracker";
import { MetricBar } from "./MetricBar";
import { StudyMomentumPanel } from "./rewards/StudyMomentumPanel";

type WorkspaceSidebarProps = {
  activeDayId: string;
  course: Course;
  courses: CourseSummary[];
  view: TrackerView;
  onCourseChange: (courseId: string) => void;
  onViewChange: (view: TrackerView) => void;
  onOpenDay: (dayId: string) => void;
  trackedSecondsByDay: Record<string, number>;
};

const navItems: Array<{
  view: TrackerView;
  label: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { view: "roadmap", label: "Roadmap", icon: CalendarDays },
  { view: "resources", label: "Resources", icon: BookOpen },
  { view: "skills", label: "Skills", icon: ScanSearch },
  { view: "exams", label: "Exams", icon: FileQuestion },
  { view: "notes", label: "Notes", icon: StickyNote },
  { view: "discussions", label: "Discussions", icon: MessageSquareText },
];

function localDateKey(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function WorkspaceSidebar({
  activeDayId,
  course,
  courses,
  view,
  onCourseChange,
  onOpenDay,
  onViewChange,
  trackedSecondsByDay,
}: WorkspaceSidebarProps) {
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem("tracker.sidebar.collapsed") === "true",
  );
  const libraryResources = course.resources.filter(
    (resource) => !["discussion", "exam_question"].includes(resource.kind),
  );
  const readResources = libraryResources.filter((resource) =>
    ["read", "review"].includes(resource.status),
  ).length;
  const allQuestions = course.exams.flatMap((exam) => exam.questions);
  const solvedQuestions = allQuestions.filter((question) =>
    ["solved", "review"].includes(question.solveStatus),
  ).length;
  const completedDays = course.days.filter(isDayClosed).length;
  const coveredSkills = course.skills.filter((skill) => skill.covered).length;
  const today = course.days.find((day) => day.date === localDateKey());
  const nextOpen = course.days.find((day) => !isDayClosed(day));

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("tracker.sidebar.collapsed", String(next));
      return next;
    });
  }

  return (
    <aside
      className={
        collapsed ? "workspaceSidebar collapsed" : "workspaceSidebar"
      }
    >
      <div className="brandMark">
        <span className="brandGlyph">
          <Layers3 size={20} />
        </span>
        <div>
          <strong>Study Tracker</strong>
          <span>Focus in motion</span>
        </div>
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="sidebarCollapseButton"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          type="button"
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
      </div>

      <label className="courseSelect" title={course.title}>
        <span className="srOnly">Course</span>
        <select onChange={(event) => onCourseChange(event.target.value)} value={course.id}>
          {courses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>

      <StudyMomentumPanel
        course={course}
        trackedSecondsByDay={trackedSecondsByDay}
      />

      <nav className="workspaceNav" aria-label="Main navigation">
        {navItems.map((item) => {
          if (item.view === "exams" && course.exams.length === 0) return null;
          const Icon = item.icon;
          return (
            <button
              className={item.view === view ? "workspaceNavButton active" : "workspaceNavButton"}
              key={item.view}
              onClick={() => onViewChange(item.view)}
              type="button"
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="sidebarMetrics" aria-label="Course statistics">
        <MetricBar accent={course.accent} label="Days" total={course.days.length} value={completedDays} />
        <MetricBar
          accent={course.accent}
          label="Core tasks"
          total={course.stats.taskCount}
          value={course.stats.completedTaskCount}
        />
        <MetricBar
          accent={course.accent}
          label="Resources"
          total={libraryResources.length}
          value={readResources}
        />
        <MetricBar accent={course.accent} label="Skills" total={course.skills.length} value={coveredSkills} />
        {allQuestions.length ? (
          <MetricBar
            accent={course.accent}
            label="Exam questions"
            total={allQuestions.length}
            value={solvedQuestions}
          />
        ) : null}
      </section>

      {view === "roadmap" ? (
        <>
          <div className="dayJumpActions">
            <button
              disabled={!today}
              onClick={() => today && onOpenDay(today.id)}
              title={today ? `Go to Day ${today.number}` : "No course day is scheduled today"}
              type="button"
            >
              <Target size={15} />
              <span>Today</span>
            </button>
            <button
              disabled={!nextOpen}
              onClick={() => nextOpen && onOpenDay(nextOpen.id)}
              title="Go to the next day whose workflow status is open"
              type="button"
            >
              <SkipForward size={15} />
              <span>Next open</span>
            </button>
          </div>

          <div className="sidebarSectionLabel">
            <span>Days</span>
            <span>{completedDays}/{course.days.length}</span>
          </div>
          <nav className="sidebarDayList" aria-label="Course days">
            {course.days.map((day) => {
              const tone = dayTone(day);
              const trackedTime = formatTrackedTime(
                Math.max(
                  day.trackedSeconds,
                  trackedSecondsByDay[day.id] ?? 0,
                ),
              );
              const plannedTime = formatPlannedTime(dayEstimatedMinutes(day));
              return (
                <button
                  className={`sidebarDayItem tone-${tone} ${day.id === activeDayId ? "active" : ""}`}
                  key={day.id}
                  onClick={() => onOpenDay(day.id)}
                  style={{ "--day-progress": `${Math.round(day.progress.ratio * 100)}%` } as CSSProperties}
                  type="button"
                >
                  <span className="sidebarDayNumber">{day.number}</span>
                  <span className="sidebarDayCopy">
                    <strong>{dayDisplayTopic(day)}</strong>
                    <small>
                      {day.date ?? "No date"}
                      {plannedTime
                        ? ` · ${trackedTime || "0m"} / ${plannedTime}`
                        : trackedTime
                          ? ` · ${trackedTime}`
                          : ""}
                    </small>
                  </span>
                  <span className="sidebarDayProgress" aria-hidden="true">
                    <span />
                  </span>
                </button>
              );
            })}
          </nav>
        </>
      ) : (
        <div className="sidebarViewHint">
          {view === "resources" ? <BookOpen size={18} /> : null}
          {view === "skills" ? <ScanSearch size={18} /> : null}
          {view === "exams" ? <FileQuestion size={18} /> : null}
          {view === "notes" ? <StickyNote size={18} /> : null}
          {view === "discussions" ? <MessageSquareText size={18} /> : null}
          <div>
            <strong>
              {view === "resources" ? "Library map" : null}
              {view === "skills" ? "Objective coverage" : null}
              {view === "exams" ? "Practice map" : null}
              {view === "notes" ? "Study memory" : null}
              {view === "discussions" ? "Tutor conversations" : null}
            </strong>
            <span>
              {view === "resources"
                ? `${libraryResources.length} source files`
                : null}
              {view === "skills" ? `${coveredSkills}/${course.skills.length} covered` : null}
              {view === "exams" ? `${allQuestions.length} mapped questions` : null}
              {view === "notes" ? `${course.notes.length} editable notes` : null}
              {view === "discussions" ? `${course.discussions.length} linked threads` : null}
            </span>
          </div>
        </div>
      )}
      <div className="sidebarShortcutHint">
        <span>⌥1–6 views</span>
        <span>J/K days</span>
      </div>
      <a
        className="workspaceNavButton petLabLink"
        href="/?petLab=1"
        title="Open the pet animation laboratory"
      >
        <Sparkles size={17} />
        <span>Pet animation lab</span>
      </a>
    </aside>
  );
}
