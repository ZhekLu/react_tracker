import { describe, expect, it } from "vitest";
import { nextChapterStatus } from "../../lib/chapterProgress";

describe("book chapter progress", () => {
  it("cycles unread, partial, full, and back to unread", () => {
    expect(nextChapterStatus("unread")).toBe("read_partially");
    expect(nextChapterStatus("read_partially")).toBe("read_fully");
    expect(nextChapterStatus("read_fully")).toBe("unread");
  });
});
