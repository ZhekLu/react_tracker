import { renderToString } from "katex";
import { describe, expect, it } from "vitest";
import {
  canonicalizePastedMarkdown,
  importPastedMarkdown,
} from "./discussionImport";
import { normalizeDiscussionMarkdown } from "./discussionText";

const fixture = String.raw`
# Q-001

The fixed point is (v_\pi = T_\pi v_\pi).

# Q-002 and Q-003

[
R'_{t+1}=R_{t+1}+c
]

~~~python
def update(value):
    return value + 1
~~~
`;

describe("discussion paste importer", () => {
  it("canonicalizes the real ChatGPT tutor response without structural debris", () => {
    const imported = importPastedMarkdown(fixture);

    expect(imported).toContain("# Q-001");
    expect(imported).toContain("# Q-002 and Q-003");
    expect(imported).toContain("```python");
    expect(imported).toContain("$v_\\pi = T_\\pi v_\\pi$");
    expect(imported).toContain("R'_{t+1}=R_{t+1}+c");
  });

  it("produces stable canonical Markdown on a second import", () => {
    const imported = importPastedMarkdown(fixture);
    expect(importPastedMarkdown(imported)).toBe(imported);
  });

  it("keeps programming blocks while inlining short text-labelled fragments", () => {
    const imported = importPastedMarkdown([
      "Use",
      "",
      "```text",
      "epsilon",
      "```",
      "",
      "in the explanation.",
      "",
      "```python",
      "def value():",
      "    return 1",
      "```",
    ].join("\n"));

    expect(imported).toContain("Use `epsilon` in the explanation.");
    expect(imported).toContain("```python\ndef value():");
  });

  it("does not squeeze paragraphs during an ordinary manual save", () => {
    expect(normalizeDiscussionMarkdown("First.\n\nOne word")).toBe(
      "First.\n\nOne word",
    );
  });

  it("only promotes bracket blocks that contain LaTeX", () => {
    const imported = canonicalizePastedMarkdown(
      "A normal bracket block:\n\n[\nplain text\n]\n\nA formula:\n\n[\nv_\\pi = T_\\pi v_\\pi\n]",
    );
    expect(imported).toContain("[\nplain text\n]");
    expect(imported).toContain("$$\nv_\\pi = T_\\pi v_\\pi\n$$");
  });

  it("repairs heading-corrupted delimiters and operators before KaTeX", () => {
    const imported = importPastedMarkdown(String.raw`
Since the outer trajectory follows (\pi'), write:

# [

\mathbb E_{\pi'}
\left[
R_{t+1} + \gamma v_\pi(S_{t+1})
\mid S_t=s
\right]
]

Expand:

[
\boxed{
q_*(l,\text{search})
====================

## \beta r_s

3(1-\beta)
+
\gamma
\left[
\beta v_*(l) + (1-\beta)v_*(h)
\right]
}
]

[
v_*(l) = \max \left{q_*(l,\text{wait}), q_*(l,\text{recharge})\right}
]
`);

    expect(imported).not.toContain("# [");
    expect(imported).not.toContain("## \\beta");
    expect(imported).toContain("- 3(1-\\beta)");

    const displays = Array.from(
      imported.matchAll(/\$\$([\s\S]*?)\$\$/g),
      (match) => match[1].trim(),
    );
    expect(displays).toHaveLength(3);
    for (const latex of displays) {
      expect(() =>
        renderToString(latex, { displayMode: true, throwOnError: true }),
      ).not.toThrow();
    }
  });

  it("densifies short quote blocks and separates adjacent inline formulas", () => {
    const imported = importPastedMarkdown(String.raw`
A sweep means:

> update every state once.

For action values:

> update every state-action pair once.

[
a=b
]

[
c=d
]
`);

    expect(imported).toContain(
      "A sweep means: “update every state once.” For action values: “update every state-action pair once.”",
    );
    expect(imported).toContain("$a=b$; $c=d$");
    expect(imported).not.toContain("> update every state once");
  });

  it("repairs a word split across tiny pasted paragraphs", () => {
    expect(importPastedMarkdown("Y\n\nes. Continue here.")).toBe(
      "Yes. Continue here.",
    );
  });

  it("preserves escaped coding export tags as real tags", () => {
    expect(
      importPastedMarkdown(
        "&lt;day4\\_gridworld&gt;\n\nBuild the grid.\n\n&lt;/day4\\_gridworld&gt;",
      ),
    ).toContain("<day4_gridworld>");
  });
});
