// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DiscussionStudyOverview } from "./DiscussionStudyOverview";
import { DiscussionResponseHistory } from "./DiscussionResponseHistory";
import { buildDiscussionHistory } from "./discussionHistoryModel";
import type { Annotation, Course, Discussion, Note } from "../../types/tracker";
import { buildDiscussionStudy, sortStudyAnswers, studyPreview, studyResourceGroups, studyReadingExcerpt } from "./discussionStudyModel";
import { qaReviewThreads } from "./discussionQaReviewModel";

export function studyFixture() {
  const annotations = ["one", "two", "three"].map((id, index) => ({id, stableLabel: `Q-b-01-00${index + 1}`, resourceId: index === 1 ? "slides" : "book",
    kind: "question", priority: "normal", postponed: false, status: index === 2 ? "answered" : "open", origin: "manual", notes: [],
    revision: 1, createdAt: "2026-09-21", updatedAt: "2026-09-21", body: {id: `doc-${id}`, canonicalFormat: "markdown", revision: 1, updatedAt: "2026-09-21", markdown: `Question ${id}`, plainText: `Question ${id}`},
  } as Annotation));
  const discussion = {id: "discussion", title: "Day 12", resourceId: "discussion-resource", scopeType: "day", sourceResourceIds: ["book", "slides"],
    questionIds: annotations.map(q => q.id), questionLabels: annotations.map((q, i) => ({label: `Q-00${i + 1}`, annotationIds: [q.id]})), qaReviews: [],
    messages: [{id: "message", role: "assistant", sequenceNumber: 1, revision: 1, createdAt: "2026-09-21", annotationLinks: [],
      body: {markdown: "## Q-001 — Bellman intuition\n\nPriority: LOW.\n\nUseful explanation.\n\n## Q-002 — Policy gradient\n\nPriority: CORE.\n\nImportant explanation.\n\n## Q-003 — Sampling\n\nPriority: HIGH.\n\nSampling explanation.", plainText: ""}}],
  } as unknown as Discussion;
  const note = {id: "note", kind: "important_answer", links: [{entityType: "annotation", entityId: "one"}], document: {markdown: "Saved explanation", plainText: "Saved explanation"}} as Note;
  const course = {annotations, discussions: [discussion], notes: [note], resources: [{id: "book", kind: "book", title: "Textbook"}, {id: "slides", kind: "slides", title: "Lecture"}], days: []} as unknown as Course;
  return {course, discussion};
}

describe("discussion study overview", () => {
  it("pins globally, then sorts priorities without changing Q&A order or source data", () => {
    const {course, discussion} = studyFixture();
    const before = JSON.stringify(course);
    const qaBefore = qaReviewThreads(course.discussions, course.annotations, discussion).map(item => item.id);
    const answers = buildDiscussionStudy(course, discussion);
    expect(sortStudyAnswers(answers).map(a => a.title)).toEqual(["Bellman intuition", "Policy gradient", "Sampling"]);
    expect(sortStudyAnswers(answers).map(a => a.priority)).toEqual(["low", "core", "high"]);
    expect(answers.filter(a => a.understood)).toHaveLength(1);
    expect(studyResourceGroups(answers).map(g => [g.title, g.questionIds])).toEqual([["Textbook", ["one", "three"]], ["Lecture", ["two"]]]);
    expect(qaReviewThreads(course.discussions, course.annotations, discussion).map(item => item.id)).toEqual(qaBefore);
    expect(JSON.stringify(course)).toBe(before);
  });

  it("keeps follow-ups with their original resource and combines multiple responses", () => {
    const {course, discussion} = studyFixture();
    course.annotations.push({...course.annotations[0], id: "followup", stableLabel: "Q-f-001", origin: "discussion_review_followup", resourceId: "discussion-resource",
      anchor: {anchorType: "text", metadata: {rootQuestionIds: ["one"], promptLabel: "Q-001-F1"}, discussionMessageId: "message"}});
    discussion.messages.push({...discussion.messages[0], id: "reply", sequenceNumber: 2, annotationLinks: [{annotationId: "followup", relation: "answers"}],
      body: {...discussion.messages[0].body, markdown: "## Q-001-F1 — Clarification\n\nA second explanation."}});
    const answers = buildDiscussionStudy(course, discussion);
    const root = answers.find(a => a.item.questions.some(q => q.id === "one"))!;
    expect(root.groupTitle).toBe("Textbook");
    expect(root.item.answers).toHaveLength(2);
    expect(root.item.questions.map(q => q.id)).toContain("followup");
    expect(root.importantNote?.id).toBe("note");
  });

  it("groups and sorts across message boundaries, not within each message", () => {
    const {course, discussion} = studyFixture();
    const original = discussion.messages[0];
    const parts = original.body.markdown!.split(/(?=## Q-)/).filter(Boolean);
    discussion.messages = parts.map((markdown, index) => ({...original, id: `m-${index}`, sequenceNumber: index + 1, body: {...original.body, markdown}}));
    const sorted = sortStudyAnswers(buildDiscussionStudy(course, discussion));
    expect(sorted.map(a => a.item.section?.messageId)).toEqual(["m-0", "m-1", "m-2"]);
    expect(studyResourceGroups(sorted).find(g => g.title === "Textbook")?.answers.map(a => a.item.section?.messageId)).toEqual(["m-0", "m-2"]);
    course.notes = [];
    expect(sortStudyAnswers(buildDiscussionStudy(course, discussion)).map(a => a.item.section?.messageId)).toEqual(["m-1", "m-2", "m-0"]);
  });

  it("keeps resource and single-question QA scopes closed around unrelated follow-ups", () => {
    const {course, discussion} = studyFixture();
    for (const [index, root] of ["one", "two"].entries()) {
      const id = `followup-${index}`;
      course.annotations.push({...course.annotations[index], id, stableLabel: `Q-f-00${index + 1}`, origin: "discussion_review_followup",
        anchor: {anchorType: "text", discussionMessageId: "message", metadata: {rootQuestionIds: [root], promptLabel: `Q-00${index + 1}-F1`}}});
      discussion.messages.push({...discussion.messages[0], id: `reply-${index}`, sequenceNumber: index + 2,
        body: {...discussion.messages[0].body, markdown: `## Q-00${index + 1}-F1\n\nA follow-up answer.`}, annotationLinks: [{annotationId: id, relation: "answers"}]});
    }
    const scoped = qaReviewThreads(course.discussions, course.annotations, discussion, ["one", "followup-0"]);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].questions.map(q => q.id)).toEqual(["one", "followup-0"]);
  });

  it("includes later linked answers outside the first prompt batch in their source group", () => {
    const {course, discussion} = studyFixture();
    course.annotations.push({...course.annotations[0], id: "later", stableLabel: "Q-later"});
    discussion.messages.push({...discussion.messages[0], id: "later-message", sequenceNumber: 2,
      annotationLinks: [{annotationId: "later", relation: "answers"}],
      body: {...discussion.messages[0].body, markdown: "A separately linked later answer."}});
    const later = buildDiscussionStudy(course, discussion).find(a => a.item.questions.some(q => q.id === "later"));
    expect(later?.groupTitle).toBe("Textbook");
    expect(later?.item.section?.messageId).toBe("later-message");
  });

  it("keeps unlinked notes and exact section pins discoverable", () => {
    const {course, discussion} = studyFixture();
    discussion.messages.push({...discussion.messages[0], id: "note-message", sequenceNumber: 2, body: {...discussion.messages[0].body, markdown: "A standalone tutor note."}});
    const unlinked = buildDiscussionStudy(course, discussion).find(a => a.item.section?.messageId === "note-message")!;
    expect(unlinked).toBeTruthy();
    course.notes.push({id: "unlinked-pin", kind: "important_answer", links: [], document: {markdown: `<!-- qa-section:note-message:${unlinked.item.section!.label} -->`, plainText: ""}} as unknown as Note);
    expect(buildDiscussionStudy(course, discussion).find(a => a.id === unlinked.id)?.importantNote?.id).toBe("unlinked-pin");
  });

  it("uses bounded plain previews, preserving full math in the original answer", () => {
    expect(studyPreview("## Reason\n\n$$\nx = y\n$$\n\n**A result**.")).toBe("Reason [formula] A result.");
    expect(studyPreview("a".repeat(500))).toHaveLength(181);
  });

  it("previews complete source blocks, keeping formula, fence, and link syntax intact", () => {
    const formula = "$$\nQ(s,a) = \\boxed{r + \\gamma V(s')}\n$$";
    const code = "```python\nvalues = [1, 2, 3]\n```";
    expect(studyReadingExcerpt(`## Explanation\n\n**Priority: CORE. Know the idea.**\n\n${formula}\n\n${code}\n\nMore detail.`)).toBe(`${formula}\n\n${code}\n\nMore detail.`);
    expect(studyReadingExcerpt("See [the paper][source].\n\n[source]: https://example.com/paper")).toContain("[source]: https://example.com/paper");
    const longFormula = `$$\n${"x + ".repeat(200)}y\n$$`;
    expect(studyReadingExcerpt(longFormula)).toBe(longFormula);
  });

  it("opens resource scopes, filters priorities and sends exact pin identities", async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
    const {course, discussion} = studyFixture();
    const onReview = vi.fn(), onToggleImportantAnswer = vi.fn();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<DiscussionStudyOverview course={course} discussion={discussion} onReview={onReview} onHistory={vi.fn()} onToggleImportantAnswer={onToggleImportantAnswer}/>));
      expect(host.querySelector(".studyAnswer")?.textContent).toContain("Bellman intuition");
      expect(host.querySelector(".studyAnswer")?.textContent).not.toContain("Question one");
      expect(host.querySelector(".answerPreviewClip")?.textContent).toContain("Useful explanation.");
      const displayButtons = host.querySelectorAll<HTMLButtonElement>(".studyDisplaySwitch button");
      await act(async () => displayButtons[1].click());
      expect(host.querySelector(".studyQuestionExcerpt")).toBeNull();
      expect(host.querySelector(".answerPreviewClip")).not.toBeNull();
      await act(async () => displayButtons[0].click());
      expect(host.querySelector(".studyQuestionExcerpt")).toBeNull();
      await act(async () => (host.querySelector(".studyResourceTile") as HTMLButtonElement).click());
      expect(onReview).toHaveBeenCalledWith(["one", "three"], "Textbook");
      await act(async () => (host.querySelector('.studyPinButton[aria-pressed="true"]') as HTMLButtonElement).click());
      expect(onToggleImportantAnswer).toHaveBeenCalledWith(expect.objectContaining({existingNote: course.notes[0], questionIds: ["one"], messageId: "message"}));
      await act(async () => (host.querySelector('.studyPriorityFilters .priority-core') as HTMLButtonElement).click());
      expect(host.querySelectorAll(".studyAnswer")).toHaveLength(1);
      expect(host.querySelector(".studyAnswer")?.textContent).toContain("Policy gradient");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it("indexes all response rounds exactly once under the original resource", () => {
    const {course, discussion} = studyFixture();
    course.annotations.push({...course.annotations[0], id: "followup", resourceId: discussion.resourceId, origin: "discussion_review_followup",
      anchor: {anchorType: "text", metadata: {rootQuestionIds: ["one"], promptLabel: "Q-001-F1"}, discussionMessageId: "message"}});
    discussion.messages.push({...discussion.messages[0], id: "reply", sequenceNumber: 2,
      annotationLinks: [{annotationId: "followup", relation: "answers"}],
      body: {...discussion.messages[0].body, markdown: "## Q-001-F1 — Clarification\n\n==Keep this idea.=="}});
    const history = buildDiscussionHistory(course, discussion);
    expect(history).toHaveLength(4);
    expect(new Set(history.map(a => a.id)).size).toBe(4);
    expect(history[0].item.section?.messageId).toBe("reply");
    expect(history[0].groupTitle).toBe("Textbook");
    expect(history.filter(a => a.groupTitle === "Textbook")).toHaveLength(3);
  });

  it("shows resource names only on history groups and opens exact answers from compact image rows", async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
    const {course, discussion} = studyFixture();
    course.annotations[0].anchor = {anchorType: "text", pageNumber: 3, metadata: {contextImageUrl:"/capture.png"}};
    discussion.messages[0].body.markdown = discussion.messages[0].body.markdown!.replace("Useful explanation.", "Ignore the preamble. ==Remember this.==");
    const onReview = vi.fn(), onHistory = vi.fn();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<DiscussionResponseHistory course={course} discussion={discussion} highlightsOnly={false}
        onReview={onReview} onHistory={onHistory} onToggleImportantAnswer={vi.fn()}/>));
      expect(host.querySelectorAll(".studySourceTag")).toHaveLength(0);
      expect([...host.querySelectorAll(".studyAnswerGroup > header h3")].map(h => h.textContent)).toEqual(["Textbook", "Lecture"]);
      const row = host.querySelector(".studyAnswer")!;
      expect(row.querySelector(".studyAnswerContent.hasImage")).not.toBeNull();
      expect(row.querySelector(".answerPreviewClip")?.textContent).toContain("Remember this.");
      expect(row.querySelector(".answerPreviewClip")?.textContent).not.toContain("Ignore the preamble");
      await act(async () => (row.querySelector(".studySourceThumbnail") as HTMLButtonElement).click());
      expect(onReview).toHaveBeenCalledWith(["one"], "Bellman intuition");
      await act(async () => (row.querySelector('[title="Full response & editing"]') as HTMLButtonElement).click());
      expect(onHistory).toHaveBeenCalledWith("message", "discussion");
      await act(async () => (row.querySelector('[title="Read full answer"]') as HTMLButtonElement).click());
      expect(row.querySelector(".studyAnswerBody")?.textContent).toContain("Ignore the preamble");
      await act(async () => root.render(<DiscussionResponseHistory course={course} discussion={discussion} highlightsOnly
        onReview={onReview} onHistory={onHistory} onToggleImportantAnswer={vi.fn()}/>));
      expect(host.querySelectorAll(".studyAnswer")).toHaveLength(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
