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

  it("adds the nearest heading and adjacent sentence context", () => {
    const [highlight] = discussionHighlights(
      "## Policy improvement\n\nBefore context. The action is ==already selected==. After context.",
    );
    expect(highlight.heading).toBe("Policy improvement");
    expect(highlight.previousMarkdown).toBe("Before context.");
    expect(highlight.contextMarkdown).toBe(
      "The action is ==already selected==.",
    );
    expect(highlight.nextMarkdown).toBe("After context.");
  });

  it("does not repeat a sentence containing multiple highlights", () => {
    expect(
      discussionHighlights(
        "## One place\n\nCompare ==evaluation== with ==improvement== here.",
      ),
    ).toHaveLength(1);
  });
});
