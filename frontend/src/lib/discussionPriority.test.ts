import { describe, expect, it } from "vitest";
import type { Annotation } from "../types/tracker";
import {
  discussionPriority,
  tutorPriorityFromMarkdown,
} from "./discussionPriority";

const question = (priority: Annotation["priority"] = "normal") =>
  ({ priority } as Annotation);

describe("discussion priority", () => {
  it("recognizes explicit tutor guidance without treating generic prose as a tag", () => {
    expect(tutorPriorityFromMarkdown("This is a core concept for the exam.")).toBe("core");
    expect(tutorPriorityFromMarkdown("This is a high-priority question.")).toBe("high");
    expect(tutorPriorityFromMarkdown("This optional detail is less important.")).toBe("low");
    expect(tutorPriorityFromMarkdown("The important result is $x=1$."))
      .toBeNull();
  });

  it("uses legacy capture priorities only when no tutor label is present", () => {
    expect(discussionPriority("This is low-priority.", [question("high")])).toBe("low");
    expect(discussionPriority("Priority: VERY CORE", [question("high")])).toBe("core");
    expect(discussionPriority("No priority guidance.", [question("high")])).toBe("high");
    expect(discussionPriority("This is a core concept.", [question()])).toBe("core");
    expect(discussionPriority("No priority guidance.", [question()])).toBe("unrated");
  });

  it("recognizes real tutor labels before incidental prose and ignores literal examples", () => {
    expect(tutorPriorityFromMarkdown("**Priority: VERY CORE.**\n\nA low-priority implementation detail follows.")).toBe("core");
    expect(tutorPriorityFromMarkdown("Priority: CORE intuition, LOW implementation detail.")).toBe("core");
    expect(tutorPriorityFromMarkdown("Priority: medium / low")).toBe("medium");
    expect(tutorPriorityFromMarkdown("~~~text\nPriority: Core\n~~~\n> Priority: High\n\n`Priority: low` $\\text{Priority: high}$")).toBeNull();
    expect(tutorPriorityFromMarkdown("This is not a core concept.")).toBeNull();
  });

  it("saves every level including medium and can restore automatic detection", () => {
    for (const priority of ["core", "high", "medium", "low"] as const) {
      expect(discussionPriority("Priority: CORE", [{...question(), discussionPriority: priority}])).toBe(priority);
    }
    expect(discussionPriority("Priority: LOW", [{...question("high"), discussionPriority: "auto"}])).toBe("low");
    expect(discussionPriority("No priority guidance.", [{...question("high"), discussionPriority: "auto"}])).toBe("unrated");
  });
});
