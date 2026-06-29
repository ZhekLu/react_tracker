import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDiscussion,
  createDiscussionMessage,
  fetchCourses,
  fetchCourseWorkspace,
  openResource,
  updateAnnotation,
  updateDayStatus,
  updateExamQuestionStatus,
  updateResourceStatus,
  updateTaskStatus,
  upsertNote,
} from "../api/trackerApi";
import { AppShell } from "../components/AppShell";
import { DiscussionsView } from "../features/discussions/DiscussionsView";
import { ExamsView } from "../features/exams/ExamsView";
import { NotesView } from "../features/notes/NotesView";
import { ResourcesView } from "../features/resources/ResourcesView";
import { RoadmapView } from "../features/roadmap/RoadmapView";
import type {
  Course,
  CourseSummary,
  DayStatus,
  EntityNoteSaveInput,
  ExamQuestion,
  ExamStatus,
  ResourceStatus,
  StudyDay,
  TaskStatus,
  TrackerView,
} from "../types/tracker";
import type { DiscussionMessageInput } from "../api/trackerApi";

function htmlToPlainText(value: string): string {
  const element = document.createElement("div");
  element.innerHTML = value;
  return element.textContent ?? value;
}

function findTask(course: Course, taskId: string) {
  return course.days
    .flatMap((day) => day.sections)
    .flatMap((section) => section.tasks)
    .find((task) => task.id === taskId);
}

export function App() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [courseId, setCourseId] = useState("");
  const [workspace, setWorkspace] = useState<Course | null>(null);
  const [view, setView] = useState<TrackerView>("roadmap");
  const [activeDayId, setActiveDayId] = useState("");
  const [focusedResourceId, setFocusedResourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  const activeCourseId = useMemo(
    () => courseId || courses[0]?.id || "",
    [courseId, courses],
  );

  const loadCourses = useCallback(async () => {
    const nextCourses = await fetchCourses();
    setCourses(nextCourses);
    if (!courseId && nextCourses[0]) {
      setCourseId(nextCourses[0].id);
    }
  }, [courseId]);

  const loadWorkspace = useCallback(async (nextCourseId: string) => {
    if (!nextCourseId) return;
    const nextWorkspace = await fetchCourseWorkspace(nextCourseId);
    setWorkspace(nextWorkspace);
    setActiveDayId(nextWorkspace.days[0]?.id ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      setError(null);
      try {
        const nextCourses = await fetchCourses();
        if (cancelled) return;
        setCourses(nextCourses);
        const nextCourseId = nextCourses[0]?.id || "";
        setCourseId(nextCourseId);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Cannot load tracker data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeCourseId) return;
    let cancelled = false;
    async function refreshForCourse() {
      setLoading(true);
      setError(null);
      try {
        const nextWorkspace = await fetchCourseWorkspace(activeCourseId);
        if (!cancelled) {
          setWorkspace(nextWorkspace);
          setActiveDayId((current) =>
            nextWorkspace.days.some((day) => day.id === current)
              ? current
              : (nextWorkspace.days[0]?.id ?? ""),
          );
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Cannot load course.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void refreshForCourse();
    return () => {
      cancelled = true;
    };
  }, [activeCourseId]);

  async function runMutation(action: () => Promise<void>) {
    if (!workspace) return;
    setMutating(true);
    setError(null);
    setActionMessage(null);
    try {
      await action();
      await loadWorkspace(workspace.id);
      await loadCourses();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tracker update failed.");
    } finally {
      setMutating(false);
    }
  }

  function handleTaskStatusChange(_dayId: string, taskId: string, status: TaskStatus) {
    if (!workspace) return;
    const task = findTask(workspace, taskId);
    if (!task) return;
    void runMutation(async () => {
      await updateTaskStatus(task.id, status, task.revision);
    });
  }

  function handleCourseChange(nextCourseId: string) {
    setFocusedResourceId("");
    setCourseId(nextCourseId);
  }

  function handleDayClosedChange(day: StudyDay, closed: boolean) {
    const status: DayStatus = closed ? "closed" : "open";
    void runMutation(async () => {
      await updateDayStatus(day.id, status, day.revision);
    });
  }

  function handleDayNoteSave(day: StudyDay, noteHtml: string) {
    handleNoteSave({
      entityId: day.id,
      entityType: "day",
      html: noteHtml,
      kind: "day",
      note: day.notes[0],
    });
  }

  function handleNoteSave(input: EntityNoteSaveInput) {
    if (!workspace) return;
    const note = input.note;
    void runMutation(async () => {
      await upsertNote({
        courseId: workspace.id,
        noteId: note?.id,
        noteRevision: note?.revision,
        documentRevision: note?.document.revision,
        kind: input.kind,
        entityType: input.entityType,
        entityId: input.entityId,
        markdown: input.html,
        plainText: htmlToPlainText(input.html),
      });
    });
  }

  function handleResourceReadToggle(resourceId: string) {
    if (!workspace) return;
    const resource = workspace.resources.find((item) => item.id === resourceId);
    if (!resource) return;
    const nextStatus: ResourceStatus =
      resource.status === "read" || resource.status === "review" ? "unread" : "read";
    void runMutation(async () => {
      await updateResourceStatus(resource.id, nextStatus, resource.revision);
    });
  }

  function handleQuestionStatusChange(
    _examId: string,
    question: ExamQuestion,
    status: ExamStatus,
  ) {
    void runMutation(async () => {
      await updateExamQuestionStatus(question.id, status, question.revision);
    });
  }

  function resolveDiscussionResourceId(resourceId: string): string {
    if (!workspace) return resourceId;
    const resource = workspace.resources.find((item) => item.id === resourceId);
    return resource?.parentResourceId ?? resourceId;
  }

  function handleOpenDiscussion(resourceId: string) {
    setFocusedResourceId(resolveDiscussionResourceId(resourceId));
    setView("discussions");
  }

  async function handleOpenResource(resourceId: string) {
    setError(null);
    setActionMessage(null);
    try {
      const result = await openResource(resourceId);
      setActionMessage(`Opened with ${result.application}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open resource.");
    }
  }

  function handleAnnotationChange(
    annotation: Course["annotations"][number],
    changes: {
      kind?: Course["annotations"][number]["kind"];
      status?: Course["annotations"][number]["status"];
    },
  ) {
    void runMutation(async () => {
      await updateAnnotation(annotation.id, annotation.revision, changes);
    });
  }

  function handleCreateDiscussion(resourceId: string) {
    if (!workspace) return;
    setFocusedResourceId(resourceId);
    void runMutation(async () => {
      await createDiscussion(workspace.id, resourceId);
    });
  }

  function handleAddDiscussionMessage(
    discussionId: string,
    input: DiscussionMessageInput,
  ) {
    void runMutation(async () => {
      await createDiscussionMessage(discussionId, input);
    });
  }

  if (loading && !workspace) {
    return <div className="bootPanel">Loading tracker...</div>;
  }

  if (!workspace) {
    return (
      <div className="bootPanel">
        <h1>Study Tracker</h1>
        <p>{error ?? "No course data is available yet."}</p>
      </div>
    );
  }

  return (
    <AppShell
      activeDayId={activeDayId}
      course={workspace}
      courses={courses}
      onCourseChange={handleCourseChange}
      onViewChange={setView}
      view={view}
    >
      {error ? <div className="inlineError">{error}</div> : null}
      {actionMessage ? <div className="actionToast">{actionMessage}</div> : null}
      {mutating ? <div className="savingPill">Saving...</div> : null}
      {view === "roadmap" ? (
        <RoadmapView
          course={workspace}
          onActiveDayChange={setActiveDayId}
          onDayClosedChange={handleDayClosedChange}
          onDayNoteSave={handleDayNoteSave}
          onNoteSave={handleNoteSave}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
          onTaskStatusChange={handleTaskStatusChange}
        />
      ) : null}
      {view === "resources" ? (
        <ResourcesView
          course={workspace}
          onNoteSave={handleNoteSave}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
          onResourceReadToggle={handleResourceReadToggle}
        />
      ) : null}
      {view === "exams" ? (
        <ExamsView
          course={workspace}
          onNoteSave={handleNoteSave}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
          onQuestionStatusChange={handleQuestionStatusChange}
        />
      ) : null}
      {view === "notes" ? (
        <NotesView
          course={workspace}
          onAnnotationChange={handleAnnotationChange}
          onNoteSave={handleNoteSave}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
        />
      ) : null}
      {view === "discussions" ? (
        <DiscussionsView
          course={workspace}
          focusedResourceId={focusedResourceId}
          onAddMessage={handleAddDiscussionMessage}
          onCreateDiscussion={handleCreateDiscussion}
          onFocusResource={setFocusedResourceId}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
        />
      ) : null}
    </AppShell>
  );
}
