import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";

type Mark = NonNullable<JSONContent["marks"]>[number];
const markKey = (mark: Mark) => JSON.stringify([mark.type, mark.attrs ?? {}]);

/** Own complete inline spans, including formula atoms. Upstream closes marks
 * in schema order rather than opening order and splits runs at atoms. Both
 * produce crossed/repeated delimiters. Block rendering stays with Tiptap.
 */
export function serializeDiscussionDocument(node: JSONContent, helpers: MarkdownRendererHelpers): string {
  let prefix = "TRACKERINLINERUN";
  const original = JSON.stringify(node);
  while (original.includes(prefix)) prefix += "X";
  const runs: string[] = [];
  function protect(markdown: string) {return `${prefix}${runs.push(markdown) - 1}END`;}
  function wrap(mark: Mark, body: string): string {
    if (mark.type === "link") {
      const href = String(mark.attrs?.href ?? "").replace(/\\/g, "\\\\").replace(/[<>]/g, char => `\\${char}`);
      const title = mark.attrs?.title ? ` "${String(mark.attrs.title).replace(/["\\]/g, char => `\\${char}`)}"` : "";
      return `[${body}](<${href}>${title})`;
    }
    if (mark.type === "code") {
      const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map(match => match[0].length));
      const fence = "`".repeat(longest + 1);
      const pad = /^`|`$/.test(body) || /^ .* $/.test(body) ? " " : "";
      return `${fence}${pad}${body}${pad}${fence}`;
    }
    const delimiter = mark.type === "bold" ? "**" : mark.type === "italic" ? "*" : mark.type === "strike" ? "~~" : mark.type === "underline" ? "++"
      : mark.type === "highlight" ? ({"#cfe8ff": "^^", "#ffd7e1": "!!", "#dcebc5": "%%"}[String(mark.attrs?.color)] ?? "==") : "";
    if (!delimiter || !body.trim()) return body;
    const leading = body.match(/^\s*/)?.[0] ?? "", trailing = body.match(/\s*$/)?.[0] ?? "";
    return `${leading}${delimiter}${body.trim()}${delimiter}${trailing}`;
  }
  function inline(content: JSONContent[], inTable: boolean, literal = false): string {
    let output = "";
    for (let index = 0; index < content.length;) {
      const child = content[index];
      // Longest continuous mark goes outside shorter marks. Overlapping
      // selections split at the outer span boundary, closing inside out.
      let selected: Mark | undefined, end = index;
      for (const mark of child.marks ?? []) {
        let candidate = index + 1;
        while (candidate < content.length && content[candidate].marks?.some(next => markKey(next) === markKey(mark))) candidate++;
        // Custom highlight delimiters must wrap CommonMark emphasis when
        // lifetimes tie, so its tokenizer sees a complete emphasis span.
        if (candidate > end || (candidate === end && mark.type === "highlight")) {selected = mark; end = candidate;}
      }
      if (selected) {
        const mark = selected;
        const children = content.slice(index, end).map(next => ({...next, marks: next.marks?.filter(item => markKey(item) !== markKey(mark))}));
        output += wrap(mark, inline(children, inTable, literal || mark.type === "code"));
        index = end;
      } else {
        if (child.type === "inlineMath") {
          const latex = String(child.attrs?.latex ?? "");
          output += `$${inTable ? latex.replace(/\|/g, "\\|") : latex}$`;
        } else if (child.type === "text") {
          output += literal ? child.text ?? "" : helpers.renderChildren([{...child, marks: []}])
            .replace(/\$|==|\^\^|!!|%%|\+\+/g, value => value.split("").map(char => `\\${char}`).join(""))
            .replace(/\|/g, inTable ? "\\|" : "|");
        } else output += helpers.renderChildren([{...child, marks: []}]);
        index++;
      }
    }
    return output;
  }
  function visit(child: JSONContent, inTable = false): JSONContent {
    inTable ||= child.type === "table";
    if ((child.type === "paragraph" || child.type === "heading") && child.content?.length) {
      let rendered = inline(child.content, inTable);
      if (child.type === "heading") rendered = rendered.replace(/\n/g, " ");
      // Keep line boundaries visible to list/blockquote indentation.
      return {...child, content: [{type: "text", text: rendered.split("\n").map(protect).join("\n")}]};
    }
    return child.content && child.type !== "codeBlock" ? {...child, content: child.content.map(node => visit(node, inTable))} : child;
  }
  const serialized = helpers.renderChildren((node.content ?? []).map(node => visit(node)), "\n\n");
  return serialized.replace(new RegExp(`${prefix}(\\d+)END`, "g"), (_, index: string) => runs[Number(index)]);
}
