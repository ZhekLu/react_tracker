import type { Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
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
  const kind = node.type.name === "inlineMath" ? "inline" as const : "block" as const;
  return {kind, latex: String(node.attrs.latex), position: from, originalKind: kind, originalLatex: String(node.attrs.latex)};
}

export function formulaLayoutError(editor: Editor, position: number, kind: "inline" | "block", latex: string) {
  if (position < 0 || position > editor.state.doc.content.size) return "The document changed. Close and reopen the formula editor.";
  const $pos = editor.state.doc.resolve(position);
  const inTable = Array.from({length: $pos.depth + 1}, (_, depth) => $pos.node(depth).type.name)
    .some(type => type === "tableCell" || type === "tableHeader");
  if (kind === "block" && inTable) return "Markdown tables support inline formulas. Move this formula outside the table to use display layout.";
  if (kind === "inline" && /\n\s*\n/.test(latex)) return "Remove blank lines inside this formula before using inline layout.";
  if (inTable && /\n/.test(latex)) return "Keep formulas in Markdown tables on one source line.";
  return "";
}

function trimInlineEdge(
  editor: Editor,
  fragment: Fragment,
  edge: "start" | "end",
): Fragment {
  const children: ProseMirrorNode[] = [];
  fragment.forEach((child) => children.push(child));
  let index = edge === "start" ? 0 : children.length - 1;
  while (index >= 0 && index < children.length) {
    const child = children[index];
    if (!child.isText) break;
    const text = edge === "start"
      ? (child.text ?? "").replace(/^\s+/, "")
      : (child.text ?? "").replace(/\s+$/, "");
    if (text) {
      children[index] = editor.schema.text(text, child.marks);
      break;
    }
    children.splice(index, 1);
    if (edge === "end") index -= 1;
  }
  return Fragment.fromArray(children);
}

/** Change formula layout while preserving its surrounding sentence structure. */
export function changeFormula(editor: Editor, position: number, kind: "inline" | "block", latex: string) {
  if (formulaLayoutError(editor, position, kind, latex)) return false;
  const node = editor.state.doc.nodeAt(position);
  if (!node || !["inlineMath", "blockMath"].includes(node.type.name) || !latex.trim()) return false;
  const type = editor.schema.nodes[kind === "inline" ? "inlineMath" : "blockMath"];
  const tr = editor.state.tr;
  if (node.type === type) {
    tr.setNodeMarkup(position, type, {...node.attrs, latex: latex.trim()}, node.marks);
    tr.setSelection(NodeSelection.create(tr.doc, position));
  }
  else if (kind === "inline") {
    const marks = node.attrs.blockHighlight ? [editor.schema.marks.highlight.create({color: node.attrs.blockHighlight})] : [];
    const inlineFormula = type.create({latex: latex.trim()}, null, marks);
    const $position = editor.state.doc.resolve(position);
    const previous = $position.index() > 0
      ? $position.parent.child($position.index() - 1)
      : null;
    const next = $position.index() + 1 < $position.parent.childCount
      ? $position.parent.child($position.index() + 1)
      : null;
    if (previous?.isTextblock) {
      const insertAt = position - 1;
      const needsSpace = previous.content.size > 0 && !/\s$/.test(previous.textContent);
      const deleteTo = position + node.nodeSize + (
        next?.isTextblock && next.content.size === 0 ? next.nodeSize : 0
      );
      tr.delete(position, deleteTo);
      if (needsSpace) tr.insertText(" ", insertAt);
      const formulaPosition = insertAt + (needsSpace ? 1 : 0);
      tr.insert(formulaPosition, inlineFormula);
      tr.setSelection(NodeSelection.create(tr.doc, formulaPosition));
    } else {
      tr.replaceWith(
        position,
        position + node.nodeSize,
        editor.schema.nodes.paragraph.create(null, inlineFormula),
      );
      tr.setSelection(NodeSelection.create(tr.doc, position + 1));
    }
  } else {
    const color = node.marks.find(mark => mark.type.name === "highlight")?.attrs.color ?? null;
    const $position = editor.state.doc.resolve(position);
    const parent = $position.parent;
    if (!parent.isTextblock) return false;
    const parentStart = $position.before($position.depth);
    const parentEnd = $position.after($position.depth);
    const before = trimInlineEdge(
      editor,
      parent.content.cut(0, $position.parentOffset),
      "end",
    );
    const after = trimInlineEdge(
      editor,
      parent.content.cut($position.parentOffset + node.nodeSize),
      "start",
    );
    const blocks: ProseMirrorNode[] = [];
    if (before.size) blocks.push(parent.type.create(parent.attrs, before));
    const formulaPosition = parentStart + (before.size ? blocks[0].nodeSize : 0);
    blocks.push(type.create({latex: latex.trim(), blockHighlight: color}));
    if (after.size) blocks.push(parent.type.create(parent.attrs, after));
    try {
      tr.replaceWith(parentStart, parentEnd, Fragment.fromArray(blocks));
      tr.setSelection(NodeSelection.create(tr.doc, formulaPosition));
    } catch {
      return false;
    }
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
