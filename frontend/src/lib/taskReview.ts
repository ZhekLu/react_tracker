import type { Annotation, Discussion, Task } from "../types/tracker";
import { discussionAnswerSections, discussionSectionSearchText } from "./discussionText";
import { discussionQuestionIdsByLabel } from "./discussionQa";

export type TaskReviewPart = {
  id: number;
  title: string;
  markdown: string;
  questionIds: string[];
  labels: string[];
};

/** Slice the source, never serialize its formulas or lists through another AST. */
export function taskReviewParts(markdown: string, discussion: Discussion | undefined,
  annotations: Annotation[]): TaskReviewPart[] {
  const headings = [...discussionSectionSearchText(markdown).matchAll(/^(#{1,6})[ \t]+(.+)$/gm)]
    .map(match => ({start: match.index!, level: match[1].length, title: match[2],
      labels: discussionAnswerSections(match[0]).sections[0]?.labels ?? []}));
  const questionLevels = headings.filter(h => h.labels.length).map(h => h.level);
  const levels = [...new Set(headings.map(h => h.level))].sort();
  const boundaryLevel = questionLevels.length ? Math.min(...questionLevels)
    : levels.find(level => headings.filter(h => h.level === level).length > 1)
      ?? levels[0] ?? 1;
  const boundaries = headings.filter(h => h.level <= boundaryLevel);
  if (!boundaries.length || boundaries[0].start > 0) {
    boundaries.unshift({start: 0, level: 0, title: "Introduction / review", labels: []});
  }
  const idsByLabel = discussion ? discussionQuestionIdsByLabel(discussion, annotations) : new Map<string, string[]>();
  return boundaries.map((heading, index) => ({
    id: index, title: heading.title, labels: heading.labels,
    markdown: markdown.slice(heading.start, boundaries[index + 1]?.start ?? markdown.length).trim(),
    questionIds: [...new Set(heading.labels.flatMap(label => idsByLabel.get(label) ?? []))],
  })).filter(part => part.markdown);
}

export function taskReviewQuestionIds(annotations: Annotation[], task: Task): string[] {
  return annotations.filter(a => a.origin === "discussion_review_source" &&
    a.status !== "archived" && a.anchor?.metadata?.taskId === task.id).map(a => a.id);
}
