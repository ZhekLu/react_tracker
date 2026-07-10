export type DiscussionHighlightExcerpt = {
  color: "primary" | "secondary";
  contextMarkdown: string;
  markdown: string;
};

const FENCED_CODE =
  /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const HIGHLIGHT = /(==|\^\^|!!|%%)([\s\S]*?)\1/g;

export function discussionHighlights(
  markdown: string,
): DiscussionHighlightExcerpt[] {
  const searchable = markdown.replace(FENCED_CODE, (block) =>
    block.replace(/[^\n]/g, " "),
  );
  return [...searchable.matchAll(HIGHLIGHT)]
    .map((match) => ({
      color: match[1] === "^^" ? ("secondary" as const) : ("primary" as const),
      contextMarkdown: highlightContext(
        markdown,
        match.index ?? 0,
        (match.index ?? 0) + match[0].length,
      ),
      markdown: match[2].trim(),
    }))
    .filter((highlight) => highlight.markdown.length > 0);
}

function highlightContext(markdown: string, start: number, end: number): string {
  const blockStart = markdown.lastIndexOf("\n\n", start - 1);
  const nextBreak = markdown.indexOf("\n\n", end);
  const from = blockStart < 0 ? 0 : blockStart + 2;
  const to = nextBreak < 0 ? markdown.length : nextBreak;
  const block = markdown.slice(from, to).trim();
  if (block.length <= 700) return block;
  const relativeStart = start - from;
  const relativeEnd = end - from;
  return `${relativeStart > 220 ? "…" : ""}${block
    .slice(Math.max(0, relativeStart - 220), Math.min(block.length, relativeEnd + 260))
    .trim()}${relativeEnd + 260 < block.length ? "…" : ""}`;
}

export function discussionHighlightsMarkdown(markdown: string): string {
  return discussionHighlights(markdown)
    .map((highlight) => highlight.contextMarkdown)
    .join("\n\n---\n\n");
}
