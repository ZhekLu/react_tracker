import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import type {Root, RootContent} from "mdast";
import {renderToString} from "katex";
import {createIntegrityEditor, noteContentType} from "./editorIntegrity";
import {normalizeMathMarkdown} from "./mathMarkdown";

const parser = unified().use(remarkParse).use(remarkMath);

/** Maintenance only. Never run heuristic repairs on ordinary editor saves. */
export function repairHistoricalMarkdown(source: string): {markdown: string; reasons: string[]} {
  const reasons = new Set<string>();
  if (noteContentType(source) === "html") {
    const editor = createIntegrityEditor(source);
    try {return {markdown: editor.getMarkdown(), reasons: ["legacy HTML converted to Markdown"]};}
    finally {editor.destroy();}
  }
  const protectedRanges: {start: number; end: number}[] = [];
  function visit(node: Root | RootContent) {
    if (["code", "inlineCode", "html", "math"].includes(node.type)) {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push({start, end});
    } else if ("children" in node) node.children.forEach(visit);
  }
  visit(parser.parse(source));
  const protectedText: string[] = [];
  let prefix = "TRACKERHISTORICALLITERAL";
  while (source.includes(prefix)) prefix += "X";
  let markdown = source;
  for (const {start, end} of protectedRanges.reverse()) {
    const index = protectedText.push(source.slice(start, end)) - 1;
    markdown = markdown.slice(0, start) + `${prefix}${index}END` + markdown.slice(end);
  }
  function repair(pattern: RegExp, replace: (match: string, ...args: string[]) => string, reason: string) {
    markdown = markdown.replace(pattern, (match, ...args) => {
      const next = replace(match, ...args);
      if (next !== match) reasons.add(reason);
      return next;
    });
  }
  repair(/\bY[ \t]*\n\s*\n[ \t]*es\b/g, () => "Yes", "split Yes paragraph");
  repair(/(\*\*[^*\n]+?)\*{4}(\$[^$\n]+\$)\*{4}([^*\n]*\*\*)/g,
    (_, before, math, after) => before + math + after, "bold split around formula");
  repair(/[^\n]*\\\*\\\*[^\n]+?\\\*\\\*[^\n]*/g, paragraph => paragraph.replace(
    /\$(?!\$)((?:\\.|[^$\n\\])+)\$(?!\$)/g, (match, body: string) => {
      const fixed = body.replace(/\\\\([A-Za-z]+)/g, "\\$1").replace(/\\_/g, "_");
      try {renderToString(fixed, {throwOnError: true}); return `$${fixed}$`;}
      catch {return match;}
    }), "escaped formulas in corrupted list paragraph");
  repair(/\\\*\\\*([^\n]+?)\\\*\\\*/g, (_, content) => `**${content}**`, "escaped bold delimiters");
  repair(/\$(?!\$)((?:\\.|[^$\n\\])+)\$(?!\$)/g, (match, body) => {
    if (!/\\\\[A-Za-z]+/.test(body) || !/\\_/.test(body)) return match;
    const fixed = body.replace(/\\\\([A-Za-z]+)/g, "\\$1").replace(/\\_/g, "_");
    try {renderToString(fixed, {throwOnError: true}); return `$${fixed}$`;}
    catch {return match;}
  }, "double-escaped inline formula");
  // The former atom renderer closed both marks, wrapped the atom again, then
  // reopened them in a crossed order. Recognize only these exact signatures.
  repair(/(==|\^\^|!!|%%)\*{4}\1(\$[^$\n]+\$)\1\*\*\1\*\*/g,
    (_, _mark, math) => math, "crossed highlight and bold around formula");
  repair(/\*\*(==|\^\^|!!|%%)\*\*\1(\$[^$\n]+\$)\1\*{4}\1/g,
    (_, _mark, math) => math, "crossed bold and highlight around formula");
  repair(/(==|\^\^|!!|%%)\1(\$[^$\n]+\$)\1\1/g,
    (_, _mark, math) => math, "highlight split around formula");
  repair(/^(==|\^\^|!!|%%)((?:(?!\1)[^\n])*?)\1\*\*$/gm,
    (match, mark, content) => content.split("**").length === 2
      ? `${mark}${content}**${mark}` : match, "crossed closing bold and highlight");
  // e\[a\] is escaped prose notation, not a display formula. Preserve it
  // rather than treating the backslashes as external LaTeX display fences.
  markdown = markdown.replace(/(?<=\w)\\\[[^\n]*?\\\]/g, literal =>
    `${prefix}${protectedText.push(literal) - 1}END`);
  const restoredDisplays = normalizeMathMarkdown(markdown);
  if (restoredDisplays !== markdown) {
    reasons.add("legacy display delimiters");
    markdown = restoredDisplays;
  }
  repair(/^\$[ \t]*\n([\s\S]+?)\n\$[ \t]*$/gm, (match, body) => {
    const candidate = body.replace(/^={2,}$/gm, "=");
    try {renderToString(candidate, {throwOnError: true, displayMode: true, strict: false}); return `$$\n${candidate}\n$$`;}
    catch {return match;}
  }, "multiline single-dollar display");
  markdown = markdown.replace(new RegExp(`${prefix}(\\d+)END`, "g"), (_, index: string) => protectedText[Number(index)]);
  const repairs: {start: number; end: number; value: string}[] = [];
  function repairMath(node: Root | RootContent) {
    if (node.type === "math" || node.type === "inlineMath") {
      const displayMode = node.type === "math";
      try {renderToString(node.value, {throwOnError: true, displayMode, strict: false}); return;}
      catch { /* Only repair a formula that currently fails to render. */ }
      let candidate = node.value.replace(/\\left\{/g, "\\left\\{").replace(/\\right\}/g, "\\right\\}");
      if (/\\begin\{[bp]?matrix\}/.test(candidate)) candidate = candidate.replace(/(?<!\\)\\(?=[a-z]_\d)/g, "\\\\");
      if (/\\text\{[^}\n]*%[^}\n]*\}/.test(candidate)) candidate = candidate.replace(/(?<!\\)%/g, "\\%");
      if (/^# /m.test(candidate)) candidate = candidate.replace(/^# (.+)$/gm, "$1\n=");
      candidate = candidate.replace(/(?<!\\)#(?=\\text\{distinct)/g, "\\#");
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (candidate !== node.value && start !== undefined && end !== undefined) {
        try {
          renderToString(candidate, {throwOnError: true, displayMode, strict: false});
          repairs.push({start, end, value: displayMode ? `$$\n${candidate}\n$$` : `$${candidate}$`});
          reasons.add("invalid formula escaping or row delimiter");
        } catch { /* Ambiguous damage remains for manual review. */ }
      }
    } else if ("children" in node) node.children.forEach(repairMath);
  }
  repairMath(parser.parse(markdown));
  for (const repair of repairs.reverse()) markdown = markdown.slice(0, repair.start) + repair.value + markdown.slice(repair.end);
  return {markdown, reasons: [...reasons]};
}
