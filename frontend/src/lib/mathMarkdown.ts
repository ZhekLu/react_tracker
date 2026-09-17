type ProtectedMarkdown = {
  value: string;
  restore: (markdown: string) => string;
};

function protectMarkdownCode(value: string): ProtectedMarkdown {
  const blocks: string[] = [];
  const protectedValue = value.replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3(?=\n|$)|`+[^`\n]*`+/g,
    (block) => {
      const token = `@@MATH_MARKDOWN_CODE_${blocks.length}@@`;
      blocks.push(block);
      return token;
    },
  );
  return {
    value: protectedValue,
    restore: (markdown) =>
      blocks.reduce(
        (restored, block, index) =>
          restored.replace(`@@MATH_MARKDOWN_CODE_${index}@@`, () => block),
        markdown,
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

function normalizeLatexBody(value: string): string {
  return value
    .replace(/\\\\(?=[A-Za-z])/g, "\\")
    .replace(/\^\\?\*/g, "^{\\ast}")
    .replace(/\\([_*])/g, "$1")
    .replace(/\\left\{/g, "\\left\\{")
    .replace(/\\right\}/g, "\\right\\}")
    .replace(/^[ \t]*={3,}[ \t]*$/gm, "=")
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, "-")
    .trim();
}

function restoreBracketDisplays(value: string): string {
  const lines = value.split("\n");
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].trim() !== "[") {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    let closing = index + 1;
    let depth = 1;
    while (closing < lines.length && depth > 0) {
      const candidate = lines[closing].trim();
      if (candidate === "[") depth += 1;
      if (candidate === "]") depth -= 1;
      closing += 1;
    }
    if (depth !== 0) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const body = lines.slice(index + 1, closing - 1).join("\n");
    if (looksLikeDisplayMath(body)) {
      output.push("$$", normalizeLatexBody(body), "$$");
    } else {
      output.push(...lines.slice(index, closing));
    }
    index = closing;
  }
  return output.join("\n");
}

export function normalizeMathMarkdown(value: string, options: { repairLegacy?: boolean } = {}): string {
  const protectedCode = protectMarkdownCode(value.replace(/\r\n?/g, "\n"));
  const existingDisplays: string[] = [];
  const withoutExistingDisplays = protectedCode.value.replace(
    /\$\$[\s\S]*?\$\$/g,
    (block) => {
      const token = `@@MATH_MARKDOWN_EXISTING_${existingDisplays.length}@@`;
      existingDisplays.push(block);
      return token;
    },
  );
  const explicitDisplays = withoutExistingDisplays
    .replace(
      /^([ \t]*)\\\[[ \t]*\n([\s\S]*?)\n[ \t]*\\\][ \t]*(?=\n|$)/gm,
      (_block, indent: string, body: string) => `${indent}$$\n${body}\n${indent}$$`,
    )
    .replace(
      /\\\[\s*([\s\S]*?)\s*\\\]/g,
      (_block, body: string) => `$$\n${body.trim()}\n$$`,
    );
  const bracketDisplays = options.repairLegacy === false
    ? explicitDisplays
    : restoreBracketDisplays(explicitDisplays);
  const restoredExistingDisplays = existingDisplays.reduce(
    (markdown, block, index) =>
      markdown.replace(`@@MATH_MARKDOWN_EXISTING_${index}@@`, () => block),
    bracketDisplays,
  );
  // Existing $/$$ formulas are source text. Reformatting them here strips
  // list indentation and can change valid LaTeX row separators.
  const displayBlocks: string[] = [];
  const protectedDisplays = restoredExistingDisplays.replace(
    /\$\$[\s\S]*?\$\$/g,
    (block) => {
      const token = `@@MATH_MARKDOWN_DISPLAY_${displayBlocks.length}@@`;
      displayBlocks.push(block);
      return token;
    },
  );
  const normalizedInline = protectedDisplays.replace(
    /\\\(([^\n]*?)\\\)/g,
    (_block, body: string) => `$${body.trim()}$`,
  );
  const restoredDisplays = displayBlocks.reduce(
    (markdown, block, index) =>
      markdown.replace(`@@MATH_MARKDOWN_DISPLAY_${index}@@`, () => block),
    normalizedInline,
  );
  return protectedCode.restore(restoredDisplays);
}
