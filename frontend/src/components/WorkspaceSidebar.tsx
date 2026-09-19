import {
  BookOpen,
  Bug,
  CalendarDays,
  FileQuestion,
  Layers3,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  Settings,
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
import { SidebarProgressPanel } from "./rewards/SidebarProgressPanel";
import { StudyMomentumPanel } from "./rewards/StudyMomentumPanel";
import { courseAchievements } from "../lib/studyActivity";

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
  { view: "settings", label: "Settings", icon: Settings },
  { view: "debug", label: "Debug", icon: Bug },
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
  const [summary, setSummary] = useState(() =>
    window.localStorage.getItem("tracker.sidebar.summary") === "journey" ? "journey" : "progress");
  const completedDays = course.days.filter(isDayClosed).length;
  const achievements = courseAchievements(course);
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

      <div className="sidebarProgressTabs" role="group" aria-label="Sidebar summary">
        {(["progress", "journey"] as const).map(value => <button type="button" key={value}
          aria-pressed={summary === value} onClick={() => {
            setSummary(value); window.localStorage.setItem("tracker.sidebar.summary", value);
          }}>{value === "progress" ? "Progress" : "Course map"}</button>)}
      </div>
      {summary === "journey" ? <StudyMomentumPanel course={course} activeDayId={activeDayId}
        onOpenDay={onOpenDay} trackedSecondsByDay={trackedSecondsByDay}/>
        : <SidebarProgressPanel course={course} onViewChange={onViewChange}/>}

      <nav className="workspaceNav" aria-label="Main navigation">
        {navItems.map((item) => {
          if (item.view === "exams" && course.exams.length === 0) return null;
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              title={item.label}
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
          {view === "settings" ? <Settings size={18} /> : null}
          {view === "debug" ? <Bug size={18} /> : null}
          <div>
            <strong>
              {view === "resources" ? "Library map" : null}
              {view === "skills" ? "Objective coverage" : null}
              {view === "exams" ? "Practice map" : null}
              {view === "notes" ? "Study memory" : null}
              {view === "discussions" ? "Tutor conversations" : null}
              {view === "settings" ? "Workspace behavior" : null}
              {view === "debug" ? "Insert review" : null}
            </strong>
            <span>
              {view === "resources"
                ? `${achievements.resourceTotal} source files`
                : null}
              {view === "skills" ? `${achievements.skillDone}/${course.skills.length} covered` : null}
              {view === "exams" ? `${achievements.examTotal} mapped questions` : null}
              {view === "notes" ? `${course.notes.length} editable notes` : null}
              {view === "discussions" ? `${course.discussions.length} linked threads` : null}
            </span>
          </div>
        </div>
      )}
      <div className="sidebarShortcutHint">
        <span>⌥1–8 views</span>
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
