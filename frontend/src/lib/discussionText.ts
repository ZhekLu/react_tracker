import type { Discussion } from "../types/tracker";
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
  "after",
  "again",
  "because",
  "before",
  "being",
  "chapter",
  "could",
  "does",
  "every",
  "from",
  "have",
  "into",
  "only",
  "that",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
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
  const matches = [...markdown.matchAll(MARKDOWN_HEADING)]
    .map((match) => ({
      ...match,
      labels: [...match[1].matchAll(QUESTION_LABEL)].map(
        (labelMatch) => `Q-${labelMatch[1].padStart(3, "0")}`,
      ),
    }))
    .filter((match) => match.labels.length > 0);
  if (!matches.length) return { preamble: markdown, sections: [] };
  return {
    preamble: markdown.slice(0, matches[0].index).trim(),
    sections: matches.map((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? markdown.length;
      return {
        label: match.labels.join(", "),
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

export function matchAnswerSectionsToQuestions(
  sections: DiscussionAnswerSection[],
  questions: DiscussionQuestionCandidate[],
): DiscussionQuestionMatch[] {
  const remaining = new Set(questions.map((question) => question.id));
  const questionTokens = new Map(
    questions.map((question) => [question.id, textTokens(question.text)]),
  );
  const matches: DiscussionQuestionMatch[] = [];
  for (const section of sections) {
    const explicitlyMatched = section.labels
      .map((label) => Number(label.slice(2)) - 1)
      .map((questionIndex) => questions[questionIndex])
      .filter(
        (question): question is DiscussionQuestionCandidate =>
          Boolean(question && remaining.has(question.id)),
      );
    if (explicitlyMatched.length) {
      explicitlyMatched.forEach((question) => remaining.delete(question.id));
      matches.push({
        questionIds: explicitlyMatched.map((question) => question.id),
        sectionLabel: section.label,
      });
      continue;
    }
    const sectionTokens = textTokens(section.markdown);
    let best: { id: string; overlap: number; score: number } | null = null;
    for (const question of questions) {
      if (!remaining.has(question.id)) continue;
      const tokens = questionTokens.get(question.id) ?? new Set<string>();
      const overlap = [...tokens].filter((token) => sectionTokens.has(token)).length;
      const score = tokens.size ? overlap / tokens.size : 0;
      if (
        best === null ||
        score > best.score ||
        (score === best.score && overlap > best.overlap)
      ) {
        best = { id: question.id, overlap, score };
      }
    }
    if (best && best.overlap >= 2 && best.score >= 0.08) {
      remaining.delete(best.id);
      matches.push({
        questionIds: [best.id],
        sectionLabel: section.label,
      });
    }
  }
  return matches;
}

export function discussionFollowups(discussion: Discussion): string {
  const items = discussion.messages.flatMap((message) =>
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
  if (!items.length) return "";
  return [
    `# ${discussion.title} · Follow-ups`,
    "",
    ...items.map(
      (item) =>
        `- Message #${item.sequence} (${item.role}): ${item.line}`,
    ),
  ].join("\n");
}
