export type ReaderCaptureKind = "note" | "question" | "todo";

export function prepareReaderCapture(
  draft: string,
  initialKind: ReaderCaptureKind,
): {
  includeScreenshot: boolean;
  kind: ReaderCaptureKind;
  markdown: string;
} {
  const rawMarkdown = draft.trim();
  const includeScreenshot = /(?:^|\s)\/screen\b/i.test(rawMarkdown);
  const markdown = rawMarkdown
    .replace(/(^|[^\S\r\n])\/screen\b/gim, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const kind = /\btodo!/i.test(markdown)
    ? "todo"
    : markdown.includes("??")
      ? "question"
      : initialKind;
  return { includeScreenshot, kind, markdown };
}
