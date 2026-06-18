import { BookOpen, CalendarDays, FileQuestion, Layers3 } from "lucide-react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { Course, TrackerView } from "../types/tracker";

type AppShellProps = {
  course: Course;
  courses: Course[];
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
  return (
    <div className="appShell">
      <aside className="sideNav">
        <div className="brandMark">
          <Layers3 size={22} />
          <div>
            <strong>Study Tracker</strong>
            <span>React workspace</span>
          </div>
        </div>

        <div className="courseSwitcher" aria-label="Course">
          {courses.map((item) => (
            <button
              className={item.id === course.id ? "coursePill active" : "coursePill"}
              key={item.id}
              onClick={() => onCourseChange(item.id)}
              style={{ "--course-accent": item.accent } as CSSProperties}
            >
              {item.shortCode}
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
      </aside>

      <div className="mainArea">
        <header className="topHeader" style={{ "--course-accent": course.accent } as CSSProperties}>
          <div>
            <p className="eyebrow">{course.shortCode}</p>
            <h1>{course.title}</h1>
          </div>
          <div className="headerStats">
            <span>{course.days.length} days</span>
            <span>{course.resources.length} resources</span>
            <span>{course.skills.length} skills</span>
          </div>
        </header>
        <main className="contentArea">{children}</main>
      </div>
    </div>
  );
}
