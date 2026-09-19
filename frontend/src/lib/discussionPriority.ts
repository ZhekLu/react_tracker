import type { Annotation } from "../types/tracker";

export type DiscussionPriority = "core" | "high" | "medium" | "low";

const PRIORITY_RANK: Record<DiscussionPriority, number> = {
  core: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Conservative tutor-prose detection; ordinary uses of “important” do not tag. */
export function tutorPriorityFromMarkdown(
  markdown: string,
): DiscussionPriority | null {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#=^!%]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (
    /\b(?:low[- ]priority|less important|not (?:especially |very )?important|optional detail|minor detail)\b/.test(
      text,
    )
  ) {
    return "low";
  }
  if (/\b(?:medium[- ]priority|moderate(?:ly)? important)\b/.test(text)) {
    return "medium";
  }
  if (
    /\b(?:core (?:concept|question|idea|material|knowledge)|foundational|essential|must[- ]know)\b/.test(
      text,
    )
  ) {
    return "core";
  }
  if (
    /\b(?:high(?:est)?[- ]priority|very important|crucial|key (?:concept|question|distinction|lesson)|important (?:concept|question|distinction|lesson)|(?:this|the) (?:question|topic) is important)\b/.test(
      text,
    )
  ) {
    return "high";
  }
  return null;
}

export function savedDiscussionPriority(
  questions: readonly Annotation[],
): DiscussionPriority {
  if (questions.some((question) => question.priority === "high")) return "high";
  if (questions.length && questions.every((question) => question.priority === "low")) {
    return "low";
  }
  return "medium";
}

export function discussionPriority(
  markdown: string,
  questions: readonly Annotation[],
): DiscussionPriority {
  const saved = savedDiscussionPriority(questions);
  if (saved !== "medium") return saved;
  return tutorPriorityFromMarkdown(markdown) ?? saved;
}

export function discussionPriorityRank(priority: DiscussionPriority): number {
  return PRIORITY_RANK[priority];
}

export function discussionPriorityLabel(priority: DiscussionPriority): string {
  return priority[0].toUpperCase() + priority.slice(1);
}
