import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const ALREADY_HIGHLIGHTED = /^\s*(==|\^\^|!!|%%)[\s\S]*\1\s*$/;

type MarkerNode = {
  type: string;
  value?: string;
  children?: MarkerNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

function prose(node: MarkerNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(prose).join("");
}

export function highlightNoteMarkers(markdown: string): string {
  const edits: { start: number; end: number; replacement: string }[] = [];
  function visit(node: MarkerNode) {
    if (node.type !== "paragraph") {
      node.children?.forEach(visit);
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const paragraph = markdown.slice(start, end);
    if (ALREADY_HIGHLIGHTED.test(paragraph)) return;
    const text = prose(node);
    const delimiter = /\btodo!/i.test(text)
    ? "%%"
    : text.includes("??")
      ? "!!"
      : "";
    if (delimiter) edits.push({ start, end, replacement: `${delimiter}${paragraph}${delimiter}` });
  }
  // Only wrap paragraph content, preserving list/quote prefixes and leaving
  // headings, tables, code, HTML and display math structurally intact.
  visit(parser.parse(markdown));
  for (const edit of edits.reverse()) {
    markdown = markdown.slice(0, edit.start) + edit.replacement + markdown.slice(edit.end);
  }
  return markdown;
}
