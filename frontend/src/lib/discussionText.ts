import type { Discussion } from "../types/tracker";

export function normalizeDiscussionMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\\\[\s*/g, "\n$$\n")
    .replace(/\s*\\\]/g, "\n$$\n")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$")
    .replace(/^•\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function discussionFollowups(discussion: Discussion): string {
  const items = discussion.messages.flatMap((message) =>
    message.body.plainText
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.includes("??") || line.toLowerCase().includes("todo!"),
      )
      .map((line) => ({
        line,
        role: message.role,
        sequence: message.sequenceNumber,
      })),
  );
  if (!items.length) return "";
  return [
    `# ${discussion.title} · Follow-ups`,
    "",
    ...items.map(
      (item) =>
        `- Message #${item.sequence} (${item.role}): ${item.line}`,
    ),
  ].join("\n");
}
