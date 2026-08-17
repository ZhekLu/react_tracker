import {
  annotationDisplayText,
  metadataText,
} from "../components/annotations/annotationDisplay";
import { parseExerciseProgress } from "./exerciseProgress";
import type { Annotation, Note, Resource, Task } from "../types/tracker";

export type ExerciseReviewStatus = "later" | "skipped" | "understood";
export type ExerciseReviewProgress = Record<string, ExerciseReviewStatus>;
export type ExerciseVisualStatus =
  | "unplanned"
  | "planned"
  | "my-solution"
  | "tutor"
  | "done"
  | "skipped";

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

export type ExerciseAnswerSection = {
  exercises: string[];
  markdown: string;
};

/** Split a tutor response at every explicit Exercise heading, regardless of level. */
export function exerciseAnswerSections(markdown: string): ExerciseAnswerSection[] {
  const headings = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gim)]
    .map((match) => ({
      exercises: exerciseNumbersInText(match[1]),
      index: match.index ?? 0,
    }))
    .filter((heading) => heading.exercises.length > 0);
  return headings.map((heading, index) => ({
    exercises: heading.exercises,
    markdown: markdown
      .slice(heading.index, headings[index + 1]?.index ?? markdown.length)
      .trim(),
  }));
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
    .filter((note) =>
      ["exercise_solution", "exercise_my_solution"].includes(note.kind),
    )
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

export function exerciseVisualStatus(
  exercise: string,
  task: Task,
  resource: Resource,
): ExerciseVisualStatus {
  const review = parseExerciseReviewProgress(
    task.notes.find((note) => note.kind === "exercise_review"),
  );
  if (review[exercise] === "understood") return "done";
  if (review[exercise] === "skipped") return "skipped";

  const noteContains = (kind: string) =>
    task.notes
      .filter((note) => note.kind === kind)
      .some((note) =>
        exerciseNumbersInText(
          note.document.markdown ?? note.document.plainText,
        ).includes(exercise),
      );
  if (noteContains("exercise_solution")) return "tutor";

  const resourceProgress = parseExerciseProgress(
    resource.notes.find((note) => note.kind === "exercise_progress"),
  );
  if (
    noteContains("exercise_my_solution") ||
    resourceProgress[exercise] === "read_partially" ||
    resourceProgress[exercise] === "read_fully"
  ) {
    return "my-solution";
  }
  return exerciseNumbersInText(task.title).includes(exercise)
    ? "planned"
    : "unplanned";
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
