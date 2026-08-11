import { Dumbbell } from "lucide-react";
import type {
  Resource,
  ResourceChapterStatus,
} from "../../types/tracker";
import {
  nextExerciseStatus,
  parseExerciseProgress,
} from "../../lib/exerciseProgress";

export function BookExerciseProgress({
  chapterNumbers,
  onChange,
  resource,
}: {
  chapterNumbers: number[];
  onChange: (
    resource: Resource,
    exercise: string,
    status: ResourceChapterStatus,
  ) => void;
  resource: Resource;
}) {
  const note = resource.notes.find((item) => item.kind === "exercise_progress");
  const progress = parseExerciseProgress(note);
  const chapters = new Set(chapterNumbers.map(String));
  const exercises = Object.keys(progress).filter(
    (exercise) => !chapters.size || chapters.has(exercise.split(".")[0]),
  );
  if (!exercises.length) return null;
  const complete = exercises.filter(
    (exercise) => progress[exercise] === "read_fully",
  ).length;

  return (
    <div className="bookExerciseProgress">
      <span title="Chapter exercise progress">
        <Dumbbell size={10} /> {complete}/{exercises.length}
      </span>
      <div>
        {exercises.map((exercise) => (
          <button
            aria-label={`Exercise ${exercise}: ${progress[exercise].replaceAll("_", " ")}`}
            className={`exercise-${progress[exercise]}`}
            key={exercise}
            onClick={() =>
              onChange(
                resource,
                exercise,
                nextExerciseStatus(progress[exercise]),
              )
            }
            title={`Exercise ${exercise} · ${progress[exercise].replaceAll("_", " ")} · click to update`}
            type="button"
          >
            {exercise.split(".").at(-1)}
          </button>
        ))}
      </div>
    </div>
  );
}
