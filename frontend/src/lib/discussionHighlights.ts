export type DiscussionHighlightExcerpt = {
  color: "primary" | "secondary";
  contextMarkdown: string;
  heading: string;
  markdown: string;
  nextMarkdown: string;
  previousMarkdown: string;
};

const HIGHLIGHT = /(==|\^\^|!!|%%)([\s\S]*?)\1/g;
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type Node = {type: string; value?: string; lang?: string | null; children?: Node[]; position?: {start: {offset?: number}; end: {offset?: number}}};

export function discussionHighlights(
  markdown: string,
  options: { selectedTextOnly?: boolean } = {},
): DiscussionHighlightExcerpt[] {
  const masked = markdown.split("");
  const blockHighlights: (DiscussionHighlightExcerpt & {start: number})[] = [];
  function visit(node: Node) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (["code", "inlineCode", "math", "inlineMath"].includes(node.type) && start !== undefined && end !== undefined) {
      for (let i = start; i < end; i++) if (masked[i] !== "\n") masked[i] = " ";
    }
    node.children?.forEach((child, index, siblings) => {
      const color = child.type === "html" ? child.value?.match(/^<!-- note-highlight:(yellow|blue|question|todo) -->$/)?.[1] : undefined;
      const block = siblings[index + 1];
      const offset = child.position?.start.offset;
      if (color && offset !== undefined && block && ["code", "math"].includes(block.type)) {
        const fence = "`".repeat(Math.max(2, ...[...(block.value ?? "").matchAll(/`+/g)].map(match => match[0].length)) + 1);
        const body = block.type === "math" ? `$$\n${block.value}\n$$` : `${fence}${block.lang ?? ""}\n${block.value ?? ""}\n${fence}`;
        blockHighlights.push({start: offset, color: color === "blue" ? "secondary" : "primary", heading: discussionHeadingAt(markdown, offset),
          markdown: body, contextMarkdown: `<!-- note-highlight:${color} -->\n\n${body}`, previousMarkdown: "", nextMarkdown: ""});
      }
      visit(child);
    });
  }
  visit(parser.parse(markdown));
  const searchable = masked.join("");
  const highlights = [...searchable.matchAll(HIGHLIGHT)]
    .map((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const context = highlightContext(markdown, start, end);
      return {
      start,
      color: match[1] === "^^" ? ("secondary" as const) : ("primary" as const),
      ...context,
      markdown: markdown.slice(start + match[1].length, end - match[1].length).trim(),
      };
    })
    .filter((highlight) => highlight.markdown.length > 0);
  if (options.selectedTextOnly) return [...highlights, ...blockHighlights].sort((a, b) => a.start - b.start);
  return [
    ...new Map(
      [...highlights, ...blockHighlights].sort((a, b) => a.start - b.start).map((highlight) => [
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
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
