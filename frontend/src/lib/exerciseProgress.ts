import type {
  Note,
  ResourceChapterStatus,
} from "../types/tracker";
import { nextChapterStatus } from "./chapterProgress";

export type ExerciseProgress = Record<string, ResourceChapterStatus>;

const ENTRY = /^- Exercise\s+(\d+(?:\.\d+)+):\s+(unread|read_partially|read_fully)$/gm;

export function parseExerciseProgress(note?: Note): ExerciseProgress {
  const markdown = note?.document.markdown ?? note?.document.plainText ?? "";
  return Object.fromEntries(
    [...markdown.matchAll(ENTRY)].map((match) => [
      match[1],
      match[2] as ResourceChapterStatus,
    ]),
  );
}

export function serializeExerciseProgress(progress: ExerciseProgress): string {
  const entries = Object.entries(progress).sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  return [
    "<!-- tracker-exercise-progress-v1 -->",
    "# Exercise progress",
    "",
    ...entries.map(([exercise, status]) => `- Exercise ${exercise}: ${status}`),
  ].join("\n");
}

export function nextExerciseStatus(
  status: ResourceChapterStatus,
): ResourceChapterStatus {
  return nextChapterStatus(status);
}
