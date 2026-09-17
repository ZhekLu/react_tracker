import type { Annotation, Course, Discussion } from "../../types/tracker";
import { discussionQaSections, type DiscussionQaSection } from "../../lib/discussionQa";
import { trackedQuestionGroups } from "../../lib/questionIdentity";
import { annotationChapter } from "../../components/annotations/annotationDisplay";

export type FinderAnswer = { discussion: Discussion; section: DiscussionQaSection };
export type FinderEntry = {
  id: string; label: string; text: string; context: string; sourceIds: string[];
  questions: Annotation[]; answers: FinderAnswer[]; updatedAt: string;
  status: "no-response" | "to-review" | "understood" | "later" | "archived" | "unlinked";
  searchText: string;
};
export const finderStatusLabels = {"no-response": "No response", "to-review": "To understand", understood: "Understood", later: "Later", archived: "Archived", unlinked: "Unlinked response"};
export function searchableText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function buildQuestionIndex(course: Course): FinderEntry[] {
  const resources = new Map(course.resources.map(r => [r.id, r]));
  const groups = trackedQuestionGroups(course.annotations);
  const byAnnotation = new Map(groups.flatMap(g => g.annotations.map(a => [a.id, g.key] as const)));
  const answers = new Map<string, FinderAnswer[]>();
  const unlinked: FinderEntry[] = [];
  for (const discussion of course.discussions) {
    for (const section of discussionQaSections(discussion, course.annotations)) {
      if (section.kind === "preamble" || !section.bodyMarkdown.trim()) continue;
      const keys = new Set(section.questionIds.map(id => byAnnotation.get(id)).filter((id): id is string => Boolean(id)));
      const answer = {discussion, section};
      for (const key of keys) answers.set(key, [...answers.get(key) ?? [], answer]);
      if (!keys.size) unlinked.push({id: section.id, label: section.label, text: section.title,
        context: discussion.title, sourceIds: discussion.sourceResourceIds, questions: [], answers: [answer],
        updatedAt: discussion.messages.find(m => m.id === section.messageId)?.createdAt ?? "",
        status: discussion.status === "archived" ? "archived" : "unlinked", searchText: ""});
    }
  }
  const entries = groups.map(({key, annotations}): FinderEntry => {
    const linked = answers.get(key) ?? [];
    const sourceIds = [...new Set(annotations.map(a => a.resourceId))];
    const active = annotations.filter(a => a.status !== "archived");
    const status = !active.length ? "archived" : active.every(a => a.status === "answered") ? "understood"
      : active.every(a => a.postponed || a.skipped) ? "later" : linked.length ? "to-review" : "no-response";
    return {id: key, questions: annotations, answers: linked, status,
      label: annotations.find(a => a.stableLabel)?.stableLabel ?? "Question",
      text: [...new Set(annotations.map(a => [a.body?.markdown || a.body?.plainText, a.anchor?.quote].filter(Boolean).join("\n")))].join("\n"),
      context: [...new Set(annotations.map(a => [resources.get(a.resourceId)?.title, annotationChapter(a)].filter(Boolean).join(" · ")))].join(" / "),
      sourceIds, updatedAt: annotations.map(a => a.updatedAt || a.createdAt).sort().at(-1) ?? "", searchText: ""};
  });
  for (const entry of [...entries, ...unlinked]) {
    // Labels are searchable aliases only. UUID mappings above determine identity.
    const ids = new Set(entry.questions.map(q => q.id));
    const aliases = course.discussions.flatMap(d => d.questionLabels.filter(l => l.annotationIds.some(id => ids.has(id))).map(l => l.label));
    entry.searchText = searchableText([entry.label, ...aliases, entry.text, entry.context,
      ...entry.answers.flatMap(a => [a.discussion.title, a.section.title, a.section.bodyMarkdown])].join("\n"));
  }
  return [...entries, ...unlinked].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.label.localeCompare(b.label, undefined, {numeric:true}));
}
export function searchQuestions(entries: FinderEntry[], query: string, status = "active", sourceId = "") {
  const normalized = searchableText(query);
  const questionIdQuery = /^(?:[\p{L}\d]+[-\s])*q(?:[-\s][\p{L}\d]+)+$/iu.test(query.trim());
  const terms = questionIdQuery ? [normalized] : normalized.split(/\s+/).filter(Boolean);
  return entries.filter(e => (status === "all" || (status === "active" ? e.status !== "archived" : e.status === status))
    && (!sourceId || e.sourceIds.includes(sourceId)) && terms.every(t => e.searchText.includes(t)))
    .sort((a,b) => Number(searchableText(b.label) === searchableText(query)) - Number(searchableText(a.label) === searchableText(query)));
}
export function finderSnippet(text: string, query: string) {
  const math: string[] = [];
  const protectedText = text.replace(/\$\$[^]*?\$\$|\$(?:\\.|[^$\n])+\$/g, value => {
    math.push(value.replace(/^\$\$|\$\$$/g, "$"));
    return String.fromCharCode(0xe000 + math.length - 1);
  });
  const plain = protectedText.replace(/<!--[^]*?-->/g, "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
  const term = query.trim().split(/\s+/).find(t => t.length > 2);
  const hit = term ? plain.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()) : -1;
  const start = Math.max(0, hit - 65);
  const excerpt = plain.slice(start, start + 280).replace(/[\ue000-\uf8ff]/g, token => math[token.charCodeAt(0) - 0xe000] ?? token);
  return `${start ? "…" : ""}${excerpt}${plain.length > start + 280 ? "…" : ""}`;
}
