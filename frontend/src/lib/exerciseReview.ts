import {
  annotationDisplayText,
  metadataText,
} from "../components/annotations/annotationDisplay";
import { parseExerciseProgress } from "./exerciseProgress";
import type { Annotation, Note, Resource, Task } from "../types/tracker";

export type ExerciseReviewStatus = "later" | "skipped" | "understood";
export type ExerciseReviewProgress = Record<string, ExerciseReviewStatus>;

const ENTRY = /^- Exercise\s+(\d+(?:\.\d+)+):\s+(later|skipped|understood)$/gm;
const NUMBER = /\bExercise\s+(\d+(?:\.\d+)+)\b/gi;
const NUMBER_LIST = /\bExercises?\s+([^;:\n]+)/gi;

export function parseExerciseReviewProgress(note?: Note): ExerciseReviewProgress {
  const markdown = note?.document.markdown ?? note?.document.plainText ?? "";
  return Object.fromEntries(
    [...markdown.matchAll(ENTRY)].map((match) => [
      match[1],
      match[2] as ExerciseReviewStatus,
    ]),
  );
}

export function serializeExerciseReviewProgress(
  progress: ExerciseReviewProgress,
): string {
  const entries = Object.entries(progress).sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  return [
    "<!-- tracker-exercise-review-v1 -->",
    "# Exercise answer review",
    "",
    ...entries.map(([exercise, status]) => `- Exercise ${exercise}: ${status}`),
  ].join("\n");
}

export function exerciseNumbersInText(value: string): string[] {
  const singles = [...value.matchAll(NUMBER)].map((match) => match[1]);
  const lists = [...value.matchAll(NUMBER_LIST)].flatMap((match) =>
    [...match[1].matchAll(/\d+(?:\.\d+)+/g)].map((number) => number[0]),
  );
  return [...new Set([...singles, ...lists])];
}

export function annotationExerciseNumbers(annotation: Annotation): string[] {
  return [...new Set(
    [
      annotationDisplayText(annotation),
      annotation.anchor?.quote ?? "",
      annotation.anchor?.sectionTitle ?? "",
      metadataText(annotation, "contextBefore"),
      metadataText(annotation, "contextSentence"),
      metadataText(annotation, "contextParagraph"),
      metadataText(annotation, "contextAfter"),
    ].flatMap(exerciseNumbersInText),
  )];
}

export function exerciseNumbersForTask(task: Task, resource: Resource): string[] {
  const chapters = task.chapterNumbers;
  const inTaskChapter = (number: string) => {
    const chapter = Number(number.split(".")[0]);
    return !chapters.length || chapters.includes(chapter);
  };
  const resourceProgress = parseExerciseProgress(
    resource.notes.find((note) => note.kind === "exercise_progress"),
  );
  const annotationNumbers = resource.annotations
    .filter((annotation) => {
      const chapter = Number(annotation.anchor?.metadata?.chapterNumber ?? 0);
      return !chapters.length || !chapter || chapters.includes(chapter);
    })
    .flatMap(annotationExerciseNumbers);
  const mappedNumbers = task.notes
    .filter((note) => note.kind === "exercise_solution")
    .flatMap((note) =>
      exerciseNumbersInText(note.document.markdown ?? note.document.plainText),
    );
  return [...new Set([
    ...Object.keys(resourceProgress),
    ...annotationNumbers,
    ...mappedNumbers,
    ...exerciseNumbersInText(task.title),
  ])]
    .filter(inTaskChapter)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function combinedExerciseReviewStatus(
  exerciseNumbers: string[],
  progress: ExerciseReviewProgress,
): ExerciseReviewStatus | "unreviewed" | "mixed" {
  const statuses = [...new Set(
    exerciseNumbers.map((number) => progress[number] ?? "unreviewed"),
  )];
  return statuses.length === 1 ? statuses[0] : "mixed";
}

export function exerciseReviewCounts(
  exerciseNumbers: string[],
  requiredNumbers: string[],
  progress: ExerciseReviewProgress,
) {
  const reviewed = (number: string) =>
    ["understood", "skipped"].includes(progress[number] ?? "");
  return {
    requiredReviewed: requiredNumbers.filter(reviewed).length,
    requiredTotal: requiredNumbers.length,
    totalReviewed: exerciseNumbers.filter(reviewed).length,
    total: exerciseNumbers.length,
  };
}
