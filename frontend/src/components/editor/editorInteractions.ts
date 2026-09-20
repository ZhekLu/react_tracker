import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

/** One transaction for text, formula atoms, and whole literal blocks. */
export function highlightSelection(editor: Editor, color: string, toggle = true) {
  const {from, to, empty, $from} = editor.state.selection;
  const blocks: number[] = [];
  let allHighlighted = true, targets = 0;
  editor.state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === "codeBlock" || node.type.name === "blockMath") {
      blocks.push(pos); targets++;
      allHighlighted &&= node.attrs.blockHighlight === color;
      return false;
    }
    if (node.isInline && parent?.type.allowsMarkType(editor.schema.marks.highlight)) {
      targets++;
      allHighlighted &&= node.marks.some(mark => mark.type.name === "highlight" && mark.attrs.color === color);
    }
  });
  if (empty && $from.parent.type.name === "codeBlock" && !blocks.length) {
    blocks.push($from.before()); targets++;
    allHighlighted = $from.parent.attrs.blockHighlight === color;
  }
  if (!targets) return editor.commands.toggleHighlight({color});
  const remove = toggle && allHighlighted;
  const tr = editor.state.tr;
  const mark = editor.schema.marks.highlight;
  if (remove) tr.removeMark(from, to, mark);
  else tr.addMark(from, to, mark.create({color}));
  for (const pos of blocks) {
    const node = tr.doc.nodeAt(pos)!;
    tr.setNodeMarkup(pos, undefined, {...node.attrs, blockHighlight: remove ? null : color}, node.marks);
  }
  editor.view.dispatch(tr);
  return true;
}

export function selectedFormula(editor: Editor) {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  const {node, from} = selection;
  if (node.type.name !== "inlineMath" && node.type.name !== "blockMath") return null;
  return {kind: node.type.name === "inlineMath" ? "inline" as const : "block" as const,
    latex: String(node.attrs.latex), position: from};
}

export function formulaLayoutError(editor: Editor, position: number, kind: "inline" | "block", latex: string) {
  const $pos = editor.state.doc.resolve(position);
  const inTable = Array.from({length: $pos.depth + 1}, (_, depth) => $pos.node(depth).type.name)
    .some(type => type === "tableCell" || type === "tableHeader");
  if (kind === "block" && inTable) return "Markdown tables support inline formulas. Move this formula outside the table to use display layout.";
  if (kind === "inline" && /\n\s*\n/.test(latex)) return "Remove blank lines inside this formula before using inline layout.";
  if (inTable && /\n/.test(latex)) return "Keep formulas in Markdown tables on one source line.";
  return "";
}

/** Replace in place using ProseMirror's schema-aware fitting, including list/table cells. */
export function changeFormula(editor: Editor, position: number, kind: "inline" | "block", latex: string) {
  const node = editor.state.doc.nodeAt(position);
  if (!node || !["inlineMath", "blockMath"].includes(node.type.name) || !latex.trim()) return false;
  if (formulaLayoutError(editor, position, kind, latex)) return false;
  const type = editor.schema.nodes[kind === "inline" ? "inlineMath" : "blockMath"];
  const tr = editor.state.tr;
  if (node.type === type) tr.setNodeMarkup(position, type, {...node.attrs, latex: latex.trim()}, node.marks);
  else if (kind === "inline") {
    const marks = node.attrs.blockHighlight ? [editor.schema.marks.highlight.create({color: node.attrs.blockHighlight})] : [];
    tr.replaceWith(position, position + node.nodeSize,
      editor.schema.nodes.paragraph.create(null, type.create({latex: latex.trim()}, null, marks)));
  } else {
    const color = node.marks.find(mark => mark.type.name === "highlight")?.attrs.color ?? null;
    tr.replaceRangeWith(position, position + node.nodeSize, type.create({latex: latex.trim(), blockHighlight: color}));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
