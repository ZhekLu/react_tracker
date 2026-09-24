import type { NodeViewRenderer } from "@tiptap/core";
import katex, { type KatexOptions } from "katex";
import { changeFormula } from "./editorInteractions";

/** Leave formula contents atomic; selection/undo remain native ProseMirror operations. */
export function mathNodeView(kind: "inline" | "block", options: KatexOptions | undefined,
  edit?: (kind: "inline" | "block", latex: string, position: number) => void): NodeViewRenderer {
  return ({node: initialNode, editor, getPos}) => {
    let node = initialNode;
    const dom: HTMLElement = document.createElement(kind === "inline" ? "span" : "div");
    dom.dataset.type = `${kind}-math`;
    dom.className = "noteMath";
    dom.contentEditable = "false";
    dom.setAttribute("role", "math");
    const renderedFormula = document.createElement("span");
    renderedFormula.className = "noteMathRendered";
    const layoutToggle = document.createElement("button");
    layoutToggle.className = "noteMathLayoutToggle";
    layoutToggle.contentEditable = "false";
    layoutToggle.type = "button";
    dom.append(renderedFormula, layoutToggle);
    let startX = 0, startY = 0;
    function render() {
      dom.dataset.latex = node.attrs.latex;
      const highlight = node.attrs.blockHighlight ?? node.marks.find(mark => mark.type.name === "highlight")?.attrs.color;
      dom.style.backgroundColor = highlight ?? "";
      dom.setAttribute("aria-label", `${kind === "inline" ? "Inline" : "Display"} formula: ${node.attrs.latex}`);
      dom.title = editor.isEditable ? "Click to select · Enter or double-click to edit · Delete to remove" : "";
      layoutToggle.hidden = !editor.isEditable;
      layoutToggle.textContent = kind === "block" ? "I" : "D";
      layoutToggle.title = kind === "block"
        ? "Make inline (⌘/Ctrl Shift M)"
        : "Make display (⌘/Ctrl Shift M)";
      layoutToggle.setAttribute(
        "aria-label",
        kind === "block" ? "Convert formula to inline" : "Convert formula to display",
      );
      katex.render(node.attrs.latex, renderedFormula, {...options, displayMode: kind === "block", throwOnError: false});
    }
    layoutToggle.addEventListener("mousedown", event => {
      event.preventDefault();
      event.stopPropagation();
    });
    layoutToggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const pos = getPos();
      if (!editor.isEditable || typeof pos !== "number") return;
      changeFormula(
        editor,
        pos,
        kind === "block" ? "inline" : "block",
        String(node.attrs.latex),
      );
      editor.commands.focus();
    });
    dom.addEventListener("mousedown", event => {startX = event.clientX; startY = event.clientY;});
    dom.addEventListener("click", event => {
      const pos = getPos();
      if (!editor.isEditable || typeof pos !== "number" || event.shiftKey || Math.hypot(event.clientX - startX, event.clientY - startY) > 4) return;
      event.preventDefault();
      editor.chain().focus().setNodeSelection(pos).run();
    });
    dom.addEventListener("dblclick", event => {
      const pos = getPos();
      if (!editor.isEditable || typeof pos !== "number") return;
      event.preventDefault();
      edit?.(kind, node.attrs.latex, pos);
    });
    render();
    return {dom, ignoreMutation: () => true,
      update(next) {if (next.type !== node.type) return false; node = next; render(); return true;},
      selectNode() {dom.classList.add("ProseMirror-selectednode");},
      deselectNode() {dom.classList.remove("ProseMirror-selectednode");},
    };
  };
}
