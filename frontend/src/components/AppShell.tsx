import {
  BookOpen,
  CalendarDays,
  FileQuestion,
  MessageSquareText,
  ScanSearch,
  StickyNote,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  dayEstimatedMinutes,
  dayDisplayTopic,
  catchUpDayCount,
  formatPlannedTime,
  formatTrackedTime,
} from "../features/roadmap/dayPresentation";
import type {
  Course,
  CourseSummary,
  StudyDay,
  TrackerView,
} from "../types/tracker";
import { ProgressBar } from "./ProgressBar";
import { ProgressRing } from "./ui/ProgressRing";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { RoadmapHeaderActions } from "./RoadmapHeaderActions";

type AppShellProps = {
  activeDayId: string;
  course: Course;
  courses: CourseSummary[];
  view: TrackerView;
  onViewChange: (view: TrackerView) => void;
  onBack: () => void;
  onOpenDay: (dayId: string) => void;
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
    trackedSecondsByDay: Record<string, number>;
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
  onBack,
  onOpenDay,
  toggl,
  children,
}: AppShellProps) {
  const courseProgress = course.stats.progressRatio;
  const activeView = viewMeta[view];
  const ActiveViewIcon = activeView.icon;
  const activeDay = course.days.find((day) => day.id === activeDayId) ?? course.days[0];
  const activeDayTasks = activeDay?.sections.flatMap((section) => section.tasks) ?? [];
  const activeDayPlannedMinutes = activeDay ? dayEstimatedMinutes(activeDay) : 0;
  const activeDayDone = activeDayTasks.filter((task) => task.status === "done").length;
  const catchUpDays = catchUpDayCount(course.days);
  const headerProgress = view === "roadmap" && activeDay ? activeDay.progress.ratio : courseProgress;

  return (
    <div className="appShell" style={{ "--course-accent": course.accent } as CSSProperties}>
      <WorkspaceSidebar
        activeDayId={activeDay?.id ?? ""}
        course={course}
        courses={courses}
        onCourseChange={onCourseChange}
        onOpenDay={onOpenDay}
        onViewChange={onViewChange}
        trackedSecondsByDay={toggl.trackedSecondsByDay}
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
                  {catchUpDays ? (
                    <span className="catchUpProgress">
                      {catchUpDays} day{catchUpDays === 1 ? "" : "s"} to catch up
                    </span>
                  ) : null}
                  {activeDayPlannedMinutes ? (
                    <span>
                      {formatTrackedTime(
                        Math.max(
                          activeDay.trackedSeconds,
                          toggl.trackedSecondsByDay[activeDay.id] ?? 0,
                        ),
                      ) || "0m"} /{" "}
                      {formatPlannedTime(activeDayPlannedMinutes)} planned
                    </span>
                  ) : activeDay.trackedSeconds ? (
                    <span>{formatTrackedTime(activeDay.trackedSeconds)}</span>
                  ) : null}
                  {toggl.trackedSeconds > activeDay.trackedSeconds ? (
                    <span>{formatTrackedTime(toggl.trackedSeconds)} live</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
          {view === "roadmap" && activeDay ? (
            <RoadmapHeaderActions
              activeDay={activeDay}
              course={course}
              onBack={onBack}
              onCopyDayPrompt={onCopyDayPrompt}
              onCopyDayQuestions={onCopyDayQuestions}
              onDayClosedChange={onDayClosedChange}
              onOpenDay={onOpenDay}
              onToggleToggl={onToggleToggl}
              onViewChange={onViewChange}
              toggl={toggl}
            />
          ) : null}
          <div className="headerProgress">
            <ProgressRing accent={course.accent} label="Course progress" size="small" value={courseProgress} />
          </div>
          <div className="topHeaderProgress">
            <ProgressBar
              accent={course.accent}
              label={view === "roadmap" ? "Current day progress" : "Course progress"}
              value={headerProgress}
            />
          </div>
        </header>
        <main className="contentArea">{children}</main>
      </div>
    </div>
  );
}
