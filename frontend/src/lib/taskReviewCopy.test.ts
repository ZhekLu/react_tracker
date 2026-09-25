import { describe, expect, it } from "vitest";
import { originalTaskWork, taskNoteCopyParts } from "./taskReviewCopy";
import { taskTutorPrompt } from "./prompts";
import type { Course, StudyDay, Task } from "../types/tracker";

describe("focused task review copying", () => {
  it("excludes past reviews without changing formulas, code, or the saved note", () => {
    const work = "## Instructions\n\n1. Explain.\n\n## My work\n\nA $Q_\\theta$ and  two spaces.\n\n```md\n<!-- tutor-review:literal -->\n```";
    const source = work + "\n\n<!-- tutor-review:real -->\n## Feedback\n\nFix $x$.\n<!-- /tutor-review:real -->";
    const original = originalTaskWork(source);
    expect(original).toEqual({markdown: work, reviewCount: 1, reviews: ["## Feedback\n\nFix $x$."]});
    const parts = taskNoteCopyParts(original.markdown);
    expect(parts.map(p => p.title)).toEqual(["Instructions", "My work"]);
    expect(parts.filter(p => p.isMyWork)[0].markdown).toContain("A $Q_\\theta$ and  two spaces.");
    expect(parts.map(p => p.markdown).join("\n\n")).toBe(work);
    expect(source).toContain("Fix $x$.");
  });

  it("keeps malformed boundaries and interleaved checklist answers intact", () => {
    const source = "1. Explain $x$.\n   My answer.\n2. Explain $y$.\n   My second answer.\n\n<!-- tutor-review:open -->\nDon't lose me.";
    expect(originalTaskWork(source)).toEqual({markdown: source, reviewCount: 0, reviews: []});
    expect(taskNoteCopyParts(source)).toHaveLength(1);
    expect(taskNoteCopyParts(source)[0].markdown).toBe(source);
  });

  it("omits optional instructions, avoids duplicated framing, and gives each review a useful heading", () => {
    const task = {id: "t", title: "Closed-book baseline derivation", resourceIds: [], notes: [],
      rationale: {markdown: "Large task instructions"}} as unknown as Task;
    const course = {shortCode: "RL", title: "RL course", annotations: [], resources: []} as unknown as Course;
    const day = {id: "d", number: 11} as StudyDay;
    const result = taskTutorPrompt(course, day, task, {includeTaskInfo: false, noteMarkdown: "My $\\boxed{G_t}$ attempt.", reviewTitle: "Baseline intuition"});
    expect(result.markdown).toContain("## Review · Baseline intuition");
    expect(result.markdown).toContain("My $\\boxed{G_t}$ attempt.");
    expect(result.markdown).not.toContain("Large task instructions");
    expect(result.markdown).not.toContain("Attached questions");
    expect(result.markdown.match(/^# /gm)).toHaveLength(1);
  });
});
