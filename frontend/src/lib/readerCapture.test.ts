import { describe, expect, it } from "vitest";
import { prepareReaderCapture } from "./readerCapture";

describe("lecture reader capture commands", () => {
  it("removes /screen while retaining its attachment intent", () => {
    expect(
      prepareReaderCapture("Why is this bound tight?? /screen", "note"),
    ).toEqual({
      includeScreenshot: true,
      kind: "question",
      markdown: "Why is this bound tight??",
    });
  });

  it("preserves intentional line breaks", () => {
    expect(
      prepareReaderCapture("First line\n/screen\nSecond line", "question")
        .markdown,
    ).toBe("First line\n\nSecond line");
  });
});
