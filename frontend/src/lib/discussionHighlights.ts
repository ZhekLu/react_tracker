export type DiscussionHighlightExcerpt = {
  color: "primary" | "secondary";
  markdown: string;
};

const FENCED_CODE =
  /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const HIGHLIGHT = /(==|\^\^)([\s\S]*?)\1/g;

export function discussionHighlights(
  markdown: string,
): DiscussionHighlightExcerpt[] {
  const prose = markdown.replace(FENCED_CODE, "\n");
  return [...prose.matchAll(HIGHLIGHT)]
    .map((match) => ({
      color: match[1] === "^^" ? ("secondary" as const) : ("primary" as const),
      markdown: match[2].trim(),
    }))
    .filter((highlight) => highlight.markdown.length > 0);
}

export function discussionHighlightsMarkdown(markdown: string): string {
  return discussionHighlights(markdown)
    .map((highlight) => {
      const delimiter = highlight.color === "secondary" ? "^^" : "==";
      return `${delimiter}${highlight.markdown}${delimiter}`;
    })
    .join("\n\n");
}
