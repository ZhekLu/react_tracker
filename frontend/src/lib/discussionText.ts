import type { Discussion } from "../types/tracker";
import { normalizeMathMarkdown } from "./mathMarkdown";

export function normalizeDiscussionMarkdown(value: string): string {
  return normalizeMathMarkdown(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^•\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type DiscussionAnswerSection = {
  label: string;
  markdown: string;
};

export type DiscussionQuestionCandidate = {
  id: string;
  text: string;
};

export type DiscussionQuestionMatch = {
  questionId: string;
  sectionLabel: string;
};

const QUESTION_HEADING = /^#{1,6}\s+((?:question\s+|q)\d+)\b.*$/gim;
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
  const matches = [...markdown.matchAll(QUESTION_HEADING)];
  if (!matches.length) return { preamble: markdown, sections: [] };
  return {
    preamble: markdown.slice(0, matches[0].index).trim(),
    sections: matches.map((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? markdown.length;
      return {
        label: match[1].toUpperCase().replace(/^QUESTION\s+/, "Q"),
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
        questionId: best.id,
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
