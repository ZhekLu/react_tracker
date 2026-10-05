import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

export const SQUEEZE_VERSION = "source-squeeze-v2";
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
export type SqueezeUnit = {
  id: string; source: string; text: string; gap: string;
  container: string; indent: number;
  kind: "paragraph" | "math" | "text" | "structure";
  layout: "inline" | "block"; join: boolean;
  suggestedLayout: "inline" | "block"; suggestedJoin: boolean;
  reviewedJoin: boolean; reviewedLayout: boolean; reason: string;
};
export type SqueezeAction = {
  command: string; unitId: string; at: string;
  before: {text: string; layout: string; join: boolean};
  after: {text: string; layout: string; join: boolean};
  previous: string;
};
export type SqueezeDraft = {version: string; canonical: string; suggested: string; units: SqueezeUnit[]; actions: SqueezeAction[]};

function shortFormula(latex: string): boolean {
  const compact = latex.replace(/\s+/g, " ").trim();
  // Box and spacing markup make compact tuples look longer in source.
  const limit = /^\\boxed\{/.test(compact) ? 80 : 56;
  return compact.length <= limit &&
    !/^\s*=/.test(latex) && !/\\(?:[dct]?frac|genfrac|[dt]?binom|over|begin|end|tag|label)(?![A-Za-z])|\\\\/.test(latex);
}
function shortText(text: string): boolean {
  return text.length <= 160 && !text.includes("\n") && !/[┌┐└┘├┤┬┴┼│─]|\+[-+]+\+/.test(text);
}
function shortCodeExpression(text: string): boolean {
  // Only simple comparisons; statements, calls and assignments stay fenced.
  const identifier = "[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*";
  return text.length <= 80 && !text.includes("\n") &&
    new RegExp(`^${identifier}\\s*(?:==|!=|<=|>=|<|>)\\s*(?:${identifier}|[-+]?\\d+(?:\\.\\d+)?)$`).test(text.trim());
}
function renderedSource(unit: SqueezeUnit): string {
  if (unit.layout === "block" || unit.kind === "paragraph" || unit.kind === "structure") return unit.text;
  if (unit.kind === "math") {
    const body = unit.text.replace(/^\s*\$\$[^\n]*\n?|\$\$\s*$/g, "").trim();
    // Same-line displays are valid too; keep their complete body.
    const sameLine = unit.text.trim().match(/^\$\$([^\n]+)\$\$$/);
    return `$${(sameLine?.[1] ?? body).replace(/\s+/g, " ").trim()}$`;
  }
  const body = unit.text.replace(/^\s*(?:`{3,}|~{3,})[^\n]*\n/, "").replace(/\n\s*(?:`{3,}|~{3,})\s*$/, "").trim();
  const fence = "`".repeat(Math.max(1, ...[...body.matchAll(/`+/g)].map(match => match[0].length + 1)));
  const padding = body.includes("`") ? " " : "";
  return `${fence}${padding}${body}${padding}${fence}`;
}
export function canJoinUnit(units: SqueezeUnit[], index: number): boolean {
  if (!index) return false;
  const eligible = (unit: SqueezeUnit) => unit.kind === "paragraph" || (unit.kind !== "structure" && unit.layout === "inline");
  return units[index - 1].container === units[index].container && eligible(units[index - 1]) && eligible(units[index]);
}
export function canAttachUnit(units: SqueezeUnit[], index: number): boolean {
  if (!index || units[index].kind === "structure") return false;
  return canJoinUnit(units.map((unit, at) => at === index ? {...unit, layout: "inline"} : unit), index);
}
export function renderSqueezeUnits(units: SqueezeUnit[]): string {
  let result = "";
  units.forEach((unit, index) => {
    const text = renderedSource(unit);
    if (unit.join && canJoinUnit(units, index)) {
      // Removing a Markdown hard-break backslash is part of removing the break.
      result = result.replace(/[ \t\n]+$/, "").replace(/(?<!\\)\\$/, "");
      result += ` ${text.replace(/^\s+/, "")}`;
    } else result += (index ? unit.gap || "\n\n" : unit.gap) + text;
  });
  return result.trim();
}
function unitFromNode(node: RootContent, canonical: string, index: number, gap: string, container: string): SqueezeUnit {
  const source = canonical.slice(node.position!.start.offset, node.position!.end.offset);
  let kind: SqueezeUnit["kind"] = "structure";
  let layout: SqueezeUnit["layout"] = "block";
  let reason = "Keep document structure";
  if (node.type === "paragraph") {kind = "paragraph"; reason = "Keep paragraph";}
  if (node.type === "math") {
    kind = "math"; layout = shortFormula(node.value) ? "inline" : "block";
    reason = layout === "inline" ? "Short formula, no fraction" : "Fraction, long formula or structured derivation";
  }
  if (node.type === "code" && node.lang?.toLowerCase() === "text") {
    kind = "text"; layout = shortText(node.value) ? "inline" : "block";
    reason = layout === "inline" ? "Short text field" : "Multiline text or diagram";
  }
  return {id: `unit-${index}`, source, text: source, gap, kind, layout, join: false, container,
    indent: container === "root" ? 0 : node.position!.start.column - 1,
    suggestedLayout: layout, suggestedJoin: false, reviewedJoin: false, reviewedLayout: false, reason};
}
export function createSqueezeDraft(canonical: string): SqueezeDraft {
  const root = parser.parse(canonical) as Root;
  let end = 0;
  let paragraphLength = 0;
  const units: SqueezeUnit[] = [];
  function visit(node: RootContent, container: string, next?: RootContent) {
    // List item prefixes stay in source gaps; distinct items never join.
    if (node.type === "list") {node.children.forEach(item => item.children.forEach((child, at) => visit(child, `item-${item.position!.start.offset}`, item.children[at + 1]))); return;}
    const index = units.length;
    const start = node.position!.start.offset!;
    const unit = unitFromNode(node, canonical, index, canonical.slice(end, start), container);
    end = node.position!.end.offset!;
    const previous = units[index - 1];
    const introduced = previous?.container === container && previous.kind === "paragraph" && /:\s*$/.test(previous.text);
    if (node.type === "code" && node.lang && introduced && shortCodeExpression(node.value)) {
      unit.kind = "text"; unit.layout = "inline"; unit.suggestedLayout = "inline";
      unit.reason = "Short code expression after an introduction";
    }
    const content = renderedSource(unit).trim();
    const shortParagraph = unit.kind === "paragraph" && content.length <= 220 &&
      (content.match(/[.!?](?=\s|$)/g) ?? []).length <= 1 && !/\n|(?: {2}|\\)$/.test(content);
    units.push(unit);
    const inlineCodeIntroduction = node.type === "paragraph" && node.children.some(child =>
      child.type === "inlineCode" && shortCodeExpression(child.value) &&
      /:\s*$/.test(canonical.slice(start, child.position!.start.offset)));
    const codeIntroduction = /:\s*$/.test(content) && next?.type === "code" && !!next.lang &&
      (next.lang.toLowerCase() !== "text" || shortCodeExpression(next.value));
    const topicIntroduction = unit.kind === "paragraph" && /[.!?]\s*$/.test(previous?.text ?? "") &&
      (/^Next\b[^:\n]*:/i.test(content) || codeIntroduction || inlineCodeIntroduction);
    const inlineComparison = node.type === "paragraph" && node.children[0]?.type === "inlineMath" && node.children.some((child, at) =>
      child.type === "text" && /^versus$/i.test(child.value.trim()) && node.children[at + 1]?.type === "inlineMath");
    const comparison = introduced && (inlineComparison || (unit.kind === "math" && next?.type === "paragraph" &&
      /^versus$/i.test(canonical.slice(next.position!.start.offset, next.position!.end.offset).trim())));
    // Let a short explanation finish its formula instead of stranding the tail.
    const paragraphLimit = shortParagraph && content.length <= 80 && previous?.kind === "math" && previous.layout === "inline" ? 780 : 700;
    unit.join = canJoinUnit(units, index) && (shortParagraph || unit.layout === "inline") &&
      !topicIntroduction && !comparison && paragraphLength + content.length < paragraphLimit;
    if (topicIntroduction) unit.reason = "Start a new topic";
    if (comparison) unit.reason += " · start a comparison paragraph";
    unit.suggestedJoin = unit.join;
    if (unit.join) unit.reason += " · attach short fragment to previous paragraph";
    paragraphLength = unit.join ? paragraphLength + content.length + 1 : content.length;
  }
  root.children.forEach((node, at) => visit(node, "root", root.children[at + 1]));
  return {version: SQUEEZE_VERSION, canonical, suggested: renderSqueezeUnits(units), units, actions: []};
}
export function squeezeMarkdown(canonical: string): string {return createSqueezeDraft(canonical).suggested;}

export function decideSqueeze(draft: SqueezeDraft, index: number, command: "join" | "separate" | "inline" | "block" | "accept" | "edit", text?: string): SqueezeDraft {
  const old = draft.units[index];
  if (!old || (command === "join" && !canAttachUnit(draft.units, index)) ||
    (["inline", "block"].includes(command) && !["math", "text"].includes(old.kind))) return draft;
  const units = draft.units.map(unit => ({...unit}));
  const unit = units[index];
  if (command === "join" || command === "separate") {
    unit.join = command === "join"; unit.reviewedJoin = true;
    if (unit.join && ["math", "text"].includes(unit.kind)) {unit.layout = "inline"; unit.reviewedLayout = true;}
    if (!unit.join && unit.container === units[index - 1]?.container) unit.gap = `\n\n${" ".repeat(unit.indent)}`;
  }
  if (command === "inline" || command === "block") {
    unit.layout = command; unit.reviewedLayout = true;
    if (command === "block") {
      unit.join = false;
      if (units[index + 1]) units[index + 1].join = false;
    }
  }
  if (command === "accept") {unit.reviewedJoin = true; unit.reviewedLayout = true;}
  if (command === "edit" && text !== undefined) {
    unit.text = text;
    const editedRoot = parser.parse(text) as Root;
    const edited = editedRoot.children.length === 1
      ? unitFromNode(editedRoot.children[0], text, index, unit.gap, unit.container) : null;
    const kind = edited?.kind ?? "structure";
    if (kind !== unit.kind) {unit.kind = kind; unit.layout = edited?.layout ?? "block";}
    if (unit.kind === "structure") unit.join = false;
  }
  const snapshot = (value: SqueezeUnit) => ({text: value.text, layout: value.layout, join: value.join});
  return {...draft, units, actions: [...draft.actions, {command, unitId: unit.id, at: new Date().toISOString(),
    before: snapshot(old), after: snapshot(unit), previous: draft.units[index - 1]?.text ?? ""}]};
}
