import {
  BookOpen,
  CalendarDays,
  FileQuestion,
  MessageSquareText,
  Sparkles,
  StickyNote,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  dayDisplayTopic,
  formatTrackedTime,
} from "../features/roadmap/dayPresentation";
import { percent } from "../lib/progress";
import type { Course, CourseSummary, TrackerView } from "../types/tracker";
import { ProgressBar } from "./ProgressBar";
import { ProgressRing } from "./ui/ProgressRing";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type AppShellProps = {
  activeDayId: string;
  course: Course;
  courses: CourseSummary[];
  view: TrackerView;
  onViewChange: (view: TrackerView) => void;
  onCourseChange: (courseId: string) => void;
  children: ReactNode;
};

const viewMeta = {
  roadmap: { label: "Roadmap", icon: CalendarDays },
  resources: { label: "Resources", icon: BookOpen },
  exams: { label: "Exams", icon: FileQuestion },
  notes: { label: "Notes", icon: StickyNote },
  discussions: { label: "Discussions", icon: MessageSquareText },
} satisfies Record<TrackerView, { label: string; icon: typeof CalendarDays }>;

export function AppShell({
  activeDayId,
  course,
  courses,
  view,
  onViewChange,
  onCourseChange,
  children,
}: AppShellProps) {
  const courseProgress = course.stats.progressRatio;
  const activeView = viewMeta[view];
  const ActiveViewIcon = activeView.icon;
  const activeDay = course.days.find((day) => day.id === activeDayId) ?? course.days[0];
  const activeDayTasks = activeDay?.sections.flatMap((section) => section.tasks) ?? [];
  const activeDayDone = activeDayTasks.filter((task) => task.status === "done").length;
  const headerProgress = view === "roadmap" && activeDay ? activeDay.progress.ratio : courseProgress;

  return (
    <div className="appShell" style={{ "--course-accent": course.accent } as CSSProperties}>
      <WorkspaceSidebar
        activeDayId={activeDay?.id ?? ""}
        course={course}
        courses={courses}
        onCourseChange={onCourseChange}
        onViewChange={onViewChange}
        view={view}
      />

      <div className="mainArea">
        <header className="topHeader">
          <div className="headerIdentity">
            <span className="headerViewIcon"><ActiveViewIcon size={18} /></span>
            <div>
              <p className="eyebrow">{course.title}</p>
              <h1>{activeView.label}</h1>
              {view === "roadmap" && activeDay ? (
                <p className="headerDayContext">
                  <strong>Day {activeDay.number}: {dayDisplayTopic(activeDay)}</strong>
                  <span>{activeDayDone}/{activeDayTasks.length} tasks</span>
                  {activeDay.openQuestionCount ? <span>{activeDay.openQuestionCount} questions</span> : null}
                  {activeDay.progress.later ? <span>{activeDay.progress.later} later</span> : null}
                  {activeDay.trackedSeconds ? <span>{formatTrackedTime(activeDay.trackedSeconds)}</span> : null}
                </p>
              ) : null}
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
          <div className="topHeaderProgress">
            <ProgressBar
              accent={course.accent}
              label={view === "roadmap" ? "Current day progress" : "Course progress"}
              showValue
              value={headerProgress}
            />
          </div>
        </header>
        <main className="contentArea">{children}</main>
      </div>
    </div>
  );
}
