import { describe, expect, it } from "vitest";
import {
  discussionHighlights,
  discussionHighlightsMarkdown,
} from "./discussionHighlights";

describe("discussion highlight excerpts", () => {
  it("keeps the surrounding paragraph in highlights-only mode", () => {
    const markdown = [
      "Before paragraph.",
      "",
      "Policy evaluation updates ==every state-action pair== once per sweep.",
      "",
      "After paragraph.",
    ].join("\n");
    const highlights = discussionHighlights(markdown);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].contextMarkdown).toBe(
      "Policy evaluation updates ==every state-action pair== once per sweep.",
    );
    expect(discussionHighlightsMarkdown(markdown)).toContain(
      "Policy evaluation updates",
    );
  });

  it("does not treat highlight-like delimiters inside code fences as marks", () => {
    expect(
      discussionHighlights("```text\n==not a review highlight==\n```")
    ).toEqual([]);
  });
});
