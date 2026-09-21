import type { Annotation, Course, Discussion, Note } from "../../types/tracker";
import { discussionQaSections, type DiscussionQaSection } from "../../lib/discussionQa";
import { discussionPriority, discussionPriorityRank, type DiscussionPriority } from "../../lib/discussionPriority";
import { qaReviewThreads, type QaReviewItem } from "./discussionQaReviewModel";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";

const parser = unified().use(remarkParse).use(remarkMath);
type Node = { type: string; value?: string; children?: Node[] };
/** A preview is text, never truncated Markdown (which can break math/fences). */
export function studyPreview(markdown: string, limit = 180): string {
  function visit(node: Node): string {
    if (node.type === "html") return "";
    if (node.type === "math" || node.type === "inlineMath") return " [formula] ";
    if (node.value !== undefined) return node.value;
    return (node.children ?? []).map(visit).join(["root", "list", "listItem"].includes(node.type) ? " " : "");
  }
  const text = visit(parser.parse(markdown)).replace(/(?:==|\^\^|!!|%%)/g, "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit).trimEnd() + "…" : text;
}

export function importantAnswerNote(notes: readonly Note[], questions: readonly Annotation[], sections: readonly DiscussionQaSection[]): Note | undefined {
  const ids = new Set(questions.map(q => q.id));
  return notes.find(note => note.kind === "important_answer" && (
    note.links.some(link => link.entityType === "annotation" && ids.has(link.entityId)) ||
    sections.some(section => (note.document.markdown ?? note.document.plainText).includes(
      `<!-- qa-section:${section.messageId}:${section.label} -->`,
    ))
  ));
}

export type StudyAnswer = {
  id: string; item: QaReviewItem; title: string; preview: string; priority: DiscussionPriority;
  importantNote?: Note; sourceIds: string[]; groupId: string; groupTitle: string;
  understood: boolean; order: number;
};

export function buildDiscussionStudy(course: Course, discussion: Discussion, questionIds?: string[]): StudyAnswer[] {
  const localSections = discussionQaSections(discussion, course.annotations);
  // The overview covers every mapped answer in this discussion, including later
  // response rounds. It is not limited to the initial prompt batch's questions.
  const allAnswerIds = [...new Set([
    ...(questionIds ?? (discussion.questionLabels.length ? discussion.questionLabels.flatMap(label => label.annotationIds) : discussion.questionIds)),
    ...localSections.flatMap(section => section.questionIds),
  ])];
  const items = qaReviewThreads(course.discussions, course.annotations, discussion, allAnswerIds);
  const mapped = new Set(items.flatMap(item => (item.answers ?? []).map(answer => answer.section.id)));
  // Keep free-form notes discoverable without inventing question links.
  const context: QaReviewItem[] = localSections.filter(section =>
    !mapped.has(section.id) && section.bodyMarkdown.trim(),
  ).map(section => ({ id: section.id, questions: [], section, sectionDiscussionId: discussion.id,
    answers: [{discussionId: discussion.id, section}] }));
  const resources = new Map(course.resources.map(resource => [resource.id, resource]));
  return [...items, ...context].filter(item => !item.questions.length || item.questions.some(q => q.status !== "archived")).map((item, order) => {
    const roots = item.rootQuestions ?? item.questions;
    const sourceIds = [...new Set(roots.map(q => q.resourceId))].filter(id => resources.get(id)?.kind !== "discussion");
    if (!sourceIds.length && discussion.scopeType === "resource") sourceIds.push(...discussion.sourceResourceIds);
    const groupId = [...sourceIds].sort().join(":") || "context";
    const groupTitle = sourceIds.length > 1 ? "Across sources" : resources.get(sourceIds[0])?.title ?? "Discussion notes";
    const sections = (item.answers ?? []).map(answer => answer.section);
    const first = sections.find(section => section.questionIds.some(id => roots.some(q => q.id === id))) ?? item.section;
    const rawTitle = studyPreview(first?.title || "", 180);
    let title = rawTitle.replace(/^Q-[\w-]+(?:\s*[,/&]\s*Q-[\w-]+)*\s*(?:[·—–:.-]\s*)?/i, "");
    for (const id of sourceIds) {
      const resourceTitle = resources.get(id)?.title;
      if (resourceTitle) title = title.replace(resourceTitle, "");
    }
    title = title.replace(/^[\s·—–:.-]+|[\s·—–:.-]+$/g, "");
    title = title.replace(/^(?:(?:UniPD|Berkeley)\s+)?Lecture\s+\d+\s*[—–:-]\s*/i, "").replace(/\s*·\s*(?:page|slide)\s+\d+(?:\s*·\s*Slide\s+\d+)?$/i, "");
    if (!title || /^(?:page|slide|p\.)\s*\d+/i.test(title)) {
      const questionText = studyPreview(roots[0]?.body?.markdown || roots[0]?.anchor?.quote || "", 110);
      const location = roots[0]?.anchor?.pageNumber;
      title = questionText && !/^Screenshot\b/i.test(questionText) ? questionText :
        [location ? `Page ${location}` : title, roots[0]?.stableLabel || first?.label].filter(Boolean).join(" · ") || "Discussion note";
    }
    return {id: item.id, item, title, preview: studyPreview(item.section?.bodyMarkdown || roots[0]?.body?.markdown || ""),
      priority: discussionPriority(sections.map(section => section.bodyMarkdown).join("\n\n"), roots),
      importantNote: importantAnswerNote(course.notes, item.questions, sections), sourceIds, groupId, groupTitle, order,
      understood: Boolean(item.questions.length) && item.questions.filter(q => q.status !== "archived").every(q => q.status === "answered"),
    };
  });
}

export function sortStudyAnswers(answers: readonly StudyAnswer[]): StudyAnswer[] {
  return [...answers].sort((a, b) => Number(Boolean(b.importantNote)) - Number(Boolean(a.importantNote)) ||
    discussionPriorityRank(b.priority) - discussionPriorityRank(a.priority) || a.order - b.order);
}

export function studyResourceGroups(answers: readonly StudyAnswer[]) {
  const groups = new Map<string, {id: string; title: string; answers: StudyAnswer[]; questionIds: string[]}>();
  answers.forEach(answer => {
    const group = groups.get(answer.groupId) ?? {id: answer.groupId, title: answer.groupTitle, answers: [], questionIds: []};
    group.answers.push(answer);
    group.questionIds = [...new Set([...group.questionIds, ...answer.item.questions.filter(q => q.status !== "archived").map(q => q.id)])];
    groups.set(group.id, group);
  });
  return [...groups.values()];
}
