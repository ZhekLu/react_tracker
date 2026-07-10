import { describe, expect, it } from "vitest";
import type { Resource, Task } from "../../types/tracker";
import { taskTimerShortName } from "./taskTimer";

const task = (changes: Partial<Task>): Task => ({
  chapterNumbers: [],
  dayId: "day-2",
  examQuestionIds: [],
  id: "task",
  isOptional: false,
  notes: [],
  openQuestionCount: 0,
  orderIndex: 0,
  resourceIds: [],
  revision: 1,
  skillIds: [],
  status: "todo",
  title: "Study",
  ...changes,
});

const resource = (changes: Partial<Resource>): Resource => ({
  annotations: [],
  authors: [],
  dayIds: [],
  format: "pdf",
  id: "resource",
  kind: "other",
  localFiles: [],
  metadata: {},
  notes: [],
  openQuestionCount: 0,
  progress: 0,
  revision: 1,
  sourceType: "local",
  status: "unread",
  taskIds: [],
  title: "Resource",
  ...changes,
});

describe("task timer names", () => {
  it("names the RL book and its exercises semantically", () => {
    const book = resource({
      kind: "book",
      title: "Reinforcement Learning: An Introduction, second edition",
    });
    expect(taskTimerShortName(task({ title: "Read Sections 2.1-2.4" }), [book])).toBe(
      "Read RL book",
    );
    expect(
      taskTimerShortName(
        task({ taskType: "solve", title: "Solve Exercises 3.4 and 3.8" }),
        [book],
      ),
    ).toBe("Do exercise from book");
  });

  it("collapses linked lectures into an LC range", () => {
    expect(
      taskTimerShortName(task({ title: "Read both lectures" }), [
        resource({ kind: "slides", title: "UniPD Lecture 4 — MDPs" }),
        resource({ kind: "slides", title: "UniPD Lecture 5 — Bellman equations" }),
      ]),
    ).toBe("LC 4-5");
  });

  it("uses a compact action for papers", () => {
    expect(
      taskTimerShortName(task({ title: "Read and annotate the paper in depth" }), [
        resource({ kind: "paper", title: "A very long paper title" }),
      ]),
    ).toBe("Read paper");
  });
});
