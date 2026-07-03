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
          restored.replace(`@@DISCUSSION_FENCED_CODE_${index}@@`, block),
        markdown,
      ),
  };
}

function sentenceCount(value: string): number {
  return (value.match(/[.!?](?=(?:["')\]}*])?(?:\s|$))/g) ?? []).length;
}

function isStructuralMarkdownBlock(block: string): boolean {
  const firstLine = block.split("\n", 1)[0].trim();
  return (
    /^(?:@@DISCUSSION_FENCED_CODE_\d+@@$|#{1,6}\s|```|~~~|>\s?|[-*_]{3,}\s*$|\$\$|\\\[|<[\w!/])/.test(firstLine) ||
    /^(?:[-+*]\s|\d+[.)]\s)/.test(firstLine) ||
    (block.includes("\n") &&
      block.split("\n").every((line) => /^\s*\|.*\|\s*$/.test(line)))
  );
}

function compactProseBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

export function densifyDiscussionMarkdown(value: string): string {
  const blocks = value
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const dense: { markdown: string; prose: boolean }[] = [];
  let proseBuffer = "";

  function flushProse() {
    if (!proseBuffer) return;
    dense.push({ markdown: proseBuffer, prose: true });
    proseBuffer = "";
  }

  for (const block of blocks) {
    if (isStructuralMarkdownBlock(block)) {
      flushProse();
      dense.push({ markdown: block, prose: false });
      continue;
    }
    const prose = compactProseBlock(block);
    proseBuffer = proseBuffer ? `${proseBuffer} ${prose}` : prose;
    if (sentenceCount(proseBuffer) >= 2) flushProse();
  }
  flushProse();

  if (
    dense.length >= 2 &&
    dense.at(-1)?.prose &&
    sentenceCount(dense.at(-1)?.markdown ?? "") < 2 &&
    dense.at(-2)?.prose
  ) {
    const trailing = dense.pop();
    dense[dense.length - 1].markdown += ` ${trailing?.markdown ?? ""}`;
  }
  return dense.map((block) => block.markdown).join("\n\n");
}

export function normalizeDiscussionMarkdown(value: string): string {
  const protectedMarkdown = protectFencedCode(value);
  const normalized = normalizeMathMarkdown(protectedMarkdown.value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^•\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return protectedMarkdown.restore(densifyDiscussionMarkdown(normalized));
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
