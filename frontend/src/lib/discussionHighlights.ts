export type DiscussionHighlightExcerpt = {
  color: "primary" | "secondary";
  contextMarkdown: string;
  heading: string;
  markdown: string;
  nextMarkdown: string;
  previousMarkdown: string;
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
  const highlights = [...searchable.matchAll(HIGHLIGHT)]
    .map((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const context = highlightContext(markdown, start, end);
      return {
      color: match[1] === "^^" ? ("secondary" as const) : ("primary" as const),
      ...context,
      markdown: match[2].trim(),
      };
    })
    .filter((highlight) => highlight.markdown.length > 0);
  return [
    ...new Map(
      highlights.map((highlight) => [
        `${highlight.heading}\u0000${highlight.contextMarkdown
          .replace(HIGHLIGHT, "$2")
          .replace(/\s+/g, " ")}`,
        highlight,
      ]),
    ).values(),
  ];
}

export function discussionHeadingAt(markdown: string, start: number): string {
  const headings = [...markdown.slice(0, start).matchAll(/^#{1,6}\s+(.+)$/gm)];
  return headings.at(-1)?.[1].replace(/[*_`]/g, "").trim() ?? "Discussion";
}

function sentenceSpans(block: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const matcher = /\S(?:[\s\S]*?)(?:[.!?]+(?:["')\]}]*)?(?=\s+(?:[A-Z0-9“"'`]|\$|$)|$))/g;
  for (const match of block.matchAll(matcher)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length });
  }
  return spans.length ? spans : [{ start: 0, end: block.length }];
}

function highlightContext(
  markdown: string,
  start: number,
  end: number,
): Pick<
  DiscussionHighlightExcerpt,
  "contextMarkdown" | "heading" | "nextMarkdown" | "previousMarkdown"
> {
  const blockStart = markdown.lastIndexOf("\n\n", start - 1);
  const nextBreak = markdown.indexOf("\n\n", end);
  const from = blockStart < 0 ? 0 : blockStart + 2;
  const to = nextBreak < 0 ? markdown.length : nextBreak;
  const block = markdown.slice(from, to).trim();
  const leadingTrim = markdown.slice(from, to).length - markdown.slice(from, to).trimStart().length;
  const relativeStart = Math.max(0, start - from - leadingTrim);
  const relativeEnd = Math.max(relativeStart, end - from - leadingTrim);
  const spans = sentenceSpans(block);
  const currentIndex = Math.max(
    0,
    spans.findIndex(
      (span) => span.start <= relativeStart && span.end >= relativeEnd,
    ),
  );
  const current = spans[currentIndex] ?? spans[0];
  const previous = spans[currentIndex - 1];
  const next = spans[currentIndex + 1];
  return {
    contextMarkdown: block.slice(current.start, current.end).trim(),
    heading: discussionHeadingAt(markdown, start),
    nextMarkdown: next ? block.slice(next.start, next.end).trim() : "",
    previousMarkdown: previous
      ? block.slice(previous.start, previous.end).trim()
      : "",
  };
}

export function discussionHighlightsMarkdown(markdown: string): string {
  return discussionHighlights(markdown)
    .map((highlight) =>
      [
        highlight.previousMarkdown,
        highlight.contextMarkdown,
        highlight.nextMarkdown,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n\n---\n\n");
}
