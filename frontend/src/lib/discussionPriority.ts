import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import type { Annotation } from "../types/tracker";

export type DiscussionPriority = "core" | "high" | "medium" | "low" | "unrated";
const PRIORITY_RANK: Record<DiscussionPriority, number> = { core: 4, high: 3, medium: 2, low: 1, unrated: 0 };
const parser = unified().use(remarkParse).use(remarkMath);
type Node = { type: string; value?: string; children?: Node[] };

/** Prose only: quoted instructions, code, math and HTML are not tutor labels. */
function prose(node: Node): string {
  if (["blockquote", "code", "inlineCode", "math", "inlineMath", "html"].includes(node.type)) return " ";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(prose).join(["root", "list", "listItem"].includes(node.type) ? "\n" : "");
}

export function tutorPriorityFromMarkdown(markdown: string): DiscussionPriority | null {
  const text = prose(parser.parse(markdown)).toLowerCase().replace(/[=^!%]/g, "");
  // The first explicit verdict wins, even when later details have a lower rank.
  // Ranges use their first value: “medium / low” => medium.
  const explicit = text.match(/\b(?:priority|importance)\s*(?::|—|–|=|is)\s*(?:very\s+)?(core|high|medium|low)\b/);
  if (explicit) return explicit[1] as DiscussionPriority;
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (/\b(?:not|isn't|isn’t|never)\b/.test(sentence)) continue;
    const level = sentence.match(/\b(core|high|medium|low)[- ]priority\b/);
    if (level) return level[1] as DiscussionPriority;
    if (/\b(?:this|that|it) (?:is|question is|topic is) (?:a |very )?(?:core|foundational|essential|must[- ]know)\b/.test(sentence)) return "core";
    if (/\b(?:very important|key (?:concept|question|distinction|lesson)|important (?:concept|question|distinction|lesson))\b/.test(sentence)) return "high";
    if (/\b(?:less important|optional detail|minor detail)\b/.test(sentence)) return "low";
  }
  return null;
}

export function savedDiscussionPriority(questions: readonly Annotation[]): Exclude<DiscussionPriority, "unrated"> | "auto" {
  const explicit = questions.map(q => q.discussionPriority).filter((p): p is NonNullable<Annotation["discussionPriority"]> => Boolean(p));
  if (explicit.length) return [...explicit].sort((a, b) => (b === "auto" ? 0 : PRIORITY_RANK[b]) - (a === "auto" ? 0 : PRIORITY_RANK[a]))[0];
  if (questions.some(q => q.priority === "high")) return "high";
  if (questions.length && questions.every(q => q.priority === "low")) return "low";
  return "auto";
}

export function discussionPriority(markdown: string, questions: readonly Annotation[]): DiscussionPriority {
  const saved = savedDiscussionPriority(questions);
  return saved === "auto" ? tutorPriorityFromMarkdown(markdown) ?? "unrated" : saved;
}

export function discussionPriorityRank(priority: DiscussionPriority): number { return PRIORITY_RANK[priority]; }
export function discussionPriorityLabel(priority: DiscussionPriority): string { return priority === "unrated" ? "Untagged" : priority[0].toUpperCase() + priority.slice(1); }
