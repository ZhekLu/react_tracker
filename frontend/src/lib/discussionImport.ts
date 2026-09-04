import type {
  BlockContent,
  Blockquote,
  Code,
  Content,
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { normalizeMathMarkdown } from "./mathMarkdown";

type ProtectedMarkdown = {
  markdown: string;
  restore: (value: string) => string;
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const serializer = unified()
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    fences: true,
    listItemIndent: "one",
    rule: "-",
    strong: "*",
  });

function protectFencedCode(value: string): ProtectedMarkdown {
  const blocks: string[] = [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const opening = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const marker = opening[1][0];
    const minimumLength = opening[1].length;
    const block = [lines[index]];
    index += 1;
    while (index < lines.length) {
      block.push(lines[index]);
      if (
        new RegExp(`^ {0,3}${marker}{${minimumLength},}\\s*$`).test(
          lines[index],
        )
      ) {
        index += 1;
        break;
      }
      index += 1;
    }
    const token = `@@TRACKER_PASTED_CODE_${blocks.length}@@`;
    blocks.push(block.join("\n"));
    output.push("", token, "");
  }

  return {
    markdown: output.join("\n"),
    restore: (markdown) =>
      blocks.reduce(
        (current, block, blockIndex) =>
          current.replace(
            `@@TRACKER_PASTED_CODE_${blockIndex}@@`,
            () => block,
          ),
        markdown,
      ),
  };
}

function protectDisplayMath(value: string): ProtectedMarkdown {
  const blocks: string[] = [];
  const markdown = value.replace(
    /\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$(?!\$)/g,
    (block) => {
    const token = `@@TRACKER_PASTED_MATH_${blocks.length}@@`;
    blocks.push(block);
    return token;
    },
  );
  return {
    markdown,
    restore: (current) =>
      blocks.reduce(
        (restored, block, index) =>
          restored.replace(`@@TRACKER_PASTED_MATH_${index}@@`, () => block),
        current,
      ),
  };
}

function protectInlineCode(value: string): ProtectedMarkdown {
  const blocks: string[] = [];
  const markdown = value.replace(/`+[^`\n]*`+/g, (block) => {
    const token = `@@TRACKER_PASTED_INLINE_CODE_${blocks.length}@@`;
    blocks.push(block);
    return token;
  });
  return {
    markdown,
    restore: (current) =>
      blocks.reduce(
        (restored, block, index) =>
          restored.replace(
            `@@TRACKER_PASTED_INLINE_CODE_${index}@@`,
            () => block,
          ),
        current,
      ),
  };
}

function protectDiscussionExportTags(value: string): ProtectedMarkdown {
  const tags: string[] = [];
  const markdown = value.replace(
    /<\/?[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+>/g,
    (tag) => {
      const token = `TRACKERDISCUSSIONEXPORTTAG${tags.length}`;
      tags.push(tag);
      return token;
    },
  );
  return {
    markdown,
    restore: (current) =>
      tags.reduce(
        (restored, tag, index) =>
          restored.replace(`TRACKERDISCUSSIONEXPORTTAG${index}`, () => tag),
        current,
      ),
  };
}

function looksLikeLatex(value: string): boolean {
  return (
    /\\[A-Za-z]+/.test(value) ||
    /(?:^|[^\\])[_^](?:\{|[A-Za-z0-9])/.test(value) ||
    /[∑∏∫≤≥≠≈→←∞πγβθΔ]/u.test(value)
  );
}

function looksLikeDisplayMath(value: string): boolean {
  const body = value.trim();
  if (looksLikeLatex(body)) return true;
  if (/^[A-Za-z](?:_[*A-Za-z0-9{}]+)?(?:\([^\n]*\))?$/.test(body)) {
    return true;
  }
  if (/^[-+]?\d+(?:\.\d+)?$/.test(body)) return true;
  if (
    /[,()]/.test(body) &&
    /^[A-Za-z0-9_*{}(),.\s\\+<>=-]+$/.test(body)
  ) {
    return true;
  }
  return (
    body.length <= 120 &&
    !/[.!?]\s/.test(body) &&
    /(?:[=<>]|\d\s*[-+*/]\s*\d|^[-+]?\d[\d\s,.]+$)/.test(body)
  );
}

function normalizeDisplayBody(value: string): string {
  const lines = value
    .replace(/\\\\(?=[A-Za-z])/g, "\\")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (/^={2,}$/.test(line)) {
      normalized.push("=");
      continue;
    }
    if (/^#{2,}\s+/.test(line)) {
      normalized.push(line.replace(/^#{2,}\s+/, ""), "-");
      continue;
    } else if (/^#\s+/.test(line)) {
      normalized.push(line.replace(/^#\s+/, ""), "=");
      continue;
    }
    if (/^\[\d+(?:\.\d+)?mm\]$/.test(line)) {
      normalized.push(`\\\\${line}`);
      continue;
    }
    if (line === "*" && /^\\mathbb\b/.test(lines[index + 1] ?? "")) {
      normalized.push("-");
      continue;
    }
    line = line.replace(/(?<!\\)\\$/, "\\\\");
    normalized.push(line);
  }

  return normalized
    .join("\n")
    // ChatGPT's rendered-copy payload occasionally degrades an underbrace
    // subscript into `*{...}`.  This is structure, not multiplication.
    .replace(/(\\underbrace\{[^\n]+\})\s*\*\{([^\n]+)\}/g, "$1_{$2}")
    .replace(
      /(\\underbrace\{[\s\S]*?\})\s*\*\{(\\text\{[^}]*\})\}/g,
      "$1_{$2}",
    )
    .replace(/\\left\{/g, "\\left\\{")
    .replace(/\\right\}/g, "\\right\\}")
    // ChatGPT sometimes formats a subtraction sign as an underline-like row
    // between two operands. It looks like a Markdown divider, but inside a
    // display formula it is still the binary minus operator.
    .replace(/^[-]{3,}$/gm, "-")
    .replace(/\n=\n/g, " = ")
    .replace(/\n([+\-=])\s*/g, " $1 ")
    .replace(/(?:\s*=\s*){2,}/g, " = ")
    .replace(/^=\s*\n/, "= ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * A copied ChatGPT display delimiter can arrive as a Markdown heading `# [`.
 * When it immediately follows another display, ChatGPT used that heading-like
 * token for a continuation equals line (the browser still renders `= ...`).
 * Preserve that information before the generic heading cleanup erases it.
 */
function restoreHeadingCorruptedDisplayOpenings(value: string): string {
  const lines = value.split("\n");
  const output: string[] = [];
  for (const line of lines) {
    if (!/^ {0,3}#\s+\[\s*$/.test(line)) {
      output.push(line);
      continue;
    }
    const previous = [...output].reverse().find((candidate) => candidate.trim());
    output.push("[");
    if (previous?.trim() === "]") output.push("====");
  }
  return output.join("\n");
}

function restoreBracketDisplayMath(value: string): string {
  const lines = value.split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const opening = lines[index].match(/^(\s*(?:>\s*)*)\[\s*$/);
    if (!opening) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const prefix = opening[1];
    let closing = index + 1;
    while (closing < lines.length) {
      const candidate = lines[closing];
      const withoutPrefix = prefix
        ? candidate.startsWith(prefix)
          ? candidate.slice(prefix.length).trim()
          : null
        : candidate.trim();
      if (withoutPrefix === "]") {
        const nextLine = lines[closing + 1];
        if (
          prefix ||
          nextLine === undefined ||
          !nextLine.trim()
        ) {
          break;
        }
      }
      closing += 1;
    }
    if (closing >= lines.length) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const bodyLines = lines.slice(index + 1, closing).map((line) => {
      if (!prefix) return line;
      return line.startsWith(prefix) ? line.slice(prefix.length) : line;
    });
    const body = bodyLines.join("\n");
    if (!looksLikeDisplayMath(body)) {
      output.push(...lines.slice(index, closing + 1));
      index = closing + 1;
      continue;
    }
    const normalizedBody = normalizeDisplayBody(body);
    const mathLines = prefix
      ? [`${prefix}$${normalizedBody.replace(/\s+/g, " ")}$`]
      : ["$$", ...normalizedBody.split("\n"), "$$"];
    output.push("", ...mathLines, "");
    index = closing + 1;
  }
  return output.join("\n");
}

function restoreDegradedInlineMath(value: string): string {
  let output = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] !== "(") {
      output += value[index];
      index += 1;
      continue;
    }
    let depth = 1;
    let closing = index + 1;
    while (closing < value.length && depth > 0) {
      if (value[closing] === "(" && value[closing - 1] !== "\\") depth += 1;
      if (value[closing] === ")" && value[closing - 1] !== "\\") depth -= 1;
      closing += 1;
    }
    if (depth !== 0) {
      output += value[index];
      index += 1;
      continue;
    }
    const body = value.slice(index + 1, closing - 1);
    if (
      !body.includes("\n") &&
      looksLikeDisplayMath(body)
    ) {
      output += `$${body.trim()}$`;
    } else {
      output += value.slice(index, closing);
    }
    index = closing;
  }
  return output.replace(
    /\$([^$\n]+)\$\(([^()\n]+)\)/g,
    (_match, operator: string, argument: string) =>
      `$${operator.trim()}(${argument.trim()})$`,
  );
}

function canonicalizeExternalMarkdown(value: string): string {
  const normalizedExportTags = value.replace(
    /&lt;(\/?)((?:[A-Za-z0-9]+)(?:\\?_[A-Za-z0-9]+)+)&gt;/gi,
    (_match, closing: string, tag: string) =>
      `<${closing}${tag.replaceAll("\\_", "_")}>`,
  );
  const protectedCode = protectFencedCode(
    restoreHeadingCorruptedDisplayOpenings(normalizedExportTags),
  );
  const protectedInline = protectInlineCode(protectedCode.markdown);
  const normalized = protectedInline.markdown
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/&(?:amp;)*(?:nbsp|#0*160|#x0*a0);/gi, " ")
    .replace(/([A-Za-z])'\*\{([^}\n]+)\}/g, "$1'_{$2}")
    .replace(/([A-Za-z])\*\{([^}\n]+)\}/g, "$1_{$2}")
    .replace(/([A-Za-z])'\*([A-Za-z]|\\[A-Za-z]+)/g, "$1'_$2")
    .replace(/^ {0,3}#{1,6}\s+(\[|\])\s*$/gm, "$1")
    .replace(/^•\s+/gm, "- ");
  const existingMath = protectDisplayMath(normalized);
  const displays = existingMath.restore(
    restoreBracketDisplayMath(existingMath.markdown),
  );
  const normalizedMath = normalizeMathMarkdown(displays);
  const protectedDisplays = protectDisplayMath(normalizedMath);
  const inline = protectedDisplays.restore(
    restoreDegradedInlineMath(protectedDisplays.markdown),
  );
  return protectedCode
    .restore(protectedInline.restore(inline))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nodeText(node: Content): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return node.children.map(nodeText).join(" ");
  return "";
}

function sentenceCount(value: string): number {
  return (value.match(/[.!?](?=(?:["')\]}*])?(?:\s|$))/g) ?? []).length;
}

function normalizedInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePhrasingWhitespace(children: PhrasingContent[]): PhrasingContent[] {
  return children.map((child) => {
    if (child.type !== "text") return child;
    return { ...child, value: child.value.replace(/\s+/g, " ") };
  });
}

function smallDisplayMath(node: { value: string }): boolean {
  const latex = node.value.trim();
  return (
    latex.length <= 56 &&
    !/^=/.test(latex) &&
    !/[\n]|\\\\|\\(?:begin|end|sum|prod|int|underbrace|boxed|left|right)\b/.test(
      latex,
    )
  );
}

function compactTextCode(node: Code): Paragraph | Code {
  const compact = normalizedInlineText(node.value);
  const nonEmptyLines = node.value
    .split("\n")
    .filter((line) => line.trim()).length;
  if (
    node.lang?.toLocaleLowerCase() !== "text" ||
    nonEmptyLines > 1 ||
    compact.length > 160 ||
    sentenceCount(compact) > 1 ||
    /[┌┐└┘├┤┬┴┼│─]/u.test(node.value)
  ) {
    return node;
  }
  return {
    type: "paragraph",
    children: [{ type: "inlineCode", value: compact }],
  };
}

function paragraphJoin(left: Paragraph, right: Paragraph): Paragraph {
  const leftText = normalizedInlineText(nodeText(left));
  const rightText = normalizedInlineText(nodeText(right));
  const rightOnlyMath = right.children.every(
    (child) =>
      child.type === "inlineMath" ||
      (child.type === "text" && !child.value.trim()),
  );
  const lastMeaningfulLeftChild = [...left.children]
    .reverse()
    .find((child) => child.type !== "text" || child.value.trim());
  const consecutiveMath =
    lastMeaningfulLeftChild?.type === "inlineMath" && rightOnlyMath;
  const splitWord = /^Y$/i.test(leftText) && /^es\b/.test(rightText);
  return {
    type: "paragraph",
    children: [
      ...normalizePhrasingWhitespace(left.children),
      {
        type: "text",
        value: consecutiveMath ? "; " : splitWord ? "" : " ",
      },
      ...normalizePhrasingWhitespace(right.children),
    ],
  };
}

function compactShortBlockquote(node: Blockquote): Blockquote | Paragraph {
  if (node.children.length !== 1 || node.children[0].type !== "paragraph") {
    return node;
  }
  const paragraph = node.children[0];
  const text = normalizedInlineText(nodeText(paragraph));
  if (!text || text.length > 220 || sentenceCount(text) > 1) return node;
  return {
    type: "paragraph",
    children: [
      { type: "text", value: "“" },
      ...paragraph.children,
      { type: "text", value: "”" },
    ],
  };
}

function compactChildren(children: BlockContent[]): BlockContent[] {
  const converted = children.map((child): BlockContent => {
    if (child.type === "math" && smallDisplayMath(child)) {
      return {
        type: "paragraph",
        children: [{ type: "inlineMath", value: child.value.trim() }],
      };
    }
    if (child.type === "code") return compactTextCode(child);
    if ("children" in child && Array.isArray(child.children)) {
      const parent = child as Parent;
      const nested = {
        ...child,
        children: compactChildren(parent.children as BlockContent[]),
      } as BlockContent;
      return nested.type === "blockquote"
        ? compactShortBlockquote(nested)
        : nested;
    }
    return child;
  });

  const compacted: BlockContent[] = [];
  for (const child of converted) {
    const previous = compacted.at(-1);
    if (child.type === "paragraph") {
      child.children = normalizePhrasingWhitespace(child.children);
    }
    if (previous?.type === "paragraph" && child.type === "paragraph") {
      const previousText = normalizedInlineText(nodeText(previous));
      const nextText = normalizedInlineText(nodeText(child));
      if (previousText && previousText === nextText) continue;
      if (
        (/^Y$/i.test(previousText) && /^es\b/.test(nextText)) ||
        sentenceCount(nextText) < 2
      ) {
        compacted[compacted.length - 1] = paragraphJoin(previous, child);
        continue;
      }
    }
    compacted.push(child);
  }
  return compacted;
}

export function importPastedMarkdown(value: string): string {
  const canonical = canonicalizeExternalMarkdown(value);
  if (!canonical) return "";
  const protectedExports = protectDiscussionExportTags(canonical);
  const tree = parser.parse(protectedExports.markdown) as Root;
  tree.children = compactChildren(tree.children as BlockContent[]);
  return protectedExports.restore(String(serializer.stringify(tree))).trim();
}

export function canonicalizePastedMarkdown(value: string): string {
  return canonicalizeExternalMarkdown(value);
}
