import { describe, expect, it } from "vitest";
import type { StudyDay, Task } from "../../types/tracker";
import { catchUpDayCount, dayEstimatedMinutes, dayOptionalMinutes, dayVisibleSections, dayToneLabel, dayRemainingWork } from "./dayPresentation";

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
  it("shows remaining core work without treating optional, cancelled, or finished tasks as remaining", () => {
    const sample = day("today", "todo"); const base = sample.sections[0].tasks[0];
    sample.sections[0].tasks = [{...base, id: "done", status: "done", estimatedMinutes: 60},
      {...base, id: "skip", status: "skipped", estimatedMinutes: 60},
      {...base, id: "optional", isOptional: true, estimatedMinutes: 60},
      {...base, id: "later", status: "later", estimatedMinutes: 20},
      {...base, id: "now", status: "in_progress", estimatedMinutes: 15},
      {...base, id: "unestimated"}];
    expect(dayRemainingWork(sample)).toMatchObject({count: 3, minutes: 35, unestimated: 1, next: {id: "now"}});
  });
  it("names remaining todos accurately on a completed day", () => {
    const completed = day("2026-09-17", "done");
    completed.openQuestionCount = 1;
    completed.todoCounts = {total: 2, open: 1, done: 1, later: 0, skipped: 0};
    expect(dayToneLabel(completed)).toBe("1 open to-do");
    completed.openQuestionCount = 3;
    expect(dayToneLabel(completed)).toBe("2 open questions · 1 open to-do");
  });
  it("counts unfinished scheduled days before today only", () => {
    expect(catchUpDayCount([
      day("2026-07-07", "done"),
      day("2026-07-08", "todo"),
      day("2026-07-10", "todo"),
      day("2026-07-11", "todo"),
    ], "2026-07-10")).toBe(1);
  });

  it("excludes skipped work from time and restores resumed tasks without changing their identity", () => {
    const sample = day("2026-07-09", "done");
    sample.sections[0].tasks[0].estimatedMinutes = 165;
    const base = sample.sections[0].tasks[0];
    sample.sections.push({id:"cancelled",title:"Cancelled",orderIndex:99,defaultCollapsed:true,tasks:[
      {...base,id:"lecture",title:"CANCELLED — Lecture",isOptional:true,estimatedMinutes:200},
      {...base,id:"assignment",title:"CANCELLED — Assignment",status:"skipped",isOptional:true,estimatedMinutes:295},
    ]});
    expect(dayEstimatedMinutes(sample)).toBe(365);
    expect(dayOptionalMinutes(sample)).toBe(200);
    const sections = dayVisibleSections(sample);
    const restored = sections.find(section => section.title === "Restored work")!;
    expect(restored.defaultCollapsed).toBe(false);
    expect(restored.tasks.map(task => [task.id,task.title])).toEqual([["lecture","Lecture"]]);
    expect(sections.find(section => section.title === "Cancelled")?.tasks.map(task => task.id)).toEqual(["assignment"]);
    expect(sample.sections[1].tasks[0].title).toBe("CANCELLED — Lecture");
    sample.sections[1].tasks[1].status = "todo";
    expect(dayVisibleSections(sample).find(section => section.title === "Restored work")?.tasks).toHaveLength(2);
  });

  it("does not keep a finished day overdue only because a core task was skipped", () => {
    expect(catchUpDayCount([day("2026-07-09", "skipped")], "2026-07-10")).toBe(0);
  });
});
