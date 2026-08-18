import { Dumbbell } from "lucide-react";
import type {
  Resource,
  ResourceChapterStatus,
} from "../../types/tracker";
import {
  nextExerciseStatus,
  parseExerciseProgress,
} from "../../lib/exerciseProgress";
import {
  exerciseNumbersForTask,
  exerciseVisualStatus,
  isExerciseTask,
} from "../../lib/exerciseReview";
import type { Task } from "../../types/tracker";

export function BookExerciseProgress({
  onChange,
  resource,
  task,
}: {
  onChange: (
    resource: Resource,
    exercise: string,
    status: ResourceChapterStatus,
  ) => void;
  resource: Resource;
  task: Task;
}) {
  if (!isExerciseTask(task)) return null;
  const note = resource.notes.find((item) => item.kind === "exercise_progress");
  const progress = parseExerciseProgress(note);
  const exercises = exerciseNumbersForTask(task, resource);
  if (!exercises.length) return null;
  const complete = exercises.filter(
    (exercise) => exerciseVisualStatus(exercise, task, resource) === "done",
  ).length;

  return (
    <div className="bookExerciseProgress">
      <span title="Chapter exercise progress">
        <Dumbbell size={10} /> {complete}/{exercises.length}
      </span>
      <div>
        {exercises.map((exercise) => (
          <button
            aria-label={`Exercise ${exercise}: ${exerciseVisualStatus(exercise, task, resource).replaceAll("-", " ")}`}
            className={`exercise-state-${exerciseVisualStatus(exercise, task, resource)}`}
            key={exercise}
            onClick={() =>
              onChange(
                resource,
                exercise,
                nextExerciseStatus(progress[exercise] ?? "unread"),
              )
            }
            title={`Exercise ${exercise} · ${exerciseVisualStatus(exercise, task, resource).replaceAll("-", " ")} · click to update book progress`}
            type="button"
          >
            {exercise.split(".").at(-1)}
          </button>
        ))}
      </div>
    </div>
  );
}
