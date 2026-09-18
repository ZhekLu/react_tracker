// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarProgressPanel } from "./SidebarProgressPanel";
import { StudyMomentumPanel } from "./StudyMomentumPanel";
import type { Course } from "../../types/tracker";
import { WorkspaceSidebar } from "../WorkspaceSidebar";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let course: Course;
beforeEach(() => {
  const preferences = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {configurable: true, value: {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
  }});
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  course = {id: "course", title: "Study course", accent: "#176d55", stats: {trackedSeconds: 900}, annotations: [{id: "q", kind: "question", status: "open", discussionResponseCount: 1},
    {id: "todo", kind: "todo", status: "open"}], resources: [], skills: [], exams: [],
    days: [{id: "d", number: 11, title: "Actor-critic", trackedSeconds: 900, progress: {ratio: 0}, sections: [{tasks: [{id: "t", status: "todo", isOptional: false}]}]}]} as unknown as Course;
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
const progress = (label: string) => host.querySelector(`[aria-label="${label}"]`)?.getAttribute("aria-valuenow");

it("updates the task, understanding and to-do rewards after saved workspace changes", async () => {
  const open = vi.fn();
  await act(async () => root.render(<SidebarProgressPanel course={course} onViewChange={open}/>));
  expect(progress("Questions understood")).toBe("0");
  expect(host.textContent).toContain("1 answer ready to review");
  course = {...course, days: course.days.map(day => ({...day, sections: day.sections.map(section => ({...section,
    tasks: section.tasks.map(task => ({...task, status: "done" as const}))}))})),
    annotations: course.annotations.map(annotation => ({...annotation, status: "answered" as const}))};
  await act(async () => root.render(<SidebarProgressPanel course={course} onViewChange={open}/>));
  expect(progress("Core tasks completed")).toBe("100");
  expect(progress("Questions understood")).toBe("100");
  expect(progress("To-dos completed")).toBe("100");
  expect(host.textContent).toContain("Core plan complete");
  const understood = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Understood"))!;
  await act(async () => understood.click()); expect(open).toHaveBeenCalledWith("discussions");
});

it("shows a numbered course map with clickable days, honest labels and live time", async () => {
  const open = vi.fn();
  // A stale course summary must not override newer per-day timer data.
  course.stats.trackedSeconds = 99999;
  await act(async () => root.render(<StudyMomentumPanel course={course} activeDayId="d" trackedSecondsByDay={{d: 1200}} onOpenDay={open}/>));
  expect(host.textContent).toContain("20m");
  expect(host.textContent).not.toContain("streak");
  const tile = host.querySelector<HTMLButtonElement>('.studyActivityGrid button')!;
  expect(tile.textContent).toBe("11");
  expect(tile.getAttribute("aria-current")).toBe("step");
  expect(tile.getAttribute("aria-label")).toContain("0 tasks completed");
  await act(async () => tile.click()); expect(open).toHaveBeenCalledWith("d");
});

it("renders an empty course without NaN progress or invented activity", async () => {
  course = {...course, days: [], annotations: [], stats: {...course.stats, trackedSeconds: 0}};
  await act(async () => root.render(<><StudyMomentumPanel course={course} activeDayId="" trackedSecondsByDay={{}} onOpenDay={vi.fn()}/>
    <SidebarProgressPanel course={course} onViewChange={vi.fn()}/></>));
  expect(host.textContent).toContain("Your first step");
  expect([...host.querySelectorAll('[role="progressbar"]')].every(el => el.getAttribute("aria-valuenow") === "0")).toBe(true);
});

it("switches between totals and the course map and remembers the chosen summary", async () => {
  await act(async () => root.render(<WorkspaceSidebar course={course} courses={[course]} activeDayId="d" view="roadmap"
    onCourseChange={vi.fn()} onViewChange={vi.fn()} onOpenDay={vi.fn()} trackedSecondsByDay={{}}/>));
  expect(host.querySelector('[aria-label="Course achievements"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="Course journey"]')).toBeNull();
  const map = [...host.querySelectorAll("button")].find(button => button.textContent === "Course map")!;
  await act(async () => map.click());
  expect(host.querySelector('[aria-label="Course achievements"]')).toBeNull();
  expect(host.querySelector('[aria-label="Course journey"]')).toBeTruthy();
  expect(window.localStorage.getItem("tracker.sidebar.summary")).toBe("journey");
});
