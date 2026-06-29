import type { TaskStatus } from "../types/tracker";

export function statusTone(status: TaskStatus): "green" | "amber" | "blue" | "muted" {
  if (status === "done") return "green";
  if (status === "later") return "blue";
  if (status === "in_progress") return "amber";
  return "muted";
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
