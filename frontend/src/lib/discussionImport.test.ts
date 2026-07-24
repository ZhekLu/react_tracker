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

  it("keeps nested expectation brackets inside one display formula", () => {
    const imported = importPastedMarkdown(String.raw`
Use the tower property:

[
\mathbb E_b
\left[
W_t
\mathbb E_b[
W_{t+1}\mid H_{t+1}
]
\mid S_t
\right],
]

and:

[
\mathbb E[(V_n-v_\pi)^2]
========================

# \operatorname{Var}(V_n)

\frac{\sigma^2}{n}.
]
`);

    const displays = Array.from(
      imported.matchAll(/\$\$([\s\S]*?)\$\$/g),
      (match) => match[1].trim(),
    );
    expect(displays).toHaveLength(2);
    expect(displays[0]).toContain("\\mathbb E_b[");
    expect(displays[0]).toContain("\\right]");
    expect(displays[1]).toContain(
      "\\mathbb E[(V_n-v_\\pi)^2] = \\operatorname{Var}(V_n) = \\frac{\\sigma^2}{n}.",
    );
    for (const latex of displays) {
      expect(() =>
        renderToString(latex, { displayMode: true, throwOnError: true }),
      ).not.toThrow();
    }
  });

  it("restores copied display math inside a blockquote", () => {
    const imported = importPastedMarkdown(String.raw`
> “Converges quadratically” means:
> [
> \mathbb E[(V_n(s)-v_\pi(s))^2]\to0.
> ]
> It is not a speed claim.
`);

    expect(imported).toContain("\\mathbb E[(V_n(s)-v_\\pi(s))^2]\\to0.");
    const formula = imported.match(
      /\$(\\mathbb E\[\(V_n\(s\)-v_\\pi\(s\)\)\^2\]\\to0\.)\$/,
    )?.[1];
    expect(formula).toBeTruthy();
    expect(() =>
      renderToString(formula!, { displayMode: false, throwOnError: true }),
    ).not.toThrow();
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
