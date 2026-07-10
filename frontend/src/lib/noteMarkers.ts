const FENCED_CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
const ALREADY_HIGHLIGHTED = /^\s*(==|\^\^|!!|%%)[\s\S]*\1\s*$/;

function markParagraph(paragraph: string): string {
  if (ALREADY_HIGHLIGHTED.test(paragraph)) return paragraph;
  const delimiter = /\btodo!/i.test(paragraph)
    ? "%%"
    : paragraph.includes("??")
      ? "!!"
      : "";
  if (!delimiter) return paragraph;
  return `${delimiter}${paragraph.trim()}${delimiter}`;
}

export function highlightNoteMarkers(markdown: string): string {
  return markdown
    .split(FENCED_CODE)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment
        .split(/(\n\s*\n)/)
        .map((paragraph) =>
          /^\n\s*\n$/.test(paragraph) ? paragraph : markParagraph(paragraph),
        )
        .join("");
    })
    .join("");
}
