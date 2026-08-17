import { describe, expect, it } from "vitest";
import type { StudyDay, Task } from "../../types/tracker";
import { catchUpDayCount } from "./dayPresentation";

function day(date: string, taskStatus: Task["status"]): StudyDay {
  return {
    date,
    id: date,
    notes: [],
    number: 1,
    openQuestionCount: 0,
    postponedQuestionCount: 0,
    progress: { done: 0, later: 0, optional: 0, ratio: 0, required: 1, skipped: 0 },
    revision: 1,
    sections: [{
      defaultCollapsed: false,
      id: "section",
      orderIndex: 0,
      tasks: [{
        chapterNumbers: [],
        dayId: date,
        examQuestionIds: [],
        id: `task-${date}`,
        isOptional: false,
        notes: [],
        openQuestionCount: 0,
        orderIndex: 0,
        resourceIds: [],
        revision: 1,
        skillIds: [],
        status: taskStatus,
        title: "Study",
      }],
      title: "Core",
    }],
    skillIds: [],
    status: taskStatus === "done" ? "completed" : "open",
    title: "Day",
    trackedSeconds: 0,
  };
}

describe("catch-up progress", () => {
  it("counts unfinished scheduled days before today only", () => {
    expect(catchUpDayCount([
      day("2026-07-07", "done"),
      day("2026-07-08", "todo"),
      day("2026-07-10", "todo"),
      day("2026-07-11", "todo"),
    ], "2026-07-10")).toBe(1);
  });
});
