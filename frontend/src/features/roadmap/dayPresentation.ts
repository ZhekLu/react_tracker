import type { StudyDay, Task } from "../../types/tracker";

export type DayTone = "complete" | "question" | "later" | "open";

export function dayTasks(day: StudyDay): Task[] {
  return day.sections.flatMap((section) => section.tasks);
}

export function dayEstimatedMinutes(day: StudyDay): number {
  return dayTasks(day).filter(task => task.status !== "skipped").reduce(
    (total, task) => total + (task.estimatedMinutes ?? 0),
    0,
  );
}

export function dayOptionalMinutes(day: StudyDay): number {
  return dayTasks(day).filter(task => task.isOptional && task.status !== "skipped")
    .reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0);
}

export function dayRemainingWork(day: StudyDay) {
  const remaining = dayTasks(day).filter(task => !task.isOptional && !["done", "skipped"].includes(task.status));
  return {count: remaining.length, minutes: remaining.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0),
    unestimated: remaining.filter(task => !task.estimatedMinutes).length,
    next: remaining.find(task => task.status === "in_progress") ?? remaining.find(task => task.status === "todo"),
  };
}

/** Status is authoritative even when an old patch placed a task in Cancelled. */
export function dayVisibleSections(day: StudyDay): StudyDay["sections"] {
  const restored: Task[] = [];
  const sections = day.sections.map(section => {
    if (!/^(cancelled|canceled|skipped|skip)$/i.test(section.title.trim())) return section;
    restored.push(...section.tasks.filter(task => task.status !== "skipped").map(task => ({
      ...task, title: task.title.replace(/^CANCELLED\s*[—–:-]\s*/i, ""),
    })));
    return {...section, tasks: section.tasks.filter(task => task.status === "skipped")};
  }).filter(section => section.tasks.length);
  if (!restored.length) return sections;
  const cancelledIndex = sections.findIndex(section => /^(cancelled|canceled|skipped|skip)$/i.test(section.title.trim()));
  sections.splice(cancelledIndex < 0 ? sections.length : cancelledIndex, 0, {
    id: `${day.id}:restored`, title: "Restored work", orderIndex: 0,
    defaultCollapsed: false, tasks: restored,
  });
  return sections;
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
  return requiredTasks.length > 0 && requiredTasks.every((task) => task.status === "done" || task.status === "skipped");
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
  if (tone === "question") {
    const todos = day.todoCounts?.open ?? 0;
    const questions = Math.max(0, day.openQuestionCount - todos);
    return [
      questions ? `${questions} open question${questions === 1 ? "" : "s"}` : "",
      todos ? `${todos} open to-do${todos === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(" · ");
  }
  if (tone === "later") return "Work saved for later";
  if (tone === "complete") return "Fully completed";
  return isDayClosed(day) ? "Closed for now" : "Open";
}

export function formatTrackedTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "";
  if (totalSeconds < 60) return "<1m";
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
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
