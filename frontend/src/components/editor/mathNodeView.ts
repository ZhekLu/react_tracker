import type { NodeViewRenderer } from "@tiptap/core";
import katex, { type KatexOptions } from "katex";

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
    let startX = 0, startY = 0;
    function render() {
      dom.dataset.latex = node.attrs.latex;
      const highlight = node.attrs.blockHighlight ?? node.marks.find(mark => mark.type.name === "highlight")?.attrs.color;
      dom.style.backgroundColor = highlight ?? "";
      dom.setAttribute("aria-label", `${kind === "inline" ? "Inline" : "Display"} formula: ${node.attrs.latex}`);
      dom.title = editor.isEditable ? "Click to select · Enter or double-click to edit · Delete to remove" : "";
      katex.render(node.attrs.latex, dom, {...options, displayMode: kind === "block", throwOnError: false});
    }
    dom.addEventListener("mousedown", event => {startX = event.clientX; startY = event.clientY;});
    dom.addEventListener("click", event => {
      const pos = getPos();
      if (!editor.isEditable || pos === undefined || event.shiftKey || Math.hypot(event.clientX - startX, event.clientY - startY) > 4) return;
      event.preventDefault();
      editor.chain().focus().setNodeSelection(pos).run();
    });
    dom.addEventListener("dblclick", event => {
      const pos = getPos();
      if (!editor.isEditable || pos === undefined) return;
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
