export type DiscussionExportSegment =
  | { kind: "markdown"; markdown: string }
  | { kind: "export"; markdown: string; tag: string };

const EXPORT_TAG = /<([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)>\s*([\s\S]*?)\s*<\/\1>/g;

export function discussionExportSegments(
  markdown: string,
): DiscussionExportSegment[] {
  const segments: DiscussionExportSegment[] = [];
  let cursor = 0;
  for (const match of markdown.matchAll(EXPORT_TAG)) {
    const index = match.index ?? 0;
    const before = markdown.slice(cursor, index).trim();
    if (before) segments.push({ kind: "markdown", markdown: before });
    const content = (match[2] ?? "").trim();
    if (content) {
      segments.push({ kind: "export", markdown: content, tag: match[1] });
    }
    cursor = index + match[0].length;
  }
  const after = markdown.slice(cursor).trim();
  if (after) segments.push({ kind: "markdown", markdown: after });
  return segments.length ? segments : [{ kind: "markdown", markdown }];
}
