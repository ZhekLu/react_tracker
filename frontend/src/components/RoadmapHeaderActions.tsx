import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  CheckCheck,
  CircleHelp,
  ClipboardCopy,
  Crosshair,
  LocateFixed,
  MessageSquareText,
  SkipForward,
  StickyNote,
  Timer,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import type { Course, StudyDay, TrackerView } from "../types/tracker";

type RoadmapHeaderActionsProps = {
  activeDay: StudyDay;
  course: Course;
  currentView: TrackerView;
  onBack: () => void;
  onCopyDayPrompt: (day: StudyDay, includeTutorSolutions: boolean) => void;
  onCopyDayQuestions: (day: StudyDay) => void;
  onDayClosedChange: (day: StudyDay, closed: boolean) => void;
  onOpenDay: (dayId: string) => void;
  onToggleToggl: () => void;
  onSyncToggl: () => Promise<unknown>;
  onViewChange: (view: TrackerView) => void;
  toggl: {
    syncedAt?: string | null;
    syncIntervalSeconds?: number;
    activeTaskId?: string | null;
    activeForDay: boolean;
    busy: boolean;
    configured: boolean;
    error: string;
    online: boolean;
    running: boolean;
  };
};

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function isOpenDay(day: StudyDay): boolean {
  return day.status === "open" || day.status === "not_started";
}

export function RoadmapHeaderActions({
  activeDay,
  course,
  currentView,
  onBack,
  onCopyDayPrompt,
  onCopyDayQuestions,
  onDayClosedChange,
  onOpenDay,
  onToggleToggl,
  onSyncToggl,
  onViewChange,
  toggl,
}: RoadmapHeaderActionsProps) {
  const [includeTutorSolutions, setIncludeTutorSolutions] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const today = course.days.find((day) => day.date === localDate());
  const nextOpen = course.days.find(isOpenDay);
  const currentTaskDay = toggl.activeTaskId
    ? course.days.find((day) =>
        day.sections.some((section) =>
          section.tasks.some((task) => task.id === toggl.activeTaskId),
        ),
      )
    : undefined;
  const closed = ["closed", "completed", "archived"].includes(
    activeDay.status,
  );
  const togglTitle =
    toggl.error ||
    (!toggl.online
      ? "Start make react-api to enable time tracking"
      : !toggl.configured
        ? "Configure toggl_config.json to enable time tracking"
        : toggl.running
          ? "Stop the current tracker timer"
          : "Start timing the current day");

  return (
    <nav className="roadmapHeaderActionGrid" aria-label="Workspace shortcuts">
      <button aria-label="Go back" onClick={onBack} title="Back" type="button">
        <ArrowLeft size={15} />
      </button>
      <button
        aria-label="Go to today"
        disabled={!today}
        onClick={() => today && onOpenDay(today.id)}
        title={today ? `Today · Day ${today.number}` : "No plan day today"}
        type="button"
      >
        <LocateFixed size={15} />
      </button>
      <button
        aria-label="Go to next open day"
        disabled={!nextOpen}
        onClick={() => nextOpen && onOpenDay(nextOpen.id)}
        title={
          nextOpen
            ? `Next open · Day ${nextOpen.number}`
            : "No open days remain"
        }
        type="button"
      >
        <SkipForward size={15} />
      </button>
      <button
        aria-label="Return to current task"
        className={currentTaskDay ? "currentTaskAction active" : "currentTaskAction"}
        disabled={!currentTaskDay}
        onClick={() => currentTaskDay && onOpenDay(currentTaskDay.id)}
        title={
          currentTaskDay
            ? `Current timer · Day ${currentTaskDay.number}`
            : "Start a task timer to pin your current task"
        }
        type="button"
      >
        <Crosshair size={15} />
      </button>
      <button
        aria-label="Copy day prompt and start discussion"
        onClick={() => onCopyDayPrompt(activeDay, includeTutorSolutions)}
        title="Copy structured day prompt and start its discussion"
        type="button"
      >
        <ClipboardCopy size={15} />
      </button>
      <button
        aria-label="Include mapped tutor exercise solutions in day prompt"
        aria-pressed={includeTutorSolutions}
        className={includeTutorSolutions ? "active" : ""}
        onClick={() => setIncludeTutorSolutions((current) => !current)}
        title={includeTutorSolutions ? "Tutor solutions will be included" : "Tutor solutions are excluded (click to include)"}
        type="button"
      >
        <BookMarked size={15} />
      </button>
      <button
        aria-label="Copy day questions"
        onClick={() => onCopyDayQuestions(activeDay)}
        title="Copy current-day questions"
        type="button"
      >
        <CircleHelp size={15} />
      </button>
      <button
        aria-label="Open resources"
        className={currentView === "resources" ? "active" : ""}
        onClick={() => onViewChange("resources")}
        title="Resources"
        type="button"
      >
        <BookOpen size={15} />
      </button>
      <button
        aria-label="Open notes"
        className={currentView === "notes" ? "active" : ""}
        onClick={() => onViewChange("notes")}
        title="Notes and questions"
        type="button"
      >
        <StickyNote size={15} />
      </button>
      <button
        aria-label="Open discussions"
        className={currentView === "discussions" ? "active" : ""}
        onClick={() => onViewChange("discussions")}
        title="Discussions"
        type="button"
      >
        <MessageSquareText size={15} />
      </button>
      <button
        aria-label={closed ? "Reopen current day" : "Close current day"}
        className={closed ? "active" : ""}
        onClick={() => onDayClosedChange(activeDay, !closed)}
        title={closed ? "Reopen current day" : "Close current day"}
        type="button"
      >
        <CheckCheck size={15} />
      </button>
      <button
        aria-label={toggl.running ? "Stop Toggl" : "Start Toggl"}
        className={
          toggl.running
            ? toggl.activeForDay
              ? "togglAction active"
              : "togglAction runningElsewhere"
            : "togglAction"
        }
        disabled={toggl.busy || !toggl.online || !toggl.configured}
        onClick={onToggleToggl}
        title={togglTitle}
        type="button"
      >
        <Timer size={15} />
      </button>
      <button aria-label="Sync Toggl time" disabled={syncing || toggl.busy || !toggl.configured}
        onClick={async () => { setSyncing(true); try { await onSyncToggl(); } finally { setSyncing(false); } }}
        title={`${toggl.syncedAt ? `Last synced ${new Date(toggl.syncedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}. ` : ""}Auto sync every ${Math.round((toggl.syncIntervalSeconds ?? 600) / 60)} minutes while open. Click to sync phone/desktop time now (request limits still apply).`}
        type="button"><RefreshCw size={15}/></button>
    </nav>
  );
}
