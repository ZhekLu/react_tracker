import { describe, expect, it } from "vitest";
import { answerDisplayTitle, answerPreviewParts } from "./answerPreviewModel";
import type { DiscussionQaSection } from "../../lib/discussionQa";
import type { Annotation } from "../../types/tracker";
const section = (bodyMarkdown: string) => ({id: "s", messageId: "m", kind: "answer", label: "Q-001", questionIds: ["q"], bodyMarkdown, title: "Q-001 · Book · A key idea"} as DiscussionQaSection);

describe("compact answer previews", () => {
  it("shows every selected phrase without unhighlighted context, preserving complete math", () => {
    const source = "Ignore this. Compare ==evaluation== with ^^improvement^^. Then ==$\\boxed{Q(s,a)}$==. Ignore this too.";
    const parts = answerPreviewParts(section(source));
    expect(parts.map(p => p.markdown)).toEqual(["evaluation", "improvement", "$\\boxed{Q(s,a)}$"]);
    expect(parts.map(p => p.color)).toEqual(["primary", "secondary", "primary"]);
    expect(source).toContain("Ignore this too.");
  });
  it("ignores literal marks in code and includes highlighted display/code blocks", () => {
    expect(answerPreviewParts(section("Literal `==x==`."))[0].color).toBeUndefined();
    expect(answerPreviewParts(section("<!-- note-highlight:blue -->\n\n$$\nx=y\n$$"))).toEqual([{markdown:"$$\nx=y\n$$", color:"secondary"}]);
  });
  it("scopes saved highlights to their answer and falls back to an intact excerpt", () => {
    const saved = {id: "a", kind: "highlight", status: "open", origin: "discussion_review_highlight", body: {markdown: "My selected $x$."}, anchor: {discussionMessageId: "m", metadata: {sectionLabel: "Q-001"}}} as unknown as Annotation;
    expect(answerPreviewParts(section("Plain explanation."), [saved])[0].markdown).toBe("My selected $x$.");
    expect(answerPreviewParts({...section("Plain explanation."), label:"Q-002"}, [saved])).toEqual([{markdown: "Plain explanation."}]);
    expect(answerPreviewParts(section("Plain explanation."), [{...saved, status:"archived"}])).toEqual([{markdown:"Plain explanation."}]);
  });
  it("removes resource repetition and source-only headings", () => {
    expect(answerDisplayTitle(section(""), ["Book"], [])).toBe("A key idea");
    expect(answerDisplayTitle({...section(""), title:"Q-001 · Page 2"}, [], [])).toBe("");
    expect(answerDisplayTitle({...section(""), title:"??"}, [], [])).toBe("");
    expect(answerDisplayTitle({...section(""), title:"Q-001-F1 — Follow-up to message #18"}, [], [])).toBe("");
  });
  it("keeps reference-link definitions for selected text", () => {
    expect(answerPreviewParts(section("See ==[this][paper]==.\n\n[paper]: https://example.com/paper"))[0].markdown).toBe("[this][paper]\n\n[paper]: https://example.com/paper");
  });
});
