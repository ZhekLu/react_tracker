export function normalizeMathMarkdown(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
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
      `$$${body.replace(/^\s*===\s*$/gm, "=")}$$`,
  );
}
