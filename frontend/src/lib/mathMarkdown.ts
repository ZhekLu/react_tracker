export function normalizeMathMarkdown(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/\\\[\s*/g, () => "\n$$\n")
    .replace(/\s*\\\]/g, () => "\n$$\n")
    .replace(/^\s*\[\s*$/gm, () => "$$")
    .replace(/^\s*\]\s*$/gm, () => "$$")
    .replace(/^\s*\$\s*$/gm, () => "$$")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$");
  return normalized.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_block, body: string) =>
      `$$${body.replace(/^\s*===\s*$/gm, "=")}$$`,
  );
}
