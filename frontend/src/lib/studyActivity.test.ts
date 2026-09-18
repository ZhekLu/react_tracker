import { describe, expect, it } from "vitest";
import type { Annotation, Course, StudyDay, Task } from "../types/tracker";
import { courseAchievements, dayAchievements } from "./studyActivity";
import { formatTrackedTime } from "../features/roadmap/dayPresentation";

const task = (id: string, status = "todo", isOptional = false) => ({id, status, isOptional}) as Task;
const day = (tasks: Task[], extra = {}) => ({id: "d", number: 1, sections: [{tasks}], trackedSeconds: 0,
  progress: {ratio: 1}, ...extra}) as unknown as StudyDay;
const annotation = (id: string, extra = {}) => ({id, kind: "question", status: "open", postponed: false, ...extra}) as Annotation;
function course(tasks: Task[], annotations: Annotation[] = []) {
  return {days: [day(tasks)], annotations, resources: [], skills: [], exams: []} as unknown as Course;
}

describe("accurate course achievements", () => {
  it("keeps core and optional work separate and excludes cancelled tasks from targets", () => {
    const stats = courseAchievements(course([task("done", "done"), task("todo"), task("cancelled", "skipped"),
      task("bonus", "done", true), task("future-bonus", "todo", true)]));
    expect(stats).toMatchObject({coreDone: 1, coreTotal: 2, bonusDone: 1, bonusTotal: 2, taskDone: 2, nextMilestone: 2});
  });
  it("counts logical questions once, separates mapped answers from understanding, and rewards to-dos", () => {
    const stats = courseAchievements(course([], [annotation("q", {stableLabel: "Q-1", status: "answered"}),
      annotation("q-image", {stableLabel: "Q-1"}), annotation("review", {discussionResponseCount: 1}),
      annotation("later", {discussionResponseCount: 1, postponed: true}), annotation("todo", {kind: "todo", status: "answered"}),
      annotation("todo-image", {kind: "todo", stableLabel: "T-1"}), annotation("todo-image-copy", {kind: "todo", stableLabel: "T-1"}),
      annotation("archived", {status: "archived"}), annotation("skipped", {skipped: true})]));
    expect(stats).toMatchObject({questionDone: 1, questionTotal: 3, answersReady: 1, todoDone: 1, todoTotal: 2});
  });
  it("offers reachable milestones and handles an empty or fully completed plan", () => {
    expect(courseAchievements(course([]))).toMatchObject({coreTotal: 0, nextMilestone: 0});
    expect(courseAchievements(course([task("first")])).nextMilestone).toBe(1);
    expect(courseAchievements(course(Array.from({length: 7}, (_, i) => task(`${i}`, i < 6 ? "done" : "todo"))))).toMatchObject({coreDone: 6, nextMilestone: 7});
    expect(courseAchievements(course([task("first", "done")]))).toMatchObject({coreDone: 1, nextMilestone: 1});
  });
  it("excludes archived and synthetic resources and counts partial reading separately", () => {
    const data = course([]);
    data.resources = [
      {id: "book", kind: "book", status: "read", progress: 1},
      {id: "lecture", kind: "slides", status: "reading", progress: .4},
      {id: "archive", kind: "book", status: "archived", progress: 1},
      {id: "conversation", kind: "discussion", status: "read", progress: 1},
    ] as Course["resources"];
    expect(courseAchievements(data)).toMatchObject({resourceTotal: 2, resourceDone: 1, resourceStarted: 1});
  });
});

describe("course-day map", () => {
  it("does not invent activity from plan dates, closed rest days or stale progress ratios", () => {
    expect(dayAchievements(day([], {status: "closed", date: "2020-01-01"}))).toMatchObject({started: false, complete: false, level: 0});
    expect(dayAchievements(day([task("cancelled", "skipped")]))).toMatchObject({started: false, complete: false, level: 0});
    expect(dayAchievements(day([task("pending")]))).toMatchObject({started: false, level: 0});
  });
  it("rewards optional work, to-dos and live time without double-counting time", () => {
    expect(dayAchievements(day([task("optional", "done", true)]))).toMatchObject({done: 1, coreTotal: 0, complete: false, level: 4});
    expect(dayAchievements(day([], {todoCounts: {done: 1}}))).toMatchObject({started: true, todoDone: 1, level: 1});
    expect(dayAchievements(day([], {trackedSeconds: 600}), 900)).toMatchObject({trackedSeconds: 900, started: true});
  });
  it("only shows core completion when every remaining core task is done", () => {
    expect(dayAchievements(day([task("a", "done"), task("b", "skipped"), task("optional", "todo", true)]))).toMatchObject({coreDone: 1, coreTotal: 1, complete: true});
  });
  it("formats rounded time without displaying 1h 60m", () => {
    expect(formatTrackedTime(7199)).toBe("2h");
    expect(formatTrackedTime(3599)).toBe("1h");
    expect(formatTrackedTime(45)).toBe("<1m");
  });
});
