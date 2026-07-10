import type { Resource, Task } from "../../types/tracker";

function lectureNumbers(value: string): number[] {
  return Array.from(
    value.matchAll(/\b(?:lc|lecture)\s*(\d+)\b/gi),
    (match) => Number(match[1]),
  ).filter(Number.isFinite);
}

function lectureLabel(task: Task, resources: Resource[]): string | null {
  const numbers = Array.from(
    new Set(
      [task.title, ...resources.map((resource) => resource.title)].flatMap(
        lectureNumbers,
      ),
    ),
  ).sort((left, right) => left - right);
  if (!numbers.length) return null;
  if (numbers.length === 1) return `LC ${numbers[0]}`;
  const consecutive = numbers.every(
    (number, index) => index === 0 || number === numbers[index - 1] + 1,
  );
  return consecutive
    ? `LC ${numbers[0]}-${numbers.at(-1)}`
    : `LC ${numbers.join(", ")}`;
}

function compactFallback(title: string): string {
  const firstAction = title.split(/[;:.]/, 1)[0].trim();
  return firstAction.split(/\s+/).slice(0, 10).join(" ") || "Study task";
}

export function taskTimerShortName(task: Task, resources: Resource[]): string {
  const kinds = new Set(resources.map((resource) => resource.kind));
  const title = task.title.toLocaleLowerCase();
  const lecture = lectureLabel(task, resources);
  if (lecture && (kinds.has("slides") || /\b(?:lc|lecture)\b/i.test(task.title))) {
    return lecture;
  }
  const isExercise =
    ["code", "solve"].includes(task.taskType ?? "") ||
    /\b(?:exercise|derive|implement|solve|reproduce)\b/.test(title);
  if (isExercise && kinds.has("book")) return "Do exercise from book";
  if (isExercise) return "Do exercise";
  if (kinds.has("paper")) return "Read paper";
  if (kinds.has("book")) {
    return resources.some(
      (resource) =>
        resource.kind === "book" &&
        /reinforcement learning:\s*an introduction/i.test(resource.title),
    )
      ? "Read RL book"
      : "Read book";
  }
  return compactFallback(task.title);
}
