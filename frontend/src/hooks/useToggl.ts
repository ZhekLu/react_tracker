import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const requestVersion = useRef(0);
  const commandPending = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (commandPending.current) return;
    const version = ++requestVersion.current;
    const nextStatus = await fetchTogglStatus(force);
    if (version === requestVersion.current) setStatus(nextStatus);
    return nextStatus;
  }, []);

  useEffect(() => {
    const refreshScheduled = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const initial = window.setTimeout(() => void refreshScheduled(), 0);
    const interval = window.setInterval(() => void refreshScheduled(), 60_000);
    window.addEventListener("focus", refreshScheduled);
    document.addEventListener("visibilitychange", refreshScheduled);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshScheduled);
      document.removeEventListener("visibilitychange", refreshScheduled);
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
    if (!course || !activeDay || commandPending.current) return;
    commandPending.current = true;
    requestVersion.current += 1;
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
      commandPending.current = false;
      setBusy(false);
    }
  }

  async function toggleTask(
    day: StudyDay,
    task: Task,
    resources: Resource[],
  ) {
    if (!course || commandPending.current) return;
    commandPending.current = true;
    requestVersion.current += 1;
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
      commandPending.current = false;
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
