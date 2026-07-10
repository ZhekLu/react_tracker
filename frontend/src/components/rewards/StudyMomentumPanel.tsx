import { Flame } from "lucide-react";
import type { CSSProperties } from "react";
import type { Course } from "../../types/tracker";
import {
  dayEstimatedMinutes,
  formatTrackedTime,
  isDayFullyComplete,
  localDateKey,
} from "../../features/roadmap/dayPresentation";

type StudyMomentumPanelProps = {
  course: Course;
  trackedSecondsByDay: Record<string, number>;
};

function activityLevel(
  progress: number,
  trackedSeconds: number,
  plannedMinutes: number,
): number {
  const timeRatio = plannedMinutes
    ? trackedSeconds / (plannedMinutes * 60)
    : trackedSeconds
      ? 0.35
      : 0;
  const value = Math.max(progress, Math.min(1, timeRatio));
  if (value <= 0) return 0;
  if (value < 0.25) return 1;
  if (value < 0.55) return 2;
  if (value < 0.9) return 3;
  return 4;
}

export function StudyMomentumPanel({
  course,
  trackedSecondsByDay,
}: StudyMomentumPanelProps) {
  const activity = course.days.map((day) => {
    const trackedSeconds = Math.max(
      day.trackedSeconds,
      trackedSecondsByDay[day.id] ?? 0,
    );
    return {
      day,
      level: activityLevel(
        day.progress.ratio,
        trackedSeconds,
        dayEstimatedMinutes(day),
      ),
      trackedSeconds,
    };
  });
  let lastActiveIndex = -1;
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    if (activity[index].level > 0) {
      lastActiveIndex = index;
      break;
    }
  }
  let streak = 0;
  for (let index = lastActiveIndex; index >= 0; index -= 1) {
    if (activity[index].level === 0) break;
    streak += 1;
  }
  const focusedDays = activity.filter((item) => item.level > 0).length;
  const today = localDateKey();
  const firstCatchUpDayId = activity.find(
    ({ day }) => Boolean(day.date && day.date < today) && !isDayFullyComplete(day),
  )?.day.id;

  return (
    <section className="studyMomentumPanel" aria-label="Study activity">
      <header>
        <span>
          <Flame size={13} />
          <strong>{streak}</strong> day streak
        </span>
        <small>{focusedDays} active</small>
      </header>
      <div className="studyActivityGrid">
        {activity.map(({ day, level, trackedSeconds }) => {
          const plannedByNow = Boolean(day.date && day.date <= today);
          const catchUpTarget = day.id === firstCatchUpDayId;
          return (
          <span
            aria-label={`Day ${day.number}: activity level ${level} of 4${catchUpTarget ? ", current catch-up target" : ""}`}
            className={`activityLevel-${level} ${plannedByNow ? "plannedByNow" : ""} ${catchUpTarget ? "catchUpTarget" : ""}`}
            key={day.id}
            style={{ "--activity-level": level } as CSSProperties}
            title={`Day ${day.number} · ${Math.round(
              day.progress.ratio * 100,
            )}% · ${formatTrackedTime(trackedSeconds) || "no tracked time"}`}
          />
          );
        })}
      </div>
    </section>
  );
}
