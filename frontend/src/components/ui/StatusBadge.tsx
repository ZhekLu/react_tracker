import { CheckCircle2, Circle, CircleDashed, Clock3, type LucideIcon } from "lucide-react";
import type { ExamStatus, ResourceStatus, TaskStatus } from "../../types/tracker";

type StatusValue = TaskStatus | ResourceStatus | ExamStatus | "question";

type StatusBadgeProps = {
  status: StatusValue;
  compact?: boolean;
};

const statusMeta: Record<StatusValue, { icon: LucideIcon; label: string }> = {
  todo: { icon: Circle, label: "To do" },
  in_progress: { icon: CircleDashed, label: "In progress" },
  done: { icon: CheckCircle2, label: "Done" },
  question: { icon: CircleDashed, label: "Question" },
  later: { icon: Clock3, label: "Do later" },
  skipped: { icon: Circle, label: "Skipped" },
  unread: { icon: Circle, label: "Unread" },
  skimmed: { icon: CircleDashed, label: "Skimmed" },
  reading: { icon: CircleDashed, label: "Reading" },
  read: { icon: CheckCircle2, label: "Read" },
  review: { icon: CheckCircle2, label: "Review" },
  archived: { icon: Circle, label: "Archived" },
  unsolved: { icon: Circle, label: "Unsolved" },
  attempted: { icon: CircleDashed, label: "Attempted" },
  solved: { icon: CheckCircle2, label: "Solved" },
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
