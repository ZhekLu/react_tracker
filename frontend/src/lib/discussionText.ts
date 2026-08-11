import type { Annotation, Discussion } from "../types/tracker";
import { normalizeMathMarkdown } from "./mathMarkdown";

type ProtectedMarkdown = {
  value: string;
  restore: (markdown: string) => string;
};

function protectFencedCode(value: string): ProtectedMarkdown {
  const blocks: string[] = [];
  const protectedValue = value.replace(
    /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g,
    (block) => {
      const leadingNewline = block.startsWith("\n") ? "\n" : "";
      const fencedBlock = leadingNewline ? block.slice(1) : block;
      const token = `@@DISCUSSION_FENCED_CODE_${blocks.length}@@`;
      blocks.push(fencedBlock);
      return `${leadingNewline}${token}`;
    },
  );
  return {
    value: protectedValue,
    restore: (markdown) =>
      blocks.reduce(
        (restored, block, index) =>
          restored.replace(
            `@@DISCUSSION_FENCED_CODE_${index}@@`,
            () => block,
          ),
        markdown,
      ),
  };
}

function normalizeHtmlSpaceEntities(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/&(?:amp;)*(?:nbsp|#0*160|#x0*a0);/gi, " ");
}

function repairOrphanInlineMath(value: string): string {
  return value.replace(
    /^([ \t]*)(?!\$)([^\n$]*\\{1,2}[A-Za-z]+[^\n$]*)\$(?!\$)[ \t]*$/gm,
    (_line, indent: string, expression: string) =>
      `${indent}$${expression.trim()}$`,
  );
}

export function normalizeDiscussionMarkdown(value: string): string {
  const protectedMarkdown = protectFencedCode(value);
  const normalized = normalizeMathMarkdown(
    repairOrphanInlineMath(
      normalizeHtmlSpaceEntities(protectedMarkdown.value),
    ),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^•\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return protectedMarkdown.restore(normalized);
}

export type DiscussionAnswerSection = {
  label: string;
  labels: string[];
  markdown: string;
};

export type DiscussionQuestionCandidate = {
  id: string;
  text: string;
};

export type DiscussionQuestionMatch = {
  questionIds: string[];
  sectionLabel: string;
};

const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/gim;
const QUESTION_LABEL = /\b(?:Q(?:UESTION)?)[\s-]*(\d{1,3})\b/gi;
const WORD_TOKEN = /[a-z0-9]+/g;
const STOP_WORDS = new Set([
  "about",
  "action",
  "actions",
  "after",
  "again",
  "because",
  "before",
  "being",
  "chapter",
  "could",
  "does",
  "equation",
  "equations",
  "example",
  "every",
  "from",
  "have",
  "into",
  "only",
  "policy",
  "question",
  "questions",
  "state",
  "states",
  "that",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "value",
  "values",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

export function discussionAnswerSections(markdown: string): {
  preamble: string;
  sections: DiscussionAnswerSection[];
} {
  const headings = [...markdown.matchAll(MARKDOWN_HEADING)].map((match) => ({
    ...match,
    level: match[0].match(/^#+/)?.[0].length ?? 1,
    title: match[1].trim(),
    labels: [...match[1].matchAll(QUESTION_LABEL)].map(
      (labelMatch) => `Q-${labelMatch[1].padStart(3, "0")}`,
    ),
  }));
  let matches = headings.filter((match) => match.labels.length > 0);
  if (!matches.length && headings.length) {
    const primaryLevel = Math.min(...headings.map((heading) => heading.level));
    matches = headings.filter((heading) => heading.level === primaryLevel);
  }
  if (!matches.length) return { preamble: markdown, sections: [] };
  return {
    preamble: markdown.slice(0, matches[0].index).trim(),
    sections: matches.map((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? markdown.length;
      return {
        label: match.labels.length ? match.labels.join(", ") : match.title,
        labels: match.labels,
        markdown: markdown.slice(start, end).trim(),
      };
    }),
  };
}

function textTokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(WORD_TOKEN) ?? []).filter(
      (token) => token.length > 3 && !STOP_WORDS.has(token),
    ),
  );
}

function inferLegacyQuestionOffset(
  sections: DiscussionAnswerSection[],
  questions: DiscussionQuestionCandidate[],
  questionTokens: Map<string, Set<string>>,
): number | null {
  const candidates = new Map<number, { support: number; weight: number }>();
  for (const section of sections) {
    const sectionTokens = textTokens(section.markdown);
    for (const question of questions) {
      const tokens = questionTokens.get(question.id) ?? new Set<string>();
      const overlap = [...tokens].filter((token) =>
        sectionTokens.has(token),
      ).length;
      const score = tokens.size ? overlap / tokens.size : 0;
      if (overlap < 1 || score < 0.08) continue;
      for (const label of section.labels) {
        const offset = Number(label.slice(2)) - (questions.indexOf(question) + 1);
        const candidate = candidates.get(offset) ?? { support: 0, weight: 0 };
        candidate.support += 1;
        candidate.weight += overlap + score;
        candidates.set(offset, candidate);
      }
    }
  }
  const ranked = [...candidates.entries()].sort(
    ([leftOffset, left], [rightOffset, right]) =>
      right.support - left.support ||
      right.weight - left.weight ||
      Math.abs(leftOffset) - Math.abs(rightOffset),
  );
  return ranked[0] && ranked[0][1].support >= 2 ? ranked[0][0] : null;
}

export function matchAnswerSectionsToQuestions(
  sections: DiscussionAnswerSection[],
  questions: DiscussionQuestionCandidate[],
  labelOrderIsStable = true,
): DiscussionQuestionMatch[] {
  const remaining = new Set(questions.map((question) => question.id));
  const questionTokens = new Map(
    questions.map((question) => [question.id, textTokens(question.text)]),
  );
  const legacyLabelOffset = labelOrderIsStable
    ? null
    : inferLegacyQuestionOffset(sections, questions, questionTokens);
  const matches: DiscussionQuestionMatch[] = [];
  for (const section of sections) {
    const explicitlyMatched = labelOrderIsStable || legacyLabelOffset !== null
      ? section.labels
          .map(
            (label) =>
              Number(label.slice(2)) - 1 - (legacyLabelOffset ?? 0),
          )
          .map((questionIndex) => questions[questionIndex])
          .filter(
            (question): question is DiscussionQuestionCandidate =>
              Boolean(question && remaining.has(question.id)),
          )
      : [];
    if (explicitlyMatched.length) {
      explicitlyMatched.forEach((question) => remaining.delete(question.id));
      matches.push({
        questionIds: explicitlyMatched.map((question) => question.id),
        sectionLabel: section.label,
      });
      continue;
    }
    const sectionTokens = textTokens(section.markdown);
    const semanticMatches = questions
      .filter((question) => remaining.has(question.id))
      .map((question) => {
        const tokens = questionTokens.get(question.id) ?? new Set<string>();
        const overlap = [...tokens].filter((token) =>
          sectionTokens.has(token),
        ).length;
        return {
          id: question.id,
          overlap,
          score: tokens.size ? overlap / tokens.size : 0,
        };
      })
      .filter((candidate) => candidate.overlap >= 2 && candidate.score >= 0.08)
      .sort(
        (left, right) =>
          right.score - left.score || right.overlap - left.overlap,
      )
      .slice(
        0,
        labelOrderIsStable
          ? 1
          : Math.max(1, section.labels.length || 4),
      );
    if (semanticMatches.length) {
      semanticMatches.forEach((match) => remaining.delete(match.id));
      matches.push({
        questionIds: semanticMatches.map((match) => match.id),
        sectionLabel: section.label,
      });
    }
  }
  return matches;
}

export function discussionFollowups(
  discussion: Discussion,
  annotations: Annotation[] = [],
): string {
  const messageById = new Map(
    discussion.messages.map((message) => [message.id, message]),
  );
  const reviewQuestions = annotations
    .filter(
      (annotation) =>
        ["question", "todo"].includes(annotation.kind) &&
        annotation.status === "open" &&
        !annotation.postponed &&
        annotation.anchor?.discussionMessageId &&
        messageById.has(annotation.anchor.discussionMessageId),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const markerItems = discussion.messages.flatMap((message) =>
    message.body.plainText
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.includes("??") || line.toLowerCase().includes("todo!"),
      )
      .map((line) => ({
        line,
        role: message.role,
        sequence: message.sequenceNumber,
      })),
  );
  if (!reviewQuestions.length && !markerItems.length) return "";
  const reviewSections = reviewQuestions.flatMap((annotation, index) => {
    const message = messageById.get(
      annotation.anchor?.discussionMessageId ?? "",
    );
    if (!message) return [];
    const storedLabel = annotation.anchor?.metadata?.promptLabel;
    const orderedIndex = discussion.questionIds.indexOf(annotation.id);
    const labelNumber = orderedIndex >= 0 ? orderedIndex + 1 : index + 1;
    const label =
      typeof storedLabel === "string"
        ? storedLabel
        : `Q-${String(labelNumber).padStart(3, "0")}`;
    const selected = annotation.anchor?.quote?.trim() || "No excerpt saved.";
    const question =
      annotation.body?.markdown ||
      annotation.body?.plainText ||
      "Clarify this selection.";
    return [
      `## ${label} — Follow-up to message #${message.sequenceNumber}`,
      "",
      "Selected context:",
      "",
      "````markdown",
      selected,
      "````",
      "",
      "Question:",
      "",
      question,
      "",
    ];
  });
  return [
    `# ${discussion.title} · Follow-ups`,
    "",
    "Answer under the same Q-### headings so the tracker can map each response back to its selection.",
    "",
    ...reviewSections,
    ...(markerItems.length
      ? [
          "## Other inline follow-up markers",
          "",
          ...markerItems.map(
            (item) =>
              `- Message #${item.sequence} (${item.role}): ${item.line}`,
          ),
        ]
      : []),
  ].join("\n");
}
