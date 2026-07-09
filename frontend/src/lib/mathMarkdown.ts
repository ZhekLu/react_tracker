type ProtectedMarkdown = {
  value: string;
  restore: (markdown: string) => string;
};

function protectMarkdownCode(value: string): ProtectedMarkdown {
  const blocks: string[] = [];
  const protectedValue = value.replace(
    /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)|`+[^`\n]*`+/g,
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

function normalizeInlineMath(value: string): string {
  return value.replace(
    /(?<!\\)\$(?!\$)([^$\n]+)(?<!\\)\$(?!\$)/g,
    (block, body: string) =>
      looksLikeLatex(body) ? `$${normalizeLatexBody(body)}$` : block,
  );
}

export function normalizeMathMarkdown(value: string): string {
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
  const bracketDisplays = restoreBracketDisplays(
    withoutExistingDisplays.replace(
      /\\\[\s*([\s\S]*?)\s*\\\]/g,
      (_block, body: string) => `$$\n${normalizeLatexBody(body)}\n$$`,
    ),
  );
  const restoredExistingDisplays = existingDisplays.reduce(
    (markdown, block, index) =>
      markdown.replace(`@@MATH_MARKDOWN_EXISTING_${index}@@`, () => block),
    bracketDisplays,
  );
  const displayBlocks: string[] = [];
  const protectedDisplays = restoredExistingDisplays.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_block, body: string) => {
      const token = `@@MATH_MARKDOWN_DISPLAY_${displayBlocks.length}@@`;
      displayBlocks.push(`$$\n${normalizeLatexBody(body)}\n$$`);
      return token;
    },
  );
  const normalizedInline = normalizeInlineMath(
    protectedDisplays.replace(
      /\\\(([^\n]*?)\\\)/g,
      (_block, body: string) => `$${normalizeLatexBody(body)}$`,
    ),
  );
  const restoredDisplays = displayBlocks.reduce(
    (markdown, block, index) =>
      markdown.replace(`@@MATH_MARKDOWN_DISPLAY_${index}@@`, () => block),
    normalizedInline,
  );
  return protectedCode.restore(restoredDisplays);
}
