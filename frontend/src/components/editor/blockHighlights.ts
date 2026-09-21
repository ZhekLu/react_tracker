import { Extension, type JSONContent } from "@tiptap/core";

const colors: Record<string, string> = {yellow: "#fff0a8", blue: "#cfe8ff", question: "#ffd7e1", todo: "#dcebc5"};
export function blockHighlightPrefix(node: JSONContent) {
  const color = Object.keys(colors).find(key => colors[key] === node.attrs?.blockHighlight);
  return color ? `<!-- note-highlight:${color} -->\n\n` : "";
}

// Markdown has no block colour syntax. A standard, ignorable HTML comment
// annotates exactly one following literal block; its Markdown/LaTeX stays intact.
export const BlockHighlights = Extension.create({
  name: "noteBlockHighlight",
  addGlobalAttributes() {
    return [{types: ["blockMath", "codeBlock"], attributes: {blockHighlight: {
      default: null,
      parseHTML: element => Object.values(colors).includes(element.getAttribute("data-block-highlight") ?? "") ? element.getAttribute("data-block-highlight") : null,
      renderHTML: attrs => attrs.blockHighlight ? {"data-block-highlight": attrs.blockHighlight, style: `background-color: ${attrs.blockHighlight}; color: #17251f`} : {},
    }}}];
  },
  markdownTokenizer: {
    name: "noteBlockHighlight", level: "block",
    start: source => source.search(/^<!-- note-highlight:(?:yellow|blue|question|todo) -->/m),
    tokenize(source, _tokens, lexer) {
      const prefix = source.match(/^<!-- note-highlight:(yellow|blue|question|todo) -->\n[ \t]*\n/);
      if (!prefix) return;
      const rest = source.slice(prefix[0].length);
      let body = rest.match(/^\$\$(?:\\.|[^$\\])+\$\$/)?.[0];
      if (!body) {
        const fence = rest.match(/^(`{3,}|~{3,})[^\n]*\n/);
        if (!fence) return;
        const close = new RegExp(`^${fence[1][0]}{${fence[1].length},}[ \\t]*(?:\\n|$)`, "m").exec(rest.slice(fence[0].length));
        if (!close) return;
        body = rest.slice(0, fence[0].length + close.index + close[0].length);
      }
      const tokens = lexer.blockTokens(body);
      if (tokens.length !== 1 || !["code", "blockMath"].includes(tokens[0].type ?? "")) return;
      return {type: "noteBlockHighlight", raw: prefix[0] + body, color: colors[prefix[1]], tokens};
    },
  },
  parseMarkdown: (token, helpers) => helpers.parseChildren(token.tokens ?? []).map(node => ({
    ...node, attrs: {...node.attrs, blockHighlight: token.color},
  })),
});
