import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTogglStatus,
  startToggl,
  stopToggl,
  type TogglStatus,
} from "../api/trackerApi";
import { taskTimerShortName } from "../features/roadmap/taskTimer";
import type { Course, Resource, StudyDay, Task } from "../types/tracker";

const offlineStatus: TogglStatus = {
  configured: false,
  current: null,
  days: {},
  error: "",
  online: false,
  projectName: "",
  running: false,
  tasks: {},
  totals: {},
};

const DAILY_SYNC_STORAGE_KEY = "study-tracker:toggl:last-full-sync-date";

function localDateToken(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function legacyPlanId(course: Course): string {
  return course.shortCode
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
}

export function useToggl(course: Course | null, activeDay?: StudyDay) {
  const [status, setStatus] = useState<TogglStatus>(offlineStatus);
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState("");

  const refresh = useCallback(async (force = false) => {
    const nextStatus = await fetchTogglStatus(force);
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  useEffect(() => {
    const refreshScheduled = async () => {
      const today = localDateToken();
      const force = window.localStorage.getItem(DAILY_SYNC_STORAGE_KEY) !== today;
      const nextStatus = await refresh(force);
      if (
        force &&
        nextStatus.online &&
        nextStatus.configured &&
        !nextStatus.error
      ) {
        window.localStorage.setItem(DAILY_SYNC_STORAGE_KEY, today);
      }
    };
    const initial = window.setTimeout(() => void refreshScheduled(), 0);
    const interval = window.setInterval(() => void refreshScheduled(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const planId = course ? legacyPlanId(course) : "";
  const dayToken = activeDay ? `day-${String(activeDay.number).padStart(2, "0")}` : "";
  const activeForDay =
    status.running &&
    status.current?.planId === planId &&
    status.current?.dayId === dayToken;
  const trackedSeconds = useMemo(
    () => (dayToken ? status.days[planId]?.[dayToken] ?? 0 : 0),
    [dayToken, planId, status.days],
  );
  const courseTrackedSeconds = status.totals[planId] ?? 0;
  const trackedSecondsByDay = useMemo(
    () =>
      Object.fromEntries(
        (course?.days ?? []).map((day) => [
          day.id,
          status.days[planId]?.[
            `day-${String(day.number).padStart(2, "0")}`
          ] ?? 0,
        ]),
      ),
    [course?.days, planId, status.days],
  );

  async function toggle() {
    if (!course || !activeDay) return;
    setBusy(true);
    setCommandError("");
    try {
      const nextStatus = status.running
        ? await stopToggl()
        : await startToggl({
            courseId: course.id,
            dayId: activeDay.id,
            description: `[${course.shortCode}] Day ${activeDay.number}. ${
              activeDay.topic || activeDay.title
            }`,
          });
      setStatus(nextStatus);
    } catch (caught) {
      setCommandError(
        caught instanceof Error ? caught.message : "Toggl command failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(
    day: StudyDay,
    task: Task,
    resources: Resource[],
  ) {
    if (!course) return;
    setBusy(true);
    setCommandError("");
    try {
      const nextStatus =
        status.running && status.current?.taskId === task.id
          ? await stopToggl()
          : await startToggl({
              courseId: course.id,
              dayId: day.id,
              description: `[${course.shortCode}] Day ${day.number}. ${taskTimerShortName(
                task,
                resources,
              )}`,
              taskId: task.id,
            });
      setStatus(nextStatus);
    } catch (caught) {
      setCommandError(
        caught instanceof Error ? caught.message : "Toggl command failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    activeForDay,
    busy,
    courseTrackedSeconds,
    error: commandError || status.error,
    refresh,
    status,
    toggle,
    toggleTask,
    trackedSeconds,
    trackedSecondsByDay,
    trackedSecondsByTask: status.tasks,
  };
}
