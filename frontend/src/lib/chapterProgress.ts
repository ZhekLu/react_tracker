import type { ResourceChapterStatus } from "../types/tracker";

export function nextChapterStatus(
  status: ResourceChapterStatus,
): ResourceChapterStatus {
  if (status === "unread") return "read_partially";
  if (status === "read_partially") return "read_fully";
  return "unread";
}
