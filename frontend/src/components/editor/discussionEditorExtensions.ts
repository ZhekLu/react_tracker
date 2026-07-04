import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Mathematics } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { common, createLowlight } from "lowlight";
import type {
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
  JSONContent,
} from "@tiptap/core";

export const PRIMARY_DISCUSSION_HIGHLIGHT = "#fff0a8";
export const SECONDARY_DISCUSSION_HIGHLIGHT = "#cfe8ff";
const lowlight = createLowlight(common);

function highlightStart(source: string): number {
  const starts = [source.indexOf("=="), source.indexOf("^^")].filter(
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
      node.attrs?.color === SECONDARY_DISCUSSION_HIGHLIGHT ? "^^" : "==";
    return `${delimiter}${helpers.renderChildren(node.content ?? [])}${delimiter}`;
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    return helpers.applyMark(
      "highlight",
      helpers.parseInline(token.tokens ?? []),
      {
        color:
          token.color === "secondary"
            ? SECONDARY_DISCUSSION_HIGHLIGHT
            : PRIMARY_DISCUSSION_HIGHLIGHT,
      },
    );
  },

  markdownTokenizer: {
    name: "highlight",
    level: "inline",
    start: highlightStart,
    tokenize(source, _tokens, lexer) {
      const delimiter = source.startsWith("==")
        ? "=="
        : source.startsWith("^^")
          ? "^^"
          : "";
      if (!delimiter) return undefined;
      const end = source.indexOf(delimiter, delimiter.length);
      if (end <= delimiter.length) return undefined;
      const text = source.slice(delimiter.length, end).trim();
      if (!text) return undefined;
      const raw = source.slice(0, end + delimiter.length);
      return {
        color: delimiter === "^^" ? "secondary" : "primary",
        raw,
        text,
        tokens: lexer.inlineTokens(text),
        type: "highlight",
      };
    },
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
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
    }),
    CodeBlockLowlight.configure({
      defaultLanguage: "plaintext",
      enableTabIndentation: true,
      lowlight,
      tabSize: 4,
    }),
    DiscussionHighlight.configure({ multicolor: true }),
    Placeholder.configure({ placeholder }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Typography,
    Mathematics.configure({
      blockOptions: {
        onClick: (node, position) =>
          onFormulaClick?.("block", String(node.attrs.latex ?? ""), position),
      },
      inlineOptions: {
        onClick: (node, position) =>
          onFormulaClick?.("inline", String(node.attrs.latex ?? ""), position),
      },
      katexOptions: {
        throwOnError: false,
      },
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
