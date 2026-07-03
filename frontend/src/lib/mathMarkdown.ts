export function normalizeMathMarkdown(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(
      /\((\\{1,2}[A-Za-z]+[^()\n]{0,160})\)/g,
      (_match, expression: string) =>
        `$${expression.replace(/\\\\(?=[A-Za-z])/g, "\\")}$`,
    )
    .replace(/\\\[[ \t]*/g, () => "\n$$\n")
    .replace(/[ \t]*\\\]/g, () => "\n$$\n")
    .replace(/^[ \t]*\[[ \t]*$/gm, () => "$$")
    .replace(/^[ \t]*\][ \t]*$/gm, () => "$$")
    .replace(/^[ \t]*\$[ \t]*$/gm, () => "$$")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$");
  return normalized.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_block, body: string) =>
      `$$${body
        .replace(/^[ \t]*={3,}[ \t]*$/gm, "=")
        .replace(/^[ \t]*-{3,}[ \t]*$/gm, "-")}$$`,
  );
}
