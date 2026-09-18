import type { Resource, StudyDay, TaskStatus } from "../types/tracker";

export type AdminTask = {
  id: string; title: string; revision: number; status: TaskStatus;
  day_id: string; day_number: number; day_title: string;
  section_id: string | null; section_title: string | null;
  resource_ids: string[]; estimated_minutes: number | null; is_optional: boolean | number;
  deleted_at: string | null; removed_at: string | null; protected_fields: string[];
  note_count: number; running_timer: boolean;
};
export type AdminChanges = Partial<Pick<AdminTask,
  "title" | "status" | "resource_ids" | "estimated_minutes" | "is_optional">>;
export type AdminCommand = AdminChanges & {
  request_id: string; revision: number; action: "edit" | "delete" | "restore" | "release";
};
export type AdminHistory = {
  id: string; task_id: string; action: AdminCommand["action"]; created_at: string;
  before: AdminTask; after: AdminTask; backup_path: string;
};
export type AdminOverview = { plan_id: string; tasks: AdminTask[]; history: AdminHistory[] };
export type AdminResult = { task: AdminTask; backup_path: string | null; event_id: string | null };

export function adminChanges(task: AdminTask, draft: AdminChanges): AdminChanges {
  const result: AdminChanges = {};
  if (draft.title !== undefined && draft.title.trim() !== task.title) result.title = draft.title.trim();
  if (draft.status !== undefined && draft.status !== task.status) result.status = draft.status;
  if (draft.estimated_minutes !== undefined && draft.estimated_minutes !== task.estimated_minutes)
    result.estimated_minutes = draft.estimated_minutes;
  if (draft.is_optional !== undefined && Boolean(draft.is_optional) !== Boolean(task.is_optional))
    result.is_optional = Boolean(draft.is_optional);
  if (draft.resource_ids && JSON.stringify([...draft.resource_ids].sort()) !== JSON.stringify([...task.resource_ids].sort()))
    result.resource_ids = draft.resource_ids;
  return result;
}

export function adminDayContext(data: AdminOverview, dayId: string, resources: Resource[], day?: Pick<StudyDay, "id" | "number" | "title">): string {
  const tasks = data.tasks.filter(task => task.day_id === dayId && !task.deleted_at);
  const first = tasks[0];
  return JSON.stringify({
    format: "Tracker context for preparing a study-plan/v1 patch; this JSON is not a patch",
    plan_id: data.plan_id,
    day: day ? { id: day.id, number: day.number, title: day.title }
      : first && { id: first.day_id, number: first.day_number, title: first.day_title },
    tasks: tasks.map(task => ({ id: task.id, title: task.title, status: task.status,
      section_id: task.section_id, section_title: task.section_title,
      resource_ids: task.resource_ids, estimated_minutes: task.estimated_minutes,
      optional: Boolean(task.is_optional), protected_fields: task.protected_fields })),
    resources: resources.filter(r => r.kind !== "discussion").map(r => ({ id: r.id, title: r.title, kind: r.kind })),
    reminder: "Reuse these exact IDs for existing entities. New IDs create new tasks. Preserve notes. See the Plan patching reference.",
  }, null, 2);
}
