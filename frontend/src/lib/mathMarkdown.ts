export function normalizeMathMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\\\[\s*/g, "\n$$\n")
    .replace(/\s*\\\]/g, "\n$$\n")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$");
}
