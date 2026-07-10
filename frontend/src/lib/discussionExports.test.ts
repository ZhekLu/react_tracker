import { describe, expect, it } from "vitest";
import { discussionExportSegments } from "./discussionExports";

describe("discussion export tags", () => {
  it("splits tagged coding instructions from surrounding theory", () => {
    expect(
      discussionExportSegments(`Theory first.\n\n<day4_code_task>\n## Implement\n\nUse \`argmax\`.\n</day4_code_task>\n\nTheory last.`),
    ).toEqual([
      { kind: "markdown", markdown: "Theory first." },
      {
        kind: "export",
        markdown: "## Implement\n\nUse `argmax`.",
        tag: "day4_code_task",
      },
      { kind: "markdown", markdown: "Theory last." },
    ]);
  });

  it("does not treat ordinary HTML as an export tag", () => {
    const markdown = "Use <details>hidden</details> here.";
    expect(discussionExportSegments(markdown)).toEqual([
      { kind: "markdown", markdown },
    ]);
  });
});
