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

  it("lets an explicit saved priority override tutor inference", () => {
    expect(discussionPriority("This is low-priority.", [question("high")])).toBe("high");
    expect(discussionPriority("This is a core concept.", [question()])).toBe("core");
    expect(discussionPriority("No priority guidance.", [question()])).toBe("medium");
  });
});
