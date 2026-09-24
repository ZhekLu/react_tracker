import { describe, expect, it } from "vitest";
import { taskReviewParts } from "./taskReview";
import { taskTutorPrompt, taskScopedAnnotations, taskSupportingNotes } from "./prompts";
import type { Annotation, Course, Discussion, Resource, StudyDay, Task } from "../types/tracker";

const discussion = {questionLabels: [{label: "Q-001", annotationIds: ["q1"]}], messages: []} as unknown as Discussion;
describe("task tutor workflow", () => {
  it("separates a review after a Q answer without swallowing it or touching math/code", () => {
    const source = "## Q-001\n\nAnswer.\n\n### Derivation\n\n$$\nQ_\\theta = 1\n$$\n\n## Task review\n\nYour note needs work.\n\n```md\n## Q-999\n```";
    const parts = taskReviewParts(source, discussion, []);
    expect(parts).toHaveLength(2);
    expect(parts[0].questionIds).toEqual(["q1"]);
    expect(parts[0].markdown).toContain("Q_\\theta = 1");
    expect(parts[1].questionIds).toEqual([]);
    expect(parts[1].markdown).toContain("```md\n## Q-999\n```");
    expect(parts.map(p => p.markdown).join("\n\n")).toBe(source);
  });
  it("keeps unknown Q labels unmapped and allows a heading-free review", () => {
    expect(taskReviewParts("## Q-777\n\nUnknown answer.", discussion, [])[0].questionIds).toEqual([]);
    expect(taskReviewParts("Use $G_t$ and keep  spaces.", undefined, [])[0].markdown).toBe("Use $G_t$ and keep  spaces.");
  });
  it("copies a task with no resources, its note, and directly attached questions", () => {
    const task = {id: "task", title: "Closed-book bridge", resourceIds: [], chapterNumbers: [],
      rationale: {markdown: "Explain $J(\\theta)$."}, notes: [{id: "note", kind: "task", document: {markdown: "My attempt: $G_t$."}}]} as unknown as Task;
    const annotation = {id: "q1", kind: "question", status: "open", resourceId: "task-notes", notes: [],
      body: {plainText: "Why is the baseline unbiased?"}, anchor: {metadata: {sourceNoteId: "note"}}, createdAt: "today"} as unknown as Annotation;
    const course = {title: "RL", shortCode: "RL", resources: [], annotations: [annotation]} as unknown as Course;
    const day = {id: "day", number: 11} as StudyDay;
    expect(taskScopedAnnotations(course, day, task).map(a => a.id)).toEqual(["q1"]);
    const payload = taskTutorPrompt(course, day, task);
    expect(payload.annotationIds).toEqual(["q1"]);
    expect(payload.markdown).toContain("My attempt: $G_t$.");
    expect(payload.markdown).toContain("Explain $J(\\theta)$.");
    expect(payload.markdown).toContain("Why is the baseline unbiased?");
  });
  it("can include current-day resource notes as supporting N-items without turning them into questions", () => {
    const task = {id: "task", title: "Read lecture", resourceIds: ["lecture"], chapterNumbers: [], notes: []} as unknown as Task;
    const day = {id: "day", number: 15} as StudyDay;
    const resource = {id: "lecture", title: "Lecture 18", kind: "lecture"} as Resource;
    const question = {id: "q1", kind: "question", status: "open", resourceId: "lecture", notes: [],
      body: {plainText: "Why is this conservative?"}, anchor: {pageNumber: 4}, createdAt: "2026-01-01"} as unknown as Annotation;
    const note = {id: "n1", kind: "note", status: "open", resourceId: "lecture", notes: [],
      body: {markdown: "This branch constrains the actor."}, anchor: {pageNumber: 9, metadata: {createdDayId: "day"}}, createdAt: "2026-01-02"} as unknown as Annotation;
    const oldNote = {id: "n-old", kind: "note", status: "open", resourceId: "lecture", notes: [],
      body: {plainText: "Old idea"}, anchor: {pageNumber: 2, metadata: {createdDayId: "old-day"}}, createdAt: "2025-01-01"} as unknown as Annotation;
    const course = {title: "RL", shortCode: "RL", resources: [resource], annotations: [oldNote, question, note]} as unknown as Course;

    expect(taskSupportingNotes(course, day, task).map(item => item.id)).toEqual(["n1"]);
    const payload = taskTutorPrompt(course, day, task, {includeResourceNotes: true});
    expect(payload.annotationIds).toEqual(["q1"]);
    expect(payload.supportingAnnotationIds).toEqual(["n1"]);
    expect(payload.markdown).toContain("### N-001 · Lecture 18 · page 9");
    expect(payload.markdown).toContain("This branch constrains the actor.");
    expect(payload.markdown).not.toContain("Old idea");
  });
});
