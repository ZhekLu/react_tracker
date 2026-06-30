import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAnnotation,
  createDiscussion,
  createDiscussionMessage,
  createPromptBatch,
  fetchCourses,
  fetchCourseWorkspace,
  openResource,
  updateAnnotation,
  updateDayStatus,
  updateDiscussionStatus,
  updateExamQuestionStatus,
  updateResourceStatus,
  updateResourceProgress,
  updateTaskStatus,
  upsertNote,
} from "../api/trackerApi";
import { collectPdfAnnotations } from "../api/helperApi";
import { AppShell } from "../components/AppShell";
import { useToggl } from "../hooks/useToggl";
import { DiscussionsView } from "../features/discussions/DiscussionsView";
import { ExamsView } from "../features/exams/ExamsView";
import { NotesView } from "../features/notes/NotesView";
import { ResourcesView } from "../features/resources/ResourcesView";
import { ResourceReader } from "../features/reader/ResourceReader";
import { RoadmapView } from "../features/roadmap/RoadmapView";
import { SkillsView } from "../features/skills/SkillsView";
import {
  allQuestions,
  annotationContext,
  dayPrompt,
  dayQuestions,
  examOverview,
  meetingAgenda,
  resourceInventory,
  resourceQuestions,
  type PromptPayload,
} from "../lib/prompts";
import { normalizeDiscussionMarkdown } from "../lib/discussionText";
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

const trackerViews = new Set<TrackerView>([
  "roadmap",
  "resources",
  "skills",
  "exams",
  "notes",
  "discussions",
]);

function navigationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const rawView = params.get("view") as TrackerView | null;
  return {
    courseId: params.get("course") ?? "",
    view: rawView && trackerViews.has(rawView) ? rawView : "roadmap",
    dayId: params.get("day") ?? "",
    resourceId: params.get("resource") ?? "",
  };
}

function htmlToPlainText(value: string): string {
  const element = document.createElement("div");
  element.innerHTML = value;
  return element.textContent ?? value;
}

async function writeClipboard(text: string) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy copy path when browser focus/permissions block it.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access failed.");
}

function findTask(course: Course, taskId: string) {
  return course.days
    .flatMap((day) => day.sections)
    .flatMap((section) => section.tasks)
    .find((task) => task.id === taskId);
}

function resetWorkspaceScroll() {
  window.scrollTo({ top: 0 });
  document.querySelector<HTMLElement>(".workspaceSidebar")?.scrollTo({ top: 0 });
}

export function App() {
  const initialNavigation = useMemo(navigationFromUrl, []);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [courseId, setCourseId] = useState(initialNavigation.courseId);
  const [workspace, setWorkspace] = useState<Course | null>(null);
  const [view, setView] = useState<TrackerView>(initialNavigation.view);
  const [activeDayId, setActiveDayId] = useState(initialNavigation.dayId);
  const [focusedResourceId, setFocusedResourceId] = useState(
    initialNavigation.resourceId,
  );
  const [readerResourceId, setReaderResourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  const activeCourseId = useMemo(
    () => courseId || courses[0]?.id || "",
    [courseId, courses],
  );
  const activeDay = useMemo(
    () =>
      workspace?.days.find((day) => day.id === activeDayId) ??
      workspace?.days[0],
    [activeDayId, workspace],
  );
  const toggl = useToggl(workspace, activeDay);

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
    setActiveDayId((current) =>
      nextWorkspace.days.some((day) => day.id === current)
        ? current
        : (nextWorkspace.days[0]?.id ?? ""),
    );
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
        const requestedCourseId = navigationFromUrl().courseId;
        const nextCourseId = nextCourses.some(
          (course) => course.id === requestedCourseId,
        )
          ? requestedCourseId
          : nextCourses[0]?.id || "";
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
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("study-tracker-workspace");
    broadcastRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ courseId?: string }>) => {
      if (event.data.courseId && event.data.courseId === activeCourseId) {
        void loadWorkspace(activeCourseId);
        void loadCourses();
      }
    };
    return () => {
      channel.close();
      broadcastRef.current = null;
    };
  }, [activeCourseId, loadCourses, loadWorkspace]);

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

  useEffect(() => {
    function restoreNavigation() {
      const navigation = navigationFromUrl();
      if (navigation.courseId) setCourseId(navigation.courseId);
      setView(navigation.view);
      setActiveDayId(navigation.dayId);
      setFocusedResourceId(navigation.resourceId);
    }
    window.addEventListener("popstate", restoreNavigation);
    return () => window.removeEventListener("popstate", restoreNavigation);
  }, []);

  useEffect(() => {
    if (!workspace) return;
    const params = new URLSearchParams();
    params.set("course", workspace.id);
    params.set("view", view);
    if (view === "roadmap" && activeDayId) params.set("day", activeDayId);
    if (view === "discussions" && focusedResourceId) {
      params.set("resource", focusedResourceId);
    }
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", nextUrl);

    document.title = `${workspace.shortCode || workspace.title} · ${
      view[0].toUpperCase() + view.slice(1)
    }`;
    const favicon =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.head.appendChild(document.createElement("link"));
    favicon.rel = "icon";
    const escapedAccent = workspace.accent.replace("#", "%23");
    favicon.href =
      `data:image/svg+xml,` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" rx="16" fill="${escapedAccent}"/>` +
      `<path d="M18 19h28v7H18zm0 12h28v7H18zm0 12h18v7H18z" fill="white"/>` +
      `</svg>`;
  }, [activeDayId, focusedResourceId, view, workspace]);

  useEffect(() => {
    function handleKeyboardNavigation(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const viewShortcuts: TrackerView[] = [
        "roadmap",
        "resources",
        "skills",
        "exams",
        "notes",
        "discussions",
      ];
      if (event.altKey && /^[1-6]$/.test(event.key)) {
        event.preventDefault();
        setView(viewShortcuts[Number(event.key) - 1]);
        resetWorkspaceScroll();
        return;
      }
      if (
        view !== "roadmap" ||
        !workspace ||
        !["j", "k"].includes(event.key.toLowerCase())
      ) {
        return;
      }
      const currentIndex = Math.max(
        0,
        workspace.days.findIndex((day) => day.id === activeDayId),
      );
      const offset = event.key.toLowerCase() === "j" ? 1 : -1;
      const nextDay = workspace.days[
        Math.min(workspace.days.length - 1, Math.max(0, currentIndex + offset))
      ];
      if (nextDay) {
        event.preventDefault();
        setActiveDayId(nextDay.id);
        window.setTimeout(() => {
          document.getElementById(nextDay.id)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 0);
      }
    }
    window.addEventListener("keydown", handleKeyboardNavigation);
    return () => window.removeEventListener("keydown", handleKeyboardNavigation);
  }, [activeDayId, view, workspace]);

  async function runMutation(action: () => Promise<void>) {
    if (!workspace) return;
    setMutating(true);
    setError(null);
    setActionMessage(null);
    try {
      await action();
      await loadWorkspace(workspace.id);
      await loadCourses();
      broadcastRef.current?.postMessage({ courseId: workspace.id });
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
    setError(null);
    setActionMessage(null);
    setFocusedResourceId("");
    setReaderResourceId("");
    setActiveDayId("");
    setCourseId(nextCourseId);
    resetWorkspaceScroll();
  }

  function handleViewChange(nextView: TrackerView) {
    setError(null);
    setActionMessage(null);
    setView(nextView);
    resetWorkspaceScroll();
  }

  function handleOpenDay(dayId: string) {
    setView("roadmap");
    setActiveDayId(dayId);
    window.setTimeout(() => {
      document.getElementById(dayId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  async function handleCopy(text: string, label: string) {
    setError(null);
    try {
      await writeClipboard(text);
      setActionMessage(label);
    } catch {
      setError("Clipboard access failed. Check browser permissions.");
    }
  }

  async function handleCopyPrompt(payload: PromptPayload, label: string) {
    if (!workspace) return;
    setError(null);
    try {
      await writeClipboard(payload.markdown);
      await createPromptBatch({
        annotationIds: payload.annotationIds,
        courseId: workspace.id,
        markdown: payload.markdown,
        sourceDayId: payload.sourceDayId,
        sourceResourceId: payload.sourceResourceId,
        sourceScope: payload.sourceScope,
        sourceTaskId: payload.sourceTaskId,
        title: payload.title,
      });
      setActionMessage(label);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The prompt was copied, but its audit record could not be saved.",
      );
    }
  }

  function handleDayClosedChange(day: StudyDay, closed: boolean) {
    const requiredComplete =
      day.progress.done + day.progress.skipped >= day.progress.required;
    const status: DayStatus = closed
      ? requiredComplete
        ? "completed"
        : "closed"
      : "open";
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

  function handleResourceStatusChange(resourceId: string, status: ResourceStatus) {
    if (!workspace) return;
    const resource = workspace.resources.find((item) => item.id === resourceId);
    if (!resource) return;
    void runMutation(async () => {
      await updateResourceStatus(resource.id, status, resource.revision);
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
    const resource = workspace?.resources.find((item) => item.id === resourceId);
    const suffix = resource?.version?.localPath
      ?.split(".")
      .at(-1)
      ?.toLowerCase();
    if (
      resource &&
      suffix &&
      ["csv", "htm", "html", "json", "md", "markdown", "py", "tex", "txt"].includes(
        suffix,
      )
    ) {
      setReaderResourceId(resourceId);
      return;
    }
    await handleOpenResourceExternal(resourceId);
  }

  async function handleOpenResourceExternal(resourceId: string) {
    setError(null);
    setActionMessage(null);
    try {
      const result = await openResource(resourceId);
      setActionMessage(`Opened with ${result.application}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open resource.");
    }
  }

  function handleReaderClose(resourceId: string, progressPercent: number) {
    setReaderResourceId("");
    void runMutation(async () => {
      await updateResourceProgress(resourceId, progressPercent, {
        capturedAt: new Date().toISOString(),
      });
    });
  }

  function handleReaderAnnotation(
    resourceId: string,
    kind: Course["annotations"][number]["kind"],
    quote: string,
    sectionTitle?: string,
  ) {
    void runMutation(async () => {
      await createAnnotation({
        anchor: {
          anchorType: "text_quote",
          quote,
          sectionTitle,
        },
        kind,
        origin: "reader_selection",
        resourceId,
      });
      setActionMessage(
        kind === "question"
          ? "Selection added to Questions."
          : "Selection saved as a highlight.",
      );
    });
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

  function handleFlagQuestion(resourceId: string, label: string) {
    void runMutation(async () => {
      await createAnnotation({
        anchor: { anchorType: "resource" },
        kind: "question",
        markdown: `Question about ${label}`,
        origin: "manual",
        plainText: `Question about ${label}`,
        resourceId,
      });
      setActionMessage("Question added to Notes.");
    });
  }

  function handleCollectPdfAnnotations(resourceId: string) {
    if (!workspace) return;
    const resource = workspace.resources.find((item) => item.id === resourceId);
    const localPath = resource?.version?.localPath;
    if (!resource || !localPath) {
      setError("This resource has no local PDF path.");
      return;
    }
    void runMutation(async () => {
      const imported = await collectPdfAnnotations(localPath);
      for (const annotation of imported.annotations) {
        await createAnnotation({
          anchor: {
            anchorType: "pdf_rect",
            annotationKind: annotation.annotationKind,
            color: annotation.color,
            metadata: {
              createdAt: annotation.createdAt,
              sourceLabel: annotation.sourceLabel,
              sourcePath: annotation.sourcePath,
            },
            pageNumber: annotation.page,
            quote: annotation.quote || undefined,
            rect: annotation.rect,
            rgb: annotation.rgb,
          },
          externalId: annotation.id,
          kind: annotation.isQuestion
            ? "question"
            : annotation.quote
            ? "highlight"
            : "note",
          markdown: annotation.comment,
          origin: "pdf_import",
          plainText: annotation.comment,
          resourceId,
          sourceFingerprint: annotation.id,
        });
      }
      setActionMessage(
        `Collected ${imported.annotations.length} PDF annotations` +
          (imported.ignored_count ? `; ignored ${imported.ignored_count} unsupported marks.` : "."),
      );
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

  async function handleImportDiscussionFromClipboard(resourceId: string) {
    setError(null);
    try {
      const clipboard = await navigator.clipboard.readText();
      const markdown = normalizeDiscussionMarkdown(clipboard);
      if (!markdown) throw new Error("The clipboard does not contain discussion text.");
      await runMutation(async () => {
        if (!workspace) return;
        const discussion = await createDiscussion(workspace.id, resourceId);
        await createDiscussionMessage(discussion.id, {
          markdown,
          plainText: markdown,
          role: "assistant",
        });
      });
      setFocusedResourceId(resourceId);
      setView("discussions");
      setActionMessage("Clipboard discussion imported.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not read the clipboard discussion.",
      );
    }
  }

  function handleDiscussionStatusChange(
    discussion: Course["discussions"][number],
    status: Course["discussions"][number]["status"],
  ) {
    void runMutation(async () => {
      await updateDiscussionStatus(discussion.id, status, discussion.revision);
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

  const readerResource = workspace.resources.find(
    (resource) => resource.id === readerResourceId,
  );

  return (
    <>
      <AppShell
      activeDayId={activeDayId}
      course={workspace}
      courses={courses}
      onCourseChange={handleCourseChange}
      onCopyDayPrompt={(day) =>
        void handleCopyPrompt(dayPrompt(workspace, day), "Day prompt copied")
      }
      onCopyDayQuestions={(day) =>
        void handleCopyPrompt(
          dayQuestions(workspace, day),
          "Day questions copied",
        )
      }
      onDayClosedChange={handleDayClosedChange}
      onToggleToggl={() => void toggl.toggle()}
      toggl={{
        activeForDay: toggl.activeForDay,
        busy: toggl.busy,
        configured: toggl.status.configured,
        courseTrackedSeconds: toggl.courseTrackedSeconds,
        error: toggl.error,
        online: toggl.status.online,
        running: toggl.status.running,
        trackedSeconds: toggl.trackedSeconds,
      }}
      onViewChange={handleViewChange}
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
          onCopyInventory={() =>
            void handleCopyPrompt(
              resourceInventory(workspace),
              "Resource inventory copied",
            )
          }
          onCopyResourceQuestions={(resource) =>
            void handleCopyPrompt(
              resourceQuestions(workspace, resource),
              "Resource questions copied",
            )
          }
          onCollectPdfAnnotations={handleCollectPdfAnnotations}
          onFlagQuestion={handleFlagQuestion}
          onNoteSave={handleNoteSave}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
          onResourceStatusChange={handleResourceStatusChange}
        />
      ) : null}
      {view === "skills" ? (
        <SkillsView
          course={workspace}
          onCopy={(text, label) => void handleCopy(text, label)}
          onOpenDay={handleOpenDay}
        />
      ) : null}
      {view === "exams" ? (
        <ExamsView
          course={workspace}
          onCopyOverview={() =>
            void handleCopyPrompt(
              examOverview(workspace),
              "Exam overview copied",
            )
          }
          onFlagQuestion={handleFlagQuestion}
          onNoteSave={handleNoteSave}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
          onQuestionStatusChange={handleQuestionStatusChange}
        />
      ) : null}
      {view === "notes" ? (
        <NotesView
          course={workspace}
          onCopyAgenda={() =>
            void handleCopyPrompt(
              meetingAgenda(workspace),
              "Meeting agenda copied",
            )
          }
          onCopyQuestions={() =>
            void handleCopyPrompt(
              allQuestions(workspace),
              "Active questions copied",
            )
          }
          onCopyAnnotation={(annotation) =>
            void handleCopyPrompt(
              annotationContext(workspace, annotation),
              "Annotation context copied",
            )
          }
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
          onDiscussionStatusChange={handleDiscussionStatusChange}
          onImportClipboard={(resourceId) =>
            void handleImportDiscussionFromClipboard(resourceId)
          }
          onCopy={(text, label) => void handleCopy(text, label)}
          onFocusResource={setFocusedResourceId}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
        />
      ) : null}
      </AppShell>
      {readerResource ? (
        <ResourceReader
          accent={workspace.accent}
          onClose={(progressPercent) =>
            handleReaderClose(readerResource.id, progressPercent)
          }
          onCreateAnnotation={(kind, quote, sectionTitle) =>
            handleReaderAnnotation(
              readerResource.id,
              kind,
              quote,
              sectionTitle,
            )
          }
          onOpenExternal={() =>
            void handleOpenResourceExternal(readerResource.id)
          }
          resource={readerResource}
        />
      ) : null}
    </>
  );
}
