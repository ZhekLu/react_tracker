import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import ListItem from "@tiptap/extension-list-item";
import OrderedList from "@tiptap/extension-ordered-list";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
import { serializeDiscussionDocument } from "./serializeDiscussionDocument";
import { Markdown } from "@tiptap/markdown";
import { common, createLowlight } from "lowlight";
import { Node } from "@tiptap/core";
import type {
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
  JSONContent,
} from "@tiptap/core";

export const PRIMARY_DISCUSSION_HIGHLIGHT = "#fff0a8";
export const SECONDARY_DISCUSSION_HIGHLIGHT = "#cfe8ff";
export const QUESTION_MARKER_HIGHLIGHT = "#ffd7e1";
export const TODO_MARKER_HIGHLIGHT = "#dcebc5";
const lowlight = createLowlight(common);

// Visible, stable boundaries in rich mode; literal comments in Markdown source.
const TutorReviewBoundary = Node.create({
  name: "tutorReviewBoundary", group: "block", atom: true,
  addAttributes: () => ({reviewId: {default: ""}, end: {default: false}}),
  parseHTML: () => [{tag: "div[data-tutor-review]", getAttrs: element => ({
    reviewId: element.getAttribute("data-tutor-review"), end: element.getAttribute("data-end") === "true",
  })}],
  renderHTML: ({node}) => ["div", {"data-tutor-review": node.attrs.reviewId,
    "data-end": String(node.attrs.end), class: "tutorReviewBoundary", contenteditable: "false"},
    node.attrs.end ? "End of tutor review" : "Tutor review"],
  renderMarkdown: node => `<!-- ${node.attrs?.end ? "/" : ""}tutor-review:${node.attrs?.reviewId} -->`,
  parseMarkdown: token => ({type: "tutorReviewBoundary", attrs: {reviewId: token.reviewId, end: token.end}}),
  markdownTokenizer: {name: "tutorReviewBoundary", level: "block",
    start: source => source.search(/<!-- \/?tutor-review:/),
    tokenize(source) {
      const match = source.match(/^<!-- (\/)?tutor-review:([a-zA-Z0-9-]+) -->[ \t]*(?:\n|$)/);
      return match ? {type: "tutorReviewBoundary", raw: match[0], reviewId: match[2], end: Boolean(match[1])} : undefined;
    },
  },
});

function highlightStart(source: string): number {
  const starts = ["==", "^^", "!!", "%%"].map((delimiter) => source.indexOf(delimiter)).filter(
    (position) => position >= 0,
  );
  return starts.length ? Math.min(...starts) : -1;
}

const DiscussionHighlight = Highlight.extend({
  renderMarkdown(
    node: JSONContent,
    helpers: MarkdownRendererHelpers,
  ): string {
    const delimiter =
      node.attrs?.color === SECONDARY_DISCUSSION_HIGHLIGHT
        ? "^^"
        : node.attrs?.color === QUESTION_MARKER_HIGHLIGHT
          ? "!!"
          : node.attrs?.color === TODO_MARKER_HIGHLIGHT
            ? "%%"
            : "==";
    return `${delimiter}${helpers.renderChildren(node.content ?? [])}${delimiter}`;
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    const color = token.color === "secondary" ? SECONDARY_DISCUSSION_HIGHLIGHT
      : token.color === "question" ? QUESTION_MARKER_HIGHLIGHT
      : token.color === "todo" ? TODO_MARKER_HIGHLIGHT : PRIMARY_DISCUSSION_HIGHLIGHT;
    // The upstream applyMark helper marks text only, dropping inline atoms.
    return helpers.parseInline(token.tokens ?? []).map(node => ({
      ...node,
      marks: node.marks?.some(mark => mark.type === "highlight") ? node.marks : [...(node.marks ?? []), {type: "highlight", attrs: {color}}],
    }));
  },

  markdownTokenizer: {
    name: "highlight",
    level: "inline",
    start: highlightStart,
    tokenize(source, _tokens, lexer) {
      const delimiter =
        ["==", "^^", "!!", "%%"].find((candidate) =>
          source.startsWith(candidate),
        ) ?? "";
      if (!delimiter) return undefined;
      const end = source.indexOf(delimiter, delimiter.length);
      if (end <= delimiter.length) return undefined;
      // Whitespace at a highlighted span's edges is semantic when an inline
      // math atom splits one visual selection into several marked text runs.
      // Trimming here glued prose to the formula after the next editor
      // round-trip (for example `forward $\\lambda$` became
      // `forward$\\lambda$`, and `because $w$ changes` became
      // `because$w$changes`). Validate with trim, but parse the exact text.
      const text = source.slice(delimiter.length, end);
      if (!text.trim()) return undefined;
      const raw = source.slice(0, end + delimiter.length);
      return {
        color:
          delimiter === "^^"
            ? "secondary"
            : delimiter === "!!"
              ? "question"
              : delimiter === "%%"
                ? "todo"
                : "primary",
        raw,
        text,
        tokens: lexer.inlineTokens(text),
        type: "highlight",
      };
    },
  },
});

// Document serialization treats these atoms as members of the surrounding
// inline mark run. A standalone atom renderer emits only its formula body.
const DiscussionInlineMath = InlineMath.extend({
  renderMarkdown(node: JSONContent): string {
    return `$${node.attrs?.latex ?? ""}$`;
  },
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start: (source: string) => source.search(/(?<![$\\])\$(?!\$)(?:\\.|[^$\n\\])+\$(?!\$)/),
    tokenize(source: string) {
      // Never consume a display delimiter, a newline, or an escaped dollar.
      const match = source.match(/^\$(?!\$)((?:\\.|[^$\n\\])+)\$(?!\$)/);
      return match ? { type: "inlineMath", raw: match[0], latex: match[1].trim() } : undefined;
    },
  },
});

function markInlineContent(type: string, token: MarkdownToken, helpers: MarkdownParseHelpers, attrs?: Record<string, unknown>) {
  return helpers.parseInline(token.tokens ?? []).map(node => ({
    ...node, marks: node.marks?.some(mark => mark.type === type) ? node.marks : [...(node.marks ?? []), {type, ...(attrs ? {attrs} : {})}],
  }));
}

function renderListItem(node: JSONContent, helpers: MarkdownRendererHelpers, prefix: string, indentWidth = prefix.length) {
  const indent = " ".repeat(indentWidth);
  return (node.content ?? []).map((child, index) => {
    const content = helpers.renderChild?.(child, index) ?? helpers.renderChildren([child]);
    const lines = content.split("\n");
    return lines.map((line, lineIndex) =>
      index === 0 && lineIndex === 0 ? `${prefix}${line}` : `${indent}${line}`,
    ).join("\n");
  }).join("\n\n");
}

// The upstream alphabetic-list tokenizer interprets ordinary prose such as
// "Yes." as an ordered list (even splitting off its first letter). Let Marked's
// standard CommonMark list tokenizer handle numbers and nested blocks instead.
const DiscussionOrderedList = OrderedList.extend({
  parseMarkdown: (token, helpers) => token.type === "list" && token.ordered
    ? {type: "orderedList", attrs: {start: token.start || 1}, content: helpers.parseChildren(token.items ?? [])}
    : [],
  markdownTokenizer: {
    name: "orderedList", level: "block",
    start: () => -1,
    tokenize: () => undefined,
  },
});

export function discussionEditorExtensions(
  onFormulaClick?: (
    kind: "inline" | "block",
    latex: string,
    position: number,
  ) => void,
  placeholder = "Write Markdown…",
) {
  return [
    TutorReviewBoundary,
    StarterKit.configure({
      document: false,
      paragraph: false,
      codeBlock: false,
      orderedList: false, listItem: false,
      bold: false, italic: false, strike: false, underline: false, link: false,
      heading: false,
    }),
    Document.extend({renderMarkdown: serializeDiscussionDocument}),
    Paragraph.extend({renderMarkdown: (node, helpers, context) => node.content?.length
      ? helpers.renderChildren(node.content)
      : ["table", "tableCell", "tableHeader"].includes(context.parentType ?? "") ? "" : "&nbsp;"}),
    Heading.extend({renderMarkdown: (node, helpers) => `${"#".repeat(Number(node.attrs?.level ?? 1))} ${helpers.renderChildren(node.content ?? []).replace(/\n/g, " ")}`})
      .configure({levels: [1, 2, 3, 4, 5, 6]}),
    DiscussionOrderedList,
    ListItem.extend({
      parseMarkdown(token, helpers) {
        // Marked emits a mix of block-text and paragraph tokens for loose
        // lists. Upstream parses the text tokens literally when any paragraph
        // exists, so each reload adds escapes to bold, math and links.
        const tokens = (token.tokens ?? []).map(child => child.type === "text"
          ? {...child, type: "paragraph", tokens: child.tokens ?? helpers.tokenizeInline?.(child.text ?? "")}
          : child);
        const content = helpers.parseChildren(tokens);
        if (content[0]?.type !== "paragraph") content.unshift({type: "paragraph", content: []});
        return {type: "listItem", content};
      },
      renderMarkdown: (node, helpers, context) => renderListItem(node, helpers,
      context.parentType === "orderedList" ? `${Number(context.meta?.parentAttrs?.start ?? 1) + context.index}. ` : "- ",
    )}),
    Bold.extend({parseMarkdown: (token, helpers) => markInlineContent("bold", token, helpers)}),
    Italic.extend({parseMarkdown: (token, helpers) => markInlineContent("italic", token, helpers)}),
    Strike.extend({parseMarkdown: (token, helpers) => markInlineContent("strike", token, helpers)}),
    Underline.extend({parseMarkdown: (token, helpers) => markInlineContent("underline", token, helpers)}),
    Link.extend({parseMarkdown: (token, helpers) => markInlineContent("link", token, helpers, {href: token.href, title: token.title || null})}),
    CodeBlockLowlight.configure({
      defaultLanguage: "plaintext",
      enableTabIndentation: true,
      lowlight,
      tabSize: 4,
    }),
    DiscussionHighlight.configure({ multicolor: true }),
    Placeholder.configure({ placeholder }),
    TaskList,
    TaskItem.extend({renderMarkdown: (node, helpers) => renderListItem(node, helpers, `- [${node.attrs?.checked ? "x" : " "}] `, 2)}).configure({ nested: true }),
    TableKit,
    Image,
    DiscussionInlineMath.configure({
      onClick: (node, position) =>
        onFormulaClick?.("inline", String(node.attrs.latex ?? ""), position),
      katexOptions: { throwOnError: false },
    }),
    BlockMath.extend({markdownTokenizer: {
      name: "blockMath", level: "block",
      // A start hint must identify a complete token. Hinting at an orphan $$
      // makes Marked split a prose paragraph even when tokenize rejects it.
      start: (source: string) => source.search(/(?<!\\)\$\$[^$]+\$\$/),
      tokenize(source: string) {
        const match = source.match(/^\$\$([^$]+)\$\$/);
        return match ? {type: "blockMath", raw: match[0], latex: match[1].trim()} : undefined;
      },
    }}).configure({
      onClick: (node, position) =>
        onFormulaClick?.("block", String(node.attrs.latex ?? ""), position),
      katexOptions: { throwOnError: false },
    }),
    Markdown.configure({
      indentation: { size: 2, style: "space" },
      markedOptions: {
        breaks: false,
        gfm: true,
      },
    }),
  ];
}
