import { ListTodo } from "lucide-react";
import type { TodoCounts } from "../types/tracker";
import "./study-pass-progress.css";

export function TodoProgressBadge({ counts, compact = false }: { counts?: TodoCounts; compact?: boolean }) {
  if (!counts?.total) return null;
  return <span className={`todoProgressBadge${compact ? " taskMetaBadge" : ""}`}
    title={`${counts.done} done · ${counts.open} open · ${counts.later} later · ${counts.skipped} skipped`}>
    <ListTodo size={compact ? 11 : 14} /> To-dos <b>{counts.done}/{counts.total}</b> done
    {counts.open > 0 && <small> · {counts.open} open</small>}
    {counts.later > 0 && <small> · {counts.later} later</small>}
    {counts.skipped > 0 && <small> · {counts.skipped} skipped</small>}
  </span>;
}
