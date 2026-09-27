/** Inline Markdown math must occupy one physical source line. */
export function normalizeInlineLatex(latex: string): string {
  return latex
    .trim()
    .replace(/[ \t]*\r?\n[ \t]*/g, " ");
}

function containsUnescaped(value: string, character: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== character) continue;
    let slashes = 0;
    for (let before = index - 1; before >= 0 && value[before] === "\\"; before -= 1) {
      slashes += 1;
    }
    if (slashes % 2 === 0) return true;
  }
  return false;
}

/** Explain source forms that cannot be represented losslessly inside `$…$`. */
export function inlineLatexSourceError(latex: string): string {
  if (/\n\s*\n/.test(latex)) {
    return "Remove blank lines inside this formula before using inline layout.";
  }
  if (containsUnescaped(latex, "$")) {
    return "Remove $ delimiters from the formula body before using inline layout.";
  }
  if (containsUnescaped(latex, "%")) {
    return "Remove LaTeX source comments (or escape % as \\%) before using inline layout.";
  }
  return "";
}

export function latexForFormulaLayout(
  kind: "inline" | "block",
  latex: string,
): string {
  return kind === "inline" ? normalizeInlineLatex(latex) : latex.trim();
}

/** Existing invalid source is preserved; valid multiline source is repaired. */
export function inlineLatexForMarkdown(latex: string): string {
  return inlineLatexSourceError(latex)
    ? latex.trim()
    : normalizeInlineLatex(latex);
}
