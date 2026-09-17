import { Editor, type JSONContent } from "@tiptap/core";
import { renderToString } from "katex";
import { discussionEditorExtensions } from "../components/editor/discussionEditorExtensions";

export const EDITOR_PARSER_VERSION = "tiptap-3.27.0/tracker-inline-runs-v3";

export function noteContentType(value: string): "html" | "markdown" {
  return /^\s*<(?:p|h[1-6]|ul|ol|pre|blockquote)\b/i.test(value) ? "html" : "markdown";
}

export function createIntegrityEditor(value: string) {
  // Tiptap builds the real schema/document without mounting a second editor or
  // rendering every formula to the DOM merely to check its serialization.
  return new Editor({element: null, extensions: discussionEditorExtensions(), content: value, contentType: noteContentType(value)});
}

export function editorDocumentFacts(node: JSONContent) {
  const text: string[] = [], math: string[] = [], marks: string[] = [], structure: string[] = [];
  function visit(n: JSONContent) {
    const mark = JSON.stringify((n.marks ?? []).map(m => [m.type, m.type === "highlight" ? m.attrs?.color : m.type === "link" ? m.attrs?.href : ""]).sort());
    if (n.type === "text") {
      text.push(n.text ?? "");
      for (const char of n.text ?? "") if (!/\s/.test(char)) marks.push(`${char}:${mark}`);
    } else if (n.type === "inlineMath" || n.type === "blockMath") {
      math.push(`${n.type}:${n.attrs?.latex}`);
      marks.push(`${n.type}:${n.attrs?.latex}:${mark}`);
    } else {
      structure.push(n.type === "heading" ? `heading:${n.attrs?.level}` : n.type ?? "");
      if (n.type === "image") structure.push(String(n.attrs?.src));
      if (n.type === "orderedList") structure.push(String(n.attrs?.start));
      if (n.type === "taskItem") structure.push(String(n.attrs?.checked));
    }
    n.content?.forEach(visit);
    if (n.type !== "text" && n.type !== "inlineMath") text.push("\n");
  }
  visit(node);
  return {text: text.join("").replace(/\s+/g, " ").trim(), math, marks, structure};
}

/** Compare the parsed editor document with a fresh parse of its saved output. */
export function inspectEditorMarkdown(parsed: string) {
  const first = createIntegrityEditor(parsed);
  let second: Editor | undefined;
  try {
    const serialized = first.getMarkdown();
    second = createIntegrityEditor(serialized);
    const before = editorDocumentFacts(first.getJSON()), after = editorDocumentFacts(second.getJSON());
    const checks: string[] = [];
    for (const key of ["text", "math", "marks", "structure"] as const) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) checks.push(`${key} changed after save/reopen`);
    }
    const formulas = [...new Set(before.math)];
    for (const formula of formulas) {
      const latex = formula.slice(formula.indexOf(":") + 1);
      try { renderToString(latex, {throwOnError: true, strict: false, displayMode: formula.startsWith("blockMath:")}); }
      catch { checks.push("formula does not render"); break; }
    }
    return {serialized, reopened: second.getMarkdown(), checks};
  } finally { first.destroy(); second?.destroy(); }
}
