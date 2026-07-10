import { Flame } from "lucide-react";
import type { CSSProperties } from "react";
import type { Course } from "../../types/tracker";
import {
  formatTrackedTime,
  isDayFullyComplete,
  localDateKey,
} from "../../features/roadmap/dayPresentation";
import { studyActivityLevel } from "../../lib/studyActivity";

type StudyMomentumPanelProps = {
  course: Course;
  trackedSecondsByDay: Record<string, number>;
};

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
      level: studyActivityLevel(
        day.progress.ratio,
        trackedSeconds,
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
