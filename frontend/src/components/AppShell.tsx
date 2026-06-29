import { BookOpen, CalendarDays, FileQuestion, Layers3, Sparkles } from "lucide-react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { percent } from "../lib/progress";
import type { Course, CourseSummary, TrackerView } from "../types/tracker";
import { ProgressBar } from "./ProgressBar";
import { ProgressRing } from "./ui/ProgressRing";

type AppShellProps = {
  course: Course;
  courses: CourseSummary[];
  view: TrackerView;
  onViewChange: (view: TrackerView) => void;
  onCourseChange: (courseId: string) => void;
  children: ReactNode;
};

const navItems: Array<{ view: TrackerView; label: string; icon: ComponentType<{ size?: number }> }> = [
  { view: "roadmap", label: "Roadmap", icon: CalendarDays },
  { view: "resources", label: "Resources", icon: BookOpen },
  { view: "exams", label: "Exams", icon: FileQuestion },
];

export function AppShell({ course, courses, view, onViewChange, onCourseChange, children }: AppShellProps) {
  const courseProgress = course.stats.progressRatio;
  const questionCount = course.stats.openQuestionCount;
  const completedTasks = course.stats.completedTaskCount;
  const totalTasks = course.stats.taskCount;
  const activeView = navItems.find((item) => item.view === view);
  const ActiveViewIcon = activeView?.icon;

  return (
    <div className="appShell" style={{ "--course-accent": course.accent } as CSSProperties}>
      <aside className="sideNav">
        <div className="brandMark">
          <span className="brandGlyph">
            <Layers3 size={20} />
          </span>
          <div>
            <strong>Study Tracker</strong>
            <span>Local workspace</span>
          </div>
        </div>

        <div className="courseSwitcher" aria-label="Course">
          {courses.map((item) => (
            <button
              className={item.id === course.id ? "courseButton active" : "courseButton"}
              key={item.id}
              onClick={() => onCourseChange(item.id)}
              style={{ "--course-accent": item.accent } as CSSProperties}
            >
              <span className="courseInitial">{item.shortCode.slice(0, 2).toUpperCase()}</span>
              <span className="courseButtonText">
                <strong>{item.shortCode}</strong>
                <small>{item.stats.dayCount} days</small>
              </span>
            </button>
          ))}
        </div>

        <nav className="navList" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={item.view === view ? "navButton active" : "navButton"}
                key={item.view}
                onClick={() => onViewChange(item.view)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="sideProgress" aria-label="Course progress">
          <div className="sideProgressHead">
            <span>Course progress</span>
            <strong>{percent(courseProgress)}</strong>
          </div>
          <ProgressBar accent={course.accent} value={courseProgress} />
          <dl>
            <div>
              <dt>Done</dt>
              <dd>{completedTasks}/{totalTasks}</dd>
            </div>
            <div>
              <dt>Questions</dt>
              <dd>{questionCount}</dd>
            </div>
          </dl>
        </section>
      </aside>

      <div className="mainArea">
        <header className="topHeader">
          <div className="headerIdentity">
            <span className="headerViewIcon">{ActiveViewIcon ? <ActiveViewIcon size={18} /> : null}</span>
            <div>
              <p className="eyebrow">{activeView?.label ?? course.shortCode}</p>
              <h1>{course.title}</h1>
            </div>
          </div>
          <div className="headerProgress">
            <div className="headerStats">
              <span><strong>{course.stats.dayCount}</strong> days</span>
              <span><strong>{course.stats.resourceCount}</strong> resources</span>
              <span><strong>{course.skills.filter((skill) => skill.covered).length}</strong> skills covered</span>
            </div>
            <div className="headerScore">
              <Sparkles size={15} />
              <span>{percent(courseProgress)}</span>
            </div>
            <ProgressRing accent={course.accent} label="Course progress" size="small" value={courseProgress} />
          </div>
        </header>
        <main className="contentArea">{children}</main>
      </div>
    </div>
  );
}
