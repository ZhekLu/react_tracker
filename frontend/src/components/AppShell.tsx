import {
  BookOpen,
  CalendarDays,
  CheckCheck,
  ClipboardCopy,
  CircleHelp,
  FileQuestion,
  MessageSquareText,
  ScanSearch,
  StickyNote,
  Timer,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  dayDisplayTopic,
  formatTrackedTime,
} from "../features/roadmap/dayPresentation";
import { percent } from "../lib/progress";
import type {
  Course,
  CourseSummary,
  StudyDay,
  TrackerView,
} from "../types/tracker";
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
  onCopyDayPrompt: (day: StudyDay) => void;
  onCopyDayQuestions: (day: StudyDay) => void;
  onDayClosedChange: (day: StudyDay, closed: boolean) => void;
  onToggleToggl: () => void;
  toggl: {
    activeForDay: boolean;
    busy: boolean;
    configured: boolean;
    courseTrackedSeconds: number;
    error: string;
    online: boolean;
    running: boolean;
    trackedSeconds: number;
  };
  children: ReactNode;
};

const viewMeta = {
  roadmap: { label: "Roadmap", icon: CalendarDays },
  resources: { label: "Resources", icon: BookOpen },
  skills: { label: "Skills", icon: ScanSearch },
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
  onCopyDayPrompt,
  onCopyDayQuestions,
  onDayClosedChange,
  onToggleToggl,
  toggl,
  children,
}: AppShellProps) {
  const courseProgress = course.stats.progressRatio;
  const activeView = viewMeta[view];
  const ActiveViewIcon = activeView.icon;
  const activeDay = course.days.find((day) => day.id === activeDayId) ?? course.days[0];
  const activeDayTasks = activeDay?.sections.flatMap((section) => section.tasks) ?? [];
  const activeDayDone = activeDayTasks.filter((task) => task.status === "done").length;
  const headerProgress = view === "roadmap" && activeDay ? activeDay.progress.ratio : courseProgress;
  const completedTasks = course.stats.completedTaskCount;
  const totalTasks = course.stats.taskCount;

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
                  {toggl.trackedSeconds > activeDay.trackedSeconds ? (
                    <span>{formatTrackedTime(toggl.trackedSeconds)} live</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
          {view === "roadmap" && activeDay ? (
            <div className="headerQuickActions">
              <button
                onClick={() => onCopyDayPrompt(activeDay)}
                title="Copy the current day as a structured GPT prompt"
                type="button"
              >
                <ClipboardCopy size={14} />
                <span>Copy GPT</span>
              </button>
              <button
                onClick={() => onCopyDayQuestions(activeDay)}
                title="Copy only structured questions for the current day"
                type="button"
              >
                <CircleHelp size={14} />
                <span>Questions</span>
              </button>
              <button
                onClick={() =>
                  onDayClosedChange(
                    activeDay,
                    !["closed", "completed", "archived"].includes(
                      activeDay.status,
                    ),
                  )
                }
                title={
                  ["closed", "completed", "archived"].includes(activeDay.status)
                    ? "Reopen current day"
                    : "Close current day"
                }
                type="button"
              >
                <CheckCheck size={14} />
                <span>
                  {["closed", "completed", "archived"].includes(activeDay.status)
                    ? "Reopen"
                    : "Close"}
                </span>
              </button>
              <button
                className={
                  toggl.running
                    ? toggl.activeForDay
                      ? "togglAction active"
                      : "togglAction runningElsewhere"
                    : "togglAction"
                }
                disabled={toggl.busy || !toggl.online || !toggl.configured}
                onClick={onToggleToggl}
                title={
                  toggl.error ||
                  (!toggl.online
                    ? "Start make toggl-server to enable time tracking"
                    : !toggl.configured
                    ? "Configure toggl_config.json to enable time tracking"
                    : toggl.running
                    ? "Stop the current tracker timer"
                    : "Start timing the current day")
                }
                type="button"
              >
                <Timer size={14} />
                <span>
                  {toggl.busy
                    ? "Toggl…"
                    : !toggl.online
                    ? "Toggl off"
                    : !toggl.configured
                    ? "Toggl setup"
                    : toggl.running
                    ? "Stop Toggl"
                    : "Start Toggl"}
                </span>
              </button>
            </div>
          ) : null}
          <div className="headerProgress">
            <div className="momentumBlock">
              <span>Course momentum</span>
              <strong>{percent(courseProgress)}</strong>
              <small>{completedTasks} of {totalTasks} tasks complete</small>
              {toggl.courseTrackedSeconds ? (
                <small>{formatTrackedTime(toggl.courseTrackedSeconds)} tracked</small>
              ) : null}
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
