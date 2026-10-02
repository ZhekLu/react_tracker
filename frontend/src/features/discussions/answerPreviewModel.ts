import type { Annotation } from "../../types/tracker";
import type { DiscussionQaSection } from "../../lib/discussionQa";
import { discussionHighlights } from "../../lib/discussionHighlights";
import { studyReadingExcerpt, studyPreview, studyReferenceDefinitions } from "./discussionStudyModel";

export type AnswerPreviewPart = {markdown: string; color?: "primary" | "secondary"};

/** Only selected text, not its surrounding context. Never truncate Markdown source. */
export function answerPreviewParts(section: DiscussionQaSection, annotations: readonly Annotation[] = []): AnswerPreviewPart[] {
  const inline = discussionHighlights(section.bodyMarkdown, {selectedTextOnly: true});
  const saved = annotations.filter(a => {
    if (a.status === "archived" || a.kind !== "highlight" || a.origin !== "discussion_review_highlight" || a.anchor?.discussionMessageId !== section.messageId) return false;
    const metadata = a.anchor?.metadata;
    if (metadata?.sectionLabel) return metadata.sectionLabel === section.label;
    if (Array.isArray(metadata?.rootQuestionIds)) return metadata.rootQuestionIds.some(id => section.questionIds.includes(String(id)));
    // Unscoped legacy marks belong only to an unsplit response, never every answer.
    return section.kind === "unstructured";
  }).map(a => ({markdown: a.body?.markdown || a.anchor?.quote || "", color: a.anchor?.color === "secondary" ? "secondary" as const : "primary" as const}));
  const selected = [...inline, ...saved].filter(p => p.markdown.trim());
  if (!selected.length) return [{markdown: studyReadingExcerpt(section.bodyMarkdown)}];
  const unique = [...new Map(selected.map(p => [p.markdown.trim(), {markdown: p.markdown, color: p.color}])).values()];
  // The card's height crops visually; cap work to a few complete selections.
  const definitions = studyReferenceDefinitions(section.bodyMarkdown);
  return unique.slice(0, 4).map(part => ({...part, markdown: part.markdown + (definitions ? `\n\n${definitions}` : "")}));
}

export function answerDisplayTitle(section: DiscussionQaSection | undefined, resourceTitles: string[], questions: readonly Annotation[]): string {
  if (!section) return "";
  let title = studyPreview(section.title, 200).replace(/^Q-[\w-]+(?:\s*[,/&]\s*Q-[\w-]+)*\s*(?:[·—–:.-]\s*)?/i, "");
  for (const resource of resourceTitles) title = title.split(resource).join("");
  title = title.replace(/^[\s·—–:.-]+|[\s·—–:.-]+$/g, "");
  if (!title || !/[\p{L}]/u.test(title) || /^(?:page|slide|p\.|Response\s*#|Follow-up to message\s*#|Introduction$|Lecture notes screenshot)/i.test(title)) return "";
  // A quoted source paragraph is not a useful answer heading.
  if (questions.some(q => [q.anchor?.quote, q.body?.markdown, q.body?.plainText].some(text => text && studyPreview(text, 200) === title))) return "";
  return title;
}
