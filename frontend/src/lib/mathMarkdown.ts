function normalizeLatexBody(value: string): string {
  return value
    .replace(/\\\\(?=[A-Za-z])/g, "\\")
    .replace(/\\([_*])/g, "$1")
    .replace(/^[ \t]*={3,}[ \t]*$/gm, "=")
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, "-")
    .trim();
}

function normalizeInlineMath(value: string): string {
  return value.replace(
    /(?<!\\)\$(?!\$)([^$\n]+)(?<!\\)\$(?!\$)/g,
    (block, body: string) => {
      if (!/\\{1,2}[A-Za-z]|\\[_*]/.test(body)) return block;
      return `$${normalizeLatexBody(body)}$`;
    },
  );
}

export function normalizeMathMarkdown(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(
      /\((\\{1,2}[A-Za-z]+[^()\n]{0,160})\)/g,
      (_match, expression: string) =>
        `$${normalizeLatexBody(expression)}$`,
    )
    .replace(/\\\[[ \t]*/g, () => "\n$$\n")
    .replace(/[ \t]*\\\]/g, () => "\n$$\n")
    .replace(/^[ \t]*\[[ \t]*$/gm, () => "$$")
    .replace(/^[ \t]*\][ \t]*$/gm, () => "$$")
    .replace(/^[ \t]*\$[ \t]*$/gm, () => "$$")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$");
  const displayBlocks: string[] = [];
  const protectedDisplays = normalized.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_block, body: string) => {
      const token = `@@NORMALIZED_DISPLAY_MATH_${displayBlocks.length}@@`;
      displayBlocks.push(`$$\n${normalizeLatexBody(body)}\n$$`);
      return token;
    },
  );
  return displayBlocks.reduce(
    (markdown, block, index) =>
      markdown.replace(
        `@@NORMALIZED_DISPLAY_MATH_${index}@@`,
        () => block,
      ),
    normalizeInlineMath(protectedDisplays),
  );
}
