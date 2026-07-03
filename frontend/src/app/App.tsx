import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectResourcePdfAnnotations,
  createAnnotation,
  createDiscussion,
  createDiscussionMessage,
  createPromptBatch,
  deleteDiscussion,
  fetchCourses,
  fetchCourseWorkspace,
  linkDiscussionQuestion,
  openResource,
  openResourceFile,
  updateAnnotation,
  updateDayStatus,
  updateDiscussionAttention,
  updateDiscussionMessage,
  updateDiscussionStatus,
  updateExamQuestionStatus,
  updateResourceStatus,
  updateResourceProgress,
  updateTaskStatus,
  upsertNote,
} from "../api/trackerApi";
import { AppShell } from "../components/AppShell";
import type { ResourceCaptureInput } from "../components/annotations/InlineCaptureEditor";
import { useToggl } from "../hooks/useToggl";
import { DiscussionsView } from "../features/discussions/DiscussionsView";
import { ExamsView } from "../features/exams/ExamsView";
import { NotesView } from "../features/notes/NotesView";
import { ResourcesView } from "../features/resources/ResourcesView";
import { ResourceReader } from "../features/reader/ResourceReader";
import { RoadmapView } from "../features/roadmap/RoadmapView";
import { SkillsView } from "../features/skills/SkillsView";
import { QuestionDialog } from "../features/questions/QuestionDialog";
import { QuestionExtractionDialog } from "../features/questions/QuestionExtractionDialog";
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
import {
  extractedQuestionFingerprint,
  extractQuestionsFromMarkdown,
} from "../lib/questionExtraction";
import type {
  Course,
  CourseSummary,
  Attention,
  DayStatus,
  Discussion,
  DiscussionMessage,
  EntityNoteSaveInput,
  ExamQuestion,
  ExamStatus,
  DiscussionQuestionRelation,
  Note,
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
    taskId: params.get("task") ?? "",
    readerResourceId: params.get("reader") ?? "",
    readerPage: Math.max(1, Number(params.get("page") ?? "1") || 1),
  };
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
  const [focusedTaskId, setFocusedTaskId] = useState(
    initialNavigation.taskId,
  );
  const [readerResourceId, setReaderResourceId] = useState(
    initialNavigation.readerResourceId,
  );
  const [readerPage, setReaderPage] = useState(initialNavigation.readerPage);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [questionDraft, setQuestionDraft] = useState<{
    resourceId: string;
    contextLabel: string;
    initialText?: string;
    anchor?: {
      anchorType: string;
      quote?: string;
      sectionTitle?: string;
      discussionMessageId?: string;
    };
  } | null>(null);
  const [questionExtractionDraft, setQuestionExtractionDraft] = useState<{
    candidates: string[];
    contextLabel: string;
    discussionResourceId: string;
    messageId: string;
  } | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const navigationIntentRef = useRef<"push" | "replace">("replace");
  const pendingHistoryScrollRef = useRef<number | null>(null);

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
  const workspaceWithLiveTime = useMemo(
    () =>
      workspace
        ? {
            ...workspace,
            days: workspace.days.map((day) => ({
              ...day,
              trackedSeconds: Math.max(
                day.trackedSeconds,
                toggl.trackedSecondsByDay[day.id] ?? 0,
              ),
            })),
          }
        : null,
    [toggl.trackedSecondsByDay, workspace],
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
    if (!actionMessage) return;
    const timeout = window.setTimeout(() => setActionMessage(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [actionMessage]);

  useEffect(() => {
    window.history.scrollRestoration = "manual";
    function restoreNavigation(event: PopStateEvent) {
      const navigation = navigationFromUrl();
      navigationIntentRef.current = "replace";
      pendingHistoryScrollRef.current =
        typeof event.state?.scrollY === "number" ? event.state.scrollY : 0;
      if (navigation.courseId) setCourseId(navigation.courseId);
      setView(navigation.view);
      setActiveDayId(navigation.dayId);
      setFocusedResourceId(navigation.resourceId);
      setFocusedTaskId(navigation.taskId);
      setReaderResourceId(navigation.readerResourceId);
      setReaderPage(navigation.readerPage);
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
      if (focusedTaskId) params.set("task", focusedTaskId);
    }
    if (readerResourceId) {
      params.set("reader", readerResourceId);
      params.set("page", String(readerPage));
    }
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) {
      if (navigationIntentRef.current === "push") {
        window.history.replaceState(
          { ...(window.history.state ?? {}), scrollY: window.scrollY },
          "",
          currentUrl,
        );
        window.history.pushState({ scrollY: 0 }, "", nextUrl);
      } else {
        window.history.replaceState(
          { ...(window.history.state ?? {}), scrollY: window.scrollY },
          "",
          nextUrl,
        );
      }
    }
    navigationIntentRef.current = "replace";

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
  }, [
    activeDayId,
    focusedResourceId,
    focusedTaskId,
    readerPage,
    readerResourceId,
    view,
    workspace,
  ]);

  useEffect(() => {
    if (!workspace || pendingHistoryScrollRef.current === null) return;
    const scrollY = pendingHistoryScrollRef.current;
    pendingHistoryScrollRef.current = null;
    const navigation = navigationFromUrl();
    window.requestAnimationFrame(() => {
      if (navigation.view === "roadmap" && navigation.dayId) {
        document.getElementById(navigation.dayId)?.scrollIntoView({
          behavior: "auto",
          block: "start",
        });
      } else {
        window.scrollTo({ behavior: "auto", top: scrollY });
      }
    });
  }, [activeDayId, view, workspace]);

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
        navigationIntentRef.current = "push";
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
        navigationIntentRef.current = "push";
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
    navigationIntentRef.current = "push";
    setError(null);
    setActionMessage(null);
    setFocusedResourceId("");
    setFocusedTaskId("");
    setReaderResourceId("");
    setReaderPage(1);
    setActiveDayId("");
    setCourseId(nextCourseId);
    resetWorkspaceScroll();
  }

  function handleViewChange(nextView: TrackerView) {
    navigationIntentRef.current = "push";
    setError(null);
    setActionMessage(null);
    setView(nextView);
    resetWorkspaceScroll();
  }

  function handleOpenDay(dayId: string) {
    navigationIntentRef.current = "push";
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

  async function savePromptBatch(
    payload: PromptPayload,
    label: string,
  ): Promise<string | null> {
    if (!workspace) return null;
    setError(null);
    try {
      await writeClipboard(payload.markdown);
      const batch = await createPromptBatch({
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
      return batch.id;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The prompt was copied, but its audit record could not be saved.",
      );
      return null;
    }
  }

  async function handleCopyPrompt(payload: PromptPayload, label: string) {
    await savePromptBatch(payload, label);
  }

  async function handleStartDiscussion(payload: PromptPayload) {
    if (!workspace) return;
    const promptBatchId = await savePromptBatch(
      payload,
      "Prompt copied; discussion created for the response.",
    );
    if (!promptBatchId) return;
    await runMutation(async () => {
      await createDiscussion({
        courseId: workspace.id,
        initialPromptBatchId: promptBatchId,
        sourceResourceId: payload.sourceResourceId,
        title: payload.title,
      });
    });
    navigationIntentRef.current = "push";
    setFocusedResourceId(payload.sourceResourceId ?? "");
    setFocusedTaskId(payload.sourceTaskId ?? "");
    setView("discussions");
    setActionMessage("Prompt copied. Paste the tutor response into this discussion.");
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
    const markdown = normalizeDiscussionMarkdown(input.html);
    void runMutation(async () => {
      await upsertNote({
        courseId: workspace.id,
        noteId: note?.id,
        noteRevision: note?.revision,
        documentRevision: note?.document.revision,
        kind: input.kind,
        attention: note?.attention ?? "none",
        entityType: input.entityType,
        entityId: input.entityId,
        markdown,
        plainText: markdown,
      });
    });
  }

  function handleNoteAttentionChange(note: Note, attention: Attention) {
    const link =
      note.links.find((item) => item.relation === "primary") ?? note.links[0];
    if (!workspace || !link) return;
    void runMutation(async () => {
      await upsertNote({
        courseId: workspace.id,
        noteId: note.id,
        noteRevision: note.revision,
        documentRevision: note.document.revision,
        kind: note.kind,
        attention,
        entityType: link.entityType,
        entityId: link.entityId,
        markdown: note.document.markdown ?? note.document.plainText,
        plainText: note.document.plainText,
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
    const sourceResourceId = resource?.parentResourceId ?? resourceId;
    return (
      workspace.discussions.find(
        (discussion) =>
          discussion.resourceId === sourceResourceId ||
          discussion.sourceResourceIds.includes(sourceResourceId),
      )?.resourceId ?? sourceResourceId
    );
  }

  function handleOpenDiscussion(resourceId: string, taskId?: string) {
    navigationIntentRef.current = "push";
    setFocusedResourceId(resolveDiscussionResourceId(resourceId));
    setFocusedTaskId(taskId ?? "");
    setView("discussions");
  }

  function handleFocusDiscussionResource(resourceId: string) {
    navigationIntentRef.current = "push";
    setFocusedResourceId(resourceId);
    setFocusedTaskId("");
  }

  async function handleOpenResource(resourceId: string) {
    const resource = workspace?.resources.find((item) => item.id === resourceId);
    const localPath =
      resource?.version?.localPath ??
      resource?.localFiles.find((file) => file.isPrimary)?.localPath ??
      resource?.localFiles[0]?.localPath;
    const suffix = localPath
      ?.split(".")
      .at(-1)
      ?.toLowerCase();
    if (resource?.kind === "slides" && suffix === "pdf") {
      navigationIntentRef.current = "push";
      setReaderPage(1);
      setReaderResourceId(resourceId);
      return;
    }
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

  async function handleOpenResourceFile(resourceId: string, fileIndex: number) {
    setError(null);
    setActionMessage(null);
    try {
      const result = await openResourceFile(resourceId, fileIndex);
      setActionMessage(`Opened ${result.target.split("/").at(-1) ?? "file"}.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not open resource file.",
      );
    }
  }

  function handleReaderClose(resourceId: string, progressPercent: number) {
    navigationIntentRef.current = "push";
    setReaderResourceId("");
    setReaderPage(1);
    void runMutation(async () => {
      await updateResourceProgress(resourceId, progressPercent, {
        capturedAt: new Date().toISOString(),
      });
    });
  }

  function handleReaderPageAnnotation(
    resourceId: string,
    kind: "note" | "question" | "todo",
    markdown: string,
    pageNumber: number,
    sectionTitle?: string,
  ) {
    void runMutation(async () => {
      await createAnnotation({
        anchor: {
          anchorType: "pdf_page",
          pageNumber,
          sectionTitle,
          metadata: { captureSource: "lecture_reader" },
        },
        kind,
        markdown,
        origin: "lecture_reader",
        plainText: markdown,
        priority: "normal",
        resourceId,
      });
      setActionMessage(
        `${kind[0].toUpperCase()}${kind.slice(1)} saved to slide ${pageNumber}.`,
      );
    });
  }

  function handleReaderAnnotation(
    resourceId: string,
    kind: Course["annotations"][number]["kind"],
    quote: string,
    sectionTitle?: string,
  ) {
    if (kind === "question") {
      const resource = workspace?.resources.find(
        (item) => item.id === resourceId,
      );
      setQuestionDraft({
        anchor: {
          anchorType: "text_quote",
          quote,
          sectionTitle,
        },
        contextLabel: resource?.title ?? "selected passage",
        resourceId,
      });
      return;
    }
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
      setActionMessage("Selection saved as a highlight.");
    });
  }

  function handleAnnotationChange(
    annotation: Course["annotations"][number],
    changes: {
      kind?: Course["annotations"][number]["kind"];
      status?: Course["annotations"][number]["status"];
      priority?: Course["annotations"][number]["priority"];
      markdown?: string;
      plainText?: string;
      documentRevision?: number;
    },
  ) {
    void runMutation(async () => {
      await updateAnnotation(annotation.id, annotation.revision, changes);
    });
  }

  function handleFlagQuestion(
    resourceId: string,
    label: string,
    initialText?: string,
  ) {
    setQuestionDraft({
      anchor: { anchorType: "resource" },
      contextLabel: label,
      initialText,
      resourceId,
    });
  }

  function handleCreateResourceCapture(
    resourceId: string,
    input: ResourceCaptureInput,
  ) {
    void runMutation(async () => {
      await createAnnotation({
        anchor: {
          anchorType: "resource",
          color: input.color,
          metadata: { captureSource: "resource_inline" },
        },
        kind: input.kind,
        markdown: input.markdown,
        origin: "manual_resource",
        plainText: input.markdown,
        priority: input.priority,
        resourceId,
      });
      setActionMessage(
        `${input.kind[0].toUpperCase()}${input.kind.slice(1)} saved to Notes.`,
      );
    });
  }

  function handleQuestionSubmit(input: {
    markdown: string;
    priority: "low" | "normal" | "high";
  }) {
    if (!questionDraft) return;
    const draft = questionDraft;
    setQuestionDraft(null);
    void runMutation(async () => {
      await createAnnotation({
        anchor: draft.anchor,
        kind: "question",
        markdown: input.markdown,
        origin: "manual",
        plainText: input.markdown,
        priority: input.priority,
        resourceId: draft.resourceId,
      });
      setActionMessage("Question added to Notes.");
    });
  }

  function handleCollectPdfAnnotations(resourceId: string) {
    if (!workspace) return;
    const resource = workspace.resources.find((item) => item.id === resourceId);
    if (!resource) {
      setError("This resource is no longer in the active workspace.");
      return;
    }
    if (!resource.version?.localPath && !resource.version?.sourceUrl) {
      setError("This resource has no local PDF path or cloud PDF URL.");
      return;
    }
    void runMutation(async () => {
      const imported = await collectResourcePdfAnnotations(resourceId);
      const kindLabels = [
        imported.kindCounts.question
          ? `${imported.kindCounts.question} question${
              imported.kindCounts.question === 1 ? "" : "s"
            }`
          : "",
        imported.kindCounts.highlight
          ? `${imported.kindCounts.highlight} highlight${
              imported.kindCounts.highlight === 1 ? "" : "s"
            }`
          : "",
        imported.kindCounts.note
          ? `${imported.kindCounts.note} note${
              imported.kindCounts.note === 1 ? "" : "s"
            }`
          : "",
      ].filter(Boolean);
      const saved = [
        imported.createdCount
          ? `${imported.createdCount} newly saved`
          : "",
        imported.updatedCount
          ? `${imported.updatedCount} refreshed`
          : "",
        imported.existingCount
          ? `${imported.existingCount} already current`
          : "",
        imported.removedCount
          ? `${imported.removedCount} removed from the cloud source`
          : "",
      ].filter(Boolean);
      const ignored = Object.entries(imported.ignored)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(", ");
      setActionMessage(
        `Found ${imported.extractedCount} PDF capture${
          imported.extractedCount === 1 ? "" : "s"
        }${kindLabels.length ? ` (${kindLabels.join(", ")})` : ""}; ${
          saved.join(", ") || "nothing changed"
        }` +
          (imported.ignoredCount
            ? `; skipped ${imported.ignoredCount} unsupported graphical mark${
                imported.ignoredCount === 1 ? "" : "s"
              }${ignored ? ` (${ignored})` : ""}.`
            : "."),
      );
    });
  }

  function handleCreateDiscussion(resourceId: string) {
    if (!workspace) return;
    setFocusedResourceId(resourceId);
    void runMutation(async () => {
      await createDiscussion({
        courseId: workspace.id,
        sourceResourceId: resourceId,
      });
    });
  }

  function activeQuestionLinks(
    discussion: Discussion | undefined,
    fallbackResourceId: string,
  ): NonNullable<DiscussionMessageInput["annotationLinks"]> {
    if (!workspace) return [];
    const sourceIds = new Set(
      discussion?.sourceResourceIds.length
        ? discussion.sourceResourceIds
        : [fallbackResourceId],
    );
    return workspace.annotations
      .filter(
        (annotation) =>
          sourceIds.has(annotation.resourceId) &&
          ["question", "todo"].includes(annotation.kind) &&
          annotation.status !== "archived",
      )
      .map((annotation) => ({
        annotationId: annotation.id,
        relation: "references" as const,
      }));
  }

  function handleAddDiscussionMessage(
    discussionId: string,
    input: DiscussionMessageInput,
  ) {
    const discussion = workspace?.discussions.find(
      (item) => item.id === discussionId,
    );
    const markdown = normalizeDiscussionMarkdown(input.markdown);
    const automaticLinks =
      input.role === "assistant"
        ? activeQuestionLinks(
            discussion,
            discussion?.sourceResourceIds[0] ?? "",
          )
        : [];
    const annotationLinks = [
      ...(input.annotationLinks ?? []),
      ...automaticLinks.filter(
        (automatic) =>
          !(input.annotationLinks ?? []).some(
            (provided) => provided.annotationId === automatic.annotationId,
          ),
      ),
    ];
    void runMutation(async () => {
      await createDiscussionMessage(discussionId, {
        ...input,
        annotationLinks,
        markdown,
        plainText: markdown,
      });
    });
  }

  function handleUpdateDiscussionMessage(
    message: DiscussionMessage,
    markdownInput: string,
  ) {
    const markdown = normalizeDiscussionMarkdown(markdownInput);
    void runMutation(async () => {
      await updateDiscussionMessage(message.id, {
        revision: message.revision,
        documentRevision: message.body.revision,
        markdown,
        plainText: markdown,
      });
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
        const existingDiscussion = workspace.discussions.find(
          (item) =>
            item.id === resourceId ||
            item.resourceId === resourceId ||
            item.sourceResourceIds.includes(resourceId),
        );
        const discussion =
          existingDiscussion ??
          (await createDiscussion({
            courseId: workspace.id,
            sourceResourceId: resourceId,
          }));
        const annotationLinks = activeQuestionLinks(
          existingDiscussion,
          existingDiscussion?.sourceResourceIds[0] ?? resourceId,
        );
        await createDiscussionMessage(discussion.id, {
          annotationLinks,
          importedFromClipboard: true,
          linkPromptQuestions: true,
          markdown,
          plainText: markdown,
          role: "assistant",
        });
      });
      setFocusedResourceId(resourceId);
      setFocusedTaskId("");
      navigationIntentRef.current = "push";
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

  function handleDiscussionQuestionLink(
    messageId: string,
    annotationId: string,
    relation: DiscussionQuestionRelation,
  ) {
    void runMutation(async () => {
      await linkDiscussionQuestion(messageId, annotationId, relation);
    });
  }

  function handleAskDiscussionQuestion(
    discussionResourceId: string,
    messageId: string,
    messagePreview: string,
  ) {
    setQuestionDraft({
      anchor: {
        anchorType: "discussion_message",
        discussionMessageId: messageId,
        quote: messagePreview.slice(0, 1_000),
      },
      contextLabel: "tutor response",
      resourceId: discussionResourceId,
    });
  }

  function handleDiscussionStatusChange(
    discussion: Course["discussions"][number],
    status: Course["discussions"][number]["status"],
  ) {
    void runMutation(async () => {
      await updateDiscussionStatus(discussion.id, status, discussion.revision);
    });
  }

  function handleDiscussionAttentionChange(
    discussion: Discussion,
    attention: Discussion["attention"],
  ) {
    void runMutation(async () => {
      await updateDiscussionAttention(
        discussion.id,
        attention,
        discussion.revision,
      );
    });
  }

  function handleDeleteDiscussion(discussion: Discussion) {
    const fallbackResourceId = discussion.sourceResourceIds[0] ?? "";
    void (async () => {
      await runMutation(async () => {
        await deleteDiscussion(discussion.id, discussion.revision);
      });
      setFocusedResourceId(fallbackResourceId);
      setActionMessage("Discussion deleted.");
    })();
  }

  function handleExtractDiscussionQuestions(
    discussionResourceId: string,
    message: DiscussionMessage,
  ) {
    setQuestionExtractionDraft({
      candidates: extractQuestionsFromMarkdown(
        message.body.markdown || message.body.plainText,
      ),
      contextLabel: `message #${message.sequenceNumber}`,
      discussionResourceId,
      messageId: message.id,
    });
  }

  function handleQuestionExtractionSubmit(input: {
    priority: "low" | "normal" | "high";
    questions: string[];
  }) {
    if (!questionExtractionDraft) return;
    const draft = questionExtractionDraft;
    setQuestionExtractionDraft(null);
    void (async () => {
      await runMutation(async () => {
        for (const question of input.questions) {
          await createAnnotation({
            anchor: {
              anchorType: "discussion_message",
              discussionMessageId: draft.messageId,
              quote: question,
            },
            kind: "question",
            markdown: question,
            origin: "gpt_answer_extraction",
            plainText: question,
            priority: input.priority,
            resourceId: draft.discussionResourceId,
            sourceFingerprint: extractedQuestionFingerprint(
              draft.messageId,
              question,
            ),
          });
        }
      });
      setActionMessage(
        `${input.questions.length} question${input.questions.length === 1 ? "" : "s"} saved from the tutor response.`,
      );
    })();
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
      onBack={() => window.history.back()}
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
      onOpenDay={handleOpenDay}
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
        trackedSecondsByDay: toggl.trackedSecondsByDay,
      }}
      onViewChange={handleViewChange}
      view={view}
    >
      {error ? <div className="inlineError">{error}</div> : null}
      {actionMessage ? (
        <div aria-live="polite" className="actionToast" role="status">
          <span>{actionMessage}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setActionMessage(null)}
            title="Dismiss"
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      {mutating ? <div className="savingPill">Saving...</div> : null}
      {view === "roadmap" ? (
        <RoadmapView
          course={workspaceWithLiveTime ?? workspace}
          onActiveDayChange={setActiveDayId}
          onAnnotationChange={handleAnnotationChange}
          onCollectPdfAnnotations={handleCollectPdfAnnotations}
          onDayClosedChange={handleDayClosedChange}
          onDayNoteSave={handleDayNoteSave}
          onFlagQuestion={handleFlagQuestion}
          onNoteSave={handleNoteSave}
          onNoteAttentionChange={handleNoteAttentionChange}
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
          onCreateCapture={handleCreateResourceCapture}
          onAnnotationChange={handleAnnotationChange}
          onNoteSave={handleNoteSave}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
          onOpenResourceFile={(resourceId, fileIndex) =>
            void handleOpenResourceFile(resourceId, fileIndex)
          }
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
          onStartQuestionDiscussion={() =>
            void handleStartDiscussion(allQuestions(workspace))
          }
          onCopyAnnotation={(annotation) =>
            void handleCopyPrompt(
              annotationContext(workspace, annotation),
              "Annotation context copied",
            )
          }
          onAnnotationChange={handleAnnotationChange}
          onDiscussionAttentionChange={handleDiscussionAttentionChange}
          onNoteSave={handleNoteSave}
          onNoteAttentionChange={handleNoteAttentionChange}
          onOpenDiscussion={handleOpenDiscussion}
          onOpenDay={handleOpenDay}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
        />
      ) : null}
      {view === "discussions" ? (
        <DiscussionsView
          course={workspace}
          focusedResourceId={focusedResourceId}
          focusedTaskId={focusedTaskId}
          onAddMessage={handleAddDiscussionMessage}
          onUpdateMessage={handleUpdateDiscussionMessage}
          onAnnotationChange={handleAnnotationChange}
          onCreateCapture={handleCreateResourceCapture}
          onCreateDiscussion={handleCreateDiscussion}
          onDeleteDiscussion={handleDeleteDiscussion}
          onDiscussionStatusChange={handleDiscussionStatusChange}
          onDiscussionAttentionChange={handleDiscussionAttentionChange}
          onExtractQuestions={handleExtractDiscussionQuestions}
          onQuestionLink={handleDiscussionQuestionLink}
          onAskMessageQuestion={handleAskDiscussionQuestion}
          onImportClipboard={(resourceId) =>
            void handleImportDiscussionFromClipboard(resourceId)
          }
          onNoteSave={handleNoteSave}
          onCopy={(text, label) => void handleCopy(text, label)}
          onFocusResource={handleFocusDiscussionResource}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
        />
      ) : null}
      </AppShell>
      {readerResource ? (
        <ResourceReader
          accent={workspace.accent}
          initialPage={readerPage}
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
          onCreatePageAnnotation={(
            kind,
            markdown,
            pageNumber,
            sectionTitle,
          ) =>
            handleReaderPageAnnotation(
              readerResource.id,
              kind,
              markdown,
              pageNumber,
              sectionTitle,
            )
          }
          onOpenExternal={() =>
            void handleOpenResourceExternal(readerResource.id)
          }
          onPageChange={setReaderPage}
          resource={readerResource}
        />
      ) : null}
      {questionDraft ? (
        <QuestionDialog
          contextLabel={questionDraft.contextLabel}
          initialText={questionDraft.initialText}
          onClose={() => setQuestionDraft(null)}
          onSubmit={handleQuestionSubmit}
        />
      ) : null}
      {questionExtractionDraft ? (
        <QuestionExtractionDialog
          candidates={questionExtractionDraft.candidates}
          contextLabel={questionExtractionDraft.contextLabel}
          onClose={() => setQuestionExtractionDraft(null)}
          onSubmit={handleQuestionExtractionSubmit}
        />
      ) : null}
    </>
  );
}
