import { CircleHelp, Clock3, Circle, CheckCircle2, type LucideIcon } from "lucide-react";
import type { TaskStatus } from "../../types/tracker";

type StatusBadgeProps = {
  status: TaskStatus;
  compact?: boolean;
};

const statusMeta: Record<TaskStatus, { icon: LucideIcon; label: string }> = {
  todo: { icon: Circle, label: "To do" },
  done: { icon: CheckCircle2, label: "Done" },
  question: { icon: CircleHelp, label: "Question" },
  later: { icon: Clock3, label: "Do later" },
};

export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  const { icon: Icon, label } = statusMeta[status];

  return (
    <span className={`statusBadge ${status}`} title={label}>
      <Icon size={13} />
      {compact ? null : <span>{label}</span>}
    </span>
  );
}
