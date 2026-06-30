import {
  BookOpen,
  CalendarDays,
  FileQuestion,
  Layers3,
  MessageSquareText,
  ScanSearch,
  SkipForward,
  StickyNote,
  Target,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import {
  dayDisplayTopic,
  dayTone,
  formatTrackedTime,
  isDayClosed,
} from "../features/roadmap/dayPresentation";
import type { Course, CourseSummary, TrackerView } from "../types/tracker";
import { MetricBar } from "./MetricBar";

type WorkspaceSidebarProps = {
  activeDayId: string;
  course: Course;
  courses: CourseSummary[];
  view: TrackerView;
  onCourseChange: (courseId: string) => void;
  onViewChange: (view: TrackerView) => void;
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

function scrollToDay(dayId: string) {
  document.getElementById(dayId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function WorkspaceSidebar({
  activeDayId,
  course,
  courses,
  view,
  onCourseChange,
  onViewChange,
}: WorkspaceSidebarProps) {
  const libraryResources = course.resources.filter((resource) => resource.kind !== "exam_question");
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
  const nextOpen =
    course.days.find((day) => !isDayClosed(day) || day.progress.ratio < 1) ?? course.days.at(-1);

  return (
    <aside className="workspaceSidebar">
      <div className="brandMark">
        <span className="brandGlyph">
          <Layers3 size={20} />
        </span>
        <div>
          <strong>Study Tracker</strong>
          <span>Focus in motion</span>
        </div>
      </div>

      <label className="courseSelect">
        <span className="srOnly">Course</span>
        <select onChange={(event) => onCourseChange(event.target.value)} value={course.id}>
          {courses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>

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
              onClick={() => today && scrollToDay(today.id)}
              title={today ? `Go to Day ${today.number}` : "No course day is scheduled today"}
              type="button"
            >
              <Target size={15} />
              <span>Today</span>
            </button>
            <button
              disabled={!nextOpen}
              onClick={() => nextOpen && scrollToDay(nextOpen.id)}
              title="Go to the next unfinished day"
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
              const trackedTime = formatTrackedTime(day.trackedSeconds);
              return (
                <button
                  className={`sidebarDayItem tone-${tone} ${day.id === activeDayId ? "active" : ""}`}
                  key={day.id}
                  onClick={() => scrollToDay(day.id)}
                  style={{ "--day-progress": `${Math.round(day.progress.ratio * 100)}%` } as CSSProperties}
                  type="button"
                >
                  <span className="sidebarDayNumber">{day.number}</span>
                  <span className="sidebarDayCopy">
                    <strong>{dayDisplayTopic(day)}</strong>
                    <small>
                      {day.date ?? "No date"}
                      {trackedTime ? ` · ${trackedTime}` : ""}
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
    </aside>
  );
}
