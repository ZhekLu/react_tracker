import type { StudyDay, Task } from "../../types/tracker";

export type DayTone = "complete" | "question" | "later" | "open";

export function dayTasks(day: StudyDay): Task[] {
  return day.sections.flatMap((section) => section.tasks);
}

export function dayEstimatedMinutes(day: StudyDay): number {
  return dayTasks(day).reduce(
    (total, task) => total + (task.estimatedMinutes ?? 0),
    0,
  );
}

export function dayDisplayTopic(day: StudyDay): string {
  const topic = day.topic || day.title;
  return topic.replace(new RegExp(`^Day\\s+${day.number}\\s*:\\s*`, "i"), "");
}

export function isDayClosed(day: StudyDay): boolean {
  return day.status === "closed" || day.status === "completed" || day.status === "archived";
}

export function isDayFullyComplete(day: StudyDay): boolean {
  const requiredTasks = dayTasks(day).filter((task) => !task.isOptional);
  return requiredTasks.length > 0 && requiredTasks.every((task) => task.status === "done");
}

export function localDateKey(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function catchUpDayCount(
  days: StudyDay[],
  today = localDateKey(),
): number {
  return days.filter(
    (day) => Boolean(day.date && day.date < today) && !isDayFullyComplete(day),
  ).length;
}

export function dayTone(day: StudyDay): DayTone {
  if (day.openQuestionCount > 0) return "question";
  if (
    day.progress.later > 0 ||
    dayTasks(day).some((task) => task.status === "later") ||
    (isDayClosed(day) && !isDayFullyComplete(day))
  ) {
    return "later";
  }
  if (isDayFullyComplete(day)) return "complete";
  return "open";
}

export function dayToneLabel(day: StudyDay): string {
  const tone = dayTone(day);
  if (tone === "question") return `${day.openQuestionCount} open question${day.openQuestionCount === 1 ? "" : "s"}`;
  if (tone === "later") return "Work saved for later";
  if (tone === "complete") return "Fully completed";
  return isDayClosed(day) ? "Closed for now" : "Open";
}

export function formatTrackedTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "";
  if (totalSeconds < 60) return "<1m";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatPlannedTime(totalMinutes: number): string {
  if (totalMinutes <= 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
