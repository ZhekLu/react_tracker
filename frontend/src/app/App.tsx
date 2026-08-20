import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collectResourcePdfAnnotations,
  createAnnotation,
  createDiscussion,
  createDiscussionMessage,
  createPromptBatch,
  deleteNote,
  deleteDiscussionAnswer,
  deleteDiscussionMessage,
  deleteDiscussion,
  fetchCourses,
  fetchCourseWorkspace,
  importMaccyImageQuestions,
  linkDiscussionQuestion,
  openResource,
  openResourceFile,
  pdfReaderPageUrl,
  prepareExerciseScreenshots,
  previewPromptBatch,
  reviewDiscussionMessage,
  reviewDiscussionQa,
  saveDrawboardColorRoles,
  updateAnnotation,
  updateDayStatus,
  updateDiscussionAttention,
  updateDiscussionMessage,
  updateDiscussionStatus,
  updateExamQuestionStatus,
  updateResourceStatus,
  updateResourceProgress,
  updateResourceChapterProgress,
  updateTaskStatus,
  uploadImageQuestions,
  upsertNote,
} from "../api/trackerApi";
import { withQuestionAnswerReferences } from "../lib/questionAnswerReferences";
import { AppShell } from "../components/AppShell";
import type { ResourceCaptureInput } from "../components/annotations/InlineCaptureEditor";
import type { DiscussionReviewItem } from "../components/editor/DiscussionMarkdownSurface";
import { useToggl } from "../hooks/useToggl";
import { DiscussionsView } from "../features/discussions/DiscussionsView";
import { ExamsView } from "../features/exams/ExamsView";
import { NotesView } from "../features/notes/NotesView";
import { ResourcesView } from "../features/resources/ResourcesView";
import { DrawboardColorPaletteDialog } from "../features/resources/DrawboardColorPaletteDialog";
import { PdfImportOverviewDialog } from "../features/resources/PdfImportOverviewDialog";
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
  taskQuestions,
  taskScopedAnnotations,
  type PromptPayload,
} from "../lib/prompts";
import { normalizeDiscussionMarkdown } from "../lib/discussionText";
import { importPastedMarkdown } from "../lib/discussionImport";
import { responseQuestionIds } from "../lib/discussionQa";
import {
  parseExerciseProgress,
  serializeExerciseProgress,
} from "../lib/exerciseProgress";
import {
  exerciseNumbersInText,
  serializeExerciseReviewProgress,
  type ExerciseReviewProgress,
} from "../lib/exerciseReview";
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
  ExerciseSolutionMappingInput,
  ImportantAnswerInput,
  Note,
  ResourceStatus,
  ResourceChapterStatus,
  StudyDay,
  Task,
  TaskStatus,
  TrackerView,
} from "../types/tracker";
import type { DiscussionMessageInput } from "../api/trackerApi";
import type {
  DrawboardColorPaletteEntry,
  DrawboardColorRole,
  PdfAnnotationCollectionResult,
  PdfAnnotationCollectionItem,
} from "../api/trackerApi";

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

function truncatePromptQuestions(markdown: string, limit: number): string {
  const headings = [...markdown.matchAll(/^###\s+Q-\d{3}\b/gm)];
  const cutoff = headings[limit]?.index;
  if (cutoff === undefined) return markdown;
  return `${markdown.slice(0, cutoff).trim()}\n\n> Attachment limit: only the first ${limit} questions are included in this tutor round.\n`;
}

function resetWorkspaceScroll() {
  window.scrollTo({ top: 0 });
  document.querySelector<HTMLElement>(".workspaceSidebar")?.scrollTo({ top: 0 });
}

function pdfAnnotationCollectionMessage(imported: PdfAnnotationCollectionResult) {
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
    imported.createdCount ? `${imported.createdCount} newly saved` : "",
    imported.updatedCount ? `${imported.updatedCount} refreshed` : "",
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
  return (
    `Found ${imported.extractedCount} PDF capture${
      imported.extractedCount === 1 ? "" : "s"
    }${kindLabels.length ? ` (${kindLabels.join(", ")})` : ""}; ${
      saved.join(", ") || "nothing changed"
    }` +
    (imported.ignoredCount
      ? `; skipped ${imported.ignoredCount} unsupported graphical mark${
          imported.ignoredCount === 1 ? "" : "s"
        }${ignored ? ` (${ignored})` : ""}.`
      : ".")
  );
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
  const [promptProgress, setPromptProgress] = useState<{
    progress: number;
    stage: string;
  } | null>(null);
  const [taskQaLaunch, setTaskQaLaunch] = useState<{
    discussionId: string;
    label: string;
    questionIds: string[];
    token: number;
  } | null>(null);
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
      metadata?: Record<string, unknown>;
    };
  } | null>(null);
  const [questionExtractionDraft, setQuestionExtractionDraft] = useState<{
    candidates: string[];
    contextLabel: string;
    discussionResourceId: string;
    messageId: string;
  } | null>(null);
  const [drawboardPaletteDraft, setDrawboardPaletteDraft] = useState<{
    resourceId: string;
    resourceTitle: string;
    sourceDayId?: string;
    entries: DrawboardColorPaletteEntry[];
  } | null>(null);
  const [pdfImportOverview, setPdfImportOverview] = useState<{
    items: PdfAnnotationCollectionItem[];
    resourceTitle: string;
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
              trackedSeconds:
                toggl.status.online &&
                toggl.status.configured &&
                (!toggl.status.error || Object.keys(toggl.status.days).length > 0)
                  ? toggl.trackedSecondsByDay[day.id] ?? 0
                  : day.trackedSeconds,
            })),
          }
        : null,
    [
      toggl.status.configured,
      toggl.status.days,
      toggl.status.error,
      toggl.status.online,
      toggl.trackedSecondsByDay,
      workspace,
    ],
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
    const nextWorkspace = withQuestionAnswerReferences(
      await fetchCourseWorkspace(nextCourseId),
    );
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
        const nextWorkspace = withQuestionAnswerReferences(
          await fetchCourseWorkspace(activeCourseId),
        );
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

  async function runMutation(
    action: () => Promise<void>,
    options: { preserveScroll?: boolean } = {},
  ) {
    if (!workspace) return;
    const preservedScrollY = options.preserveScroll ? window.scrollY : null;
    setMutating(true);
    setError(null);
    setActionMessage(null);
    try {
      await action();
      await loadWorkspace(workspace.id);
      await loadCourses();
      broadcastRef.current?.postMessage({ courseId: workspace.id });
      if (preservedScrollY !== null) {
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() =>
            window.scrollTo({ behavior: "auto", top: preservedScrollY }),
          ),
        );
      }
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
    setActionMessage(null);
    setPromptProgress({
      progress: 0,
      stage: "Starting prompt preparation",
    });

    const sourceAnnotationIds = payload.annotationIds ?? [];
    let attachmentPreview: Awaited<ReturnType<typeof previewPromptBatch>> | null = null;
    if (sourceAnnotationIds.length > 20) {
      try {
        attachmentPreview = await previewPromptBatch({
          annotationIds: sourceAnnotationIds,
          courseId: workspace.id,
          markdown: payload.markdown,
          sourceDayId: payload.sourceDayId,
          sourceResourceId: payload.sourceResourceId,
          sourceScope: payload.sourceScope,
          sourceTaskId: payload.sourceTaskId,
          parentDiscussionId: payload.parentDiscussionId,
          questionLabelStart: payload.questionLabelStart,
          questionLabels: payload.questionLabels,
          title: payload.title,
        });
      } catch {
        // Prompt preparation still works if the lightweight count preview fails.
      }
    }
    const previewSummary = attachmentPreview
      ? ` The full package contains ${attachmentPreview.attachmentCount} attachment file${attachmentPreview.attachmentCount === 1 ? "" : "s"} (${attachmentPreview.resourceFileCount} source, ${attachmentPreview.questionImageCount} question image${attachmentPreview.questionImageCount === 1 ? "" : "s"}).`
      : "";
    const limitQuestions =
      sourceAnnotationIds.length > 20 &&
      window.confirm(
        `${sourceAnnotationIds.length} question items are ready.${previewSummary}\n\nPress OK to prepare the first 20 questions, or Cancel to keep every question.`,
      );
    const annotationIds = limitQuestions
      ? sourceAnnotationIds.slice(0, 20)
      : sourceAnnotationIds;
    const markdown = limitQuestions
      ? truncatePromptQuestions(payload.markdown, 20)
      : payload.markdown;

    let batch: Awaited<ReturnType<typeof createPromptBatch>>;
    try {
      batch = await createPromptBatch({
        annotationIds,
        attachmentLimit: limitQuestions ? 20 : undefined,
        courseId: workspace.id,
        markdown,
        sourceDayId: payload.sourceDayId,
        sourceResourceId: payload.sourceResourceId,
        sourceScope: payload.sourceScope,
        sourceTaskId: payload.sourceTaskId,
        parentDiscussionId: payload.parentDiscussionId,
        questionLabelStart: payload.questionLabelStart,
        questionLabels: payload.questionLabels,
        title: payload.title,
      }, setPromptProgress);
    } catch (caught) {
      setPromptProgress(null);
      try {
        await writeClipboard(payload.markdown);
        setActionMessage(`${label} No attachment folder was prepared.`);
      } catch {
        setError("Clipboard access failed. Check browser permissions.");
        return null;
      }
      setError(
        caught instanceof Error
          ? `Prompt copied without attachments: ${caught.message}`
          : "Prompt copied without attachments because the prompt batch could not be prepared.",
      );
      return null;
    }

    try {
      await writeClipboard(batch.markdown);
    } catch {
      setPromptProgress(null);
      setError(
        "The prompt batch and attachment folder were prepared, but clipboard access failed. Check browser permissions and copy the prompt again.",
      );
      return null;
    }

    const attachmentCount = batch.attachments.filter(
      (attachment) => attachment.kind !== "manifest",
    ).length;
    const attachmentMessage = attachmentCount
      ? ` ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} ready in ${batch.attachmentDirectory}.`
      : " No extra files were needed for this prompt.";
    const questionMessage = sourceAnnotationIds.length
      ? ` ${annotationIds.length}/${sourceAnnotationIds.length} question item${sourceAnnotationIds.length === 1 ? "" : "s"} included.`
      : "";
    const warningMessage = batch.warnings.length
      ? ` ${batch.warnings.length} file warning${batch.warnings.length === 1 ? "" : "s"}.`
      : "";
    setPromptProgress(null);
    setActionMessage(`${label}${questionMessage}${attachmentMessage}${warningMessage}`);
    return batch.id;
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
    let discussionId = "";
    await runMutation(async () => {
      const created = await createDiscussion({
        courseId: workspace.id,
        initialPromptBatchId: promptBatchId,
        sourceResourceId: payload.sourceResourceId,
        title: payload.title,
      });
      discussionId = created.id;
    });
    if (!discussionId) return;
    navigationIntentRef.current = "push";
    setFocusedResourceId(discussionId);
    setFocusedTaskId(payload.sourceTaskId ?? "");
    setView("discussions");
    setActionMessage("Prompt copied. Paste the tutor response into this discussion.");
  }

  function discussionForTaskQuestions(
    day: StudyDay,
    questionIds: string[],
  ): Discussion | undefined {
    if (!workspace) return undefined;
    const questionIdSet = new Set(questionIds);
    return [...workspace.discussions]
      .filter((discussion) => discussion.status !== "archived")
      .sort((left, right) => {
        const score = (discussion: Discussion) => {
          const promptMatches = discussion.questionIds.filter((id) =>
            questionIdSet.has(id),
          ).length;
          const answerMatches = discussion.messages.flatMap((message) =>
            message.annotationLinks,
          ).filter((link) => questionIdSet.has(link.annotationId)).length;
          const dayMatch = new RegExp(`\\bDay\\s+${day.number}\\b`, "i").test(
            discussion.title,
          );
          return promptMatches * 10 + answerMatches * 20 + (dayMatch ? 1 : 0);
        };
        return score(right) - score(left);
      })
      .find((discussion) => {
        const linked = discussion.questionIds.some((id) => questionIdSet.has(id)) ||
          discussion.messages.some((message) =>
            message.annotationLinks.some((link) => questionIdSet.has(link.annotationId)),
          );
        return linked || new RegExp(`\\bDay\\s+${day.number}\\b`, "i").test(
          discussion.title,
        );
      });
  }

  async function handleCopyNextTaskQuestions(dayId: string, task: Task) {
    if (!workspace) return;
    const day = workspace.days.find((candidate) => candidate.id === dayId);
    if (!day) return;
    const scopedAnnotations = taskScopedAnnotations(workspace, day, task);
    const discussion = discussionForTaskQuestions(
      day,
      scopedAnnotations.map((annotation) => annotation.id),
    );
    if (!discussion) {
      setError("Create the day discussion first, then copy this task's next questions into it.");
      return;
    }
    const nextQuestions = scopedAnnotations.filter(
      (annotation) =>
        ["question", "todo"].includes(annotation.kind) &&
        annotation.status === "open" &&
        !annotation.postponed &&
        (annotation.discussionResponseCount ?? 0) === 0,
    );
    if (!nextQuestions.length) {
      setActionMessage("This task has no open question without a mapped tutor response.");
      return;
    }
    const existingLabelByQuestionId = new Map(
      discussion.questionLabels.flatMap((item) =>
        item.annotationIds.map((annotationId) => [annotationId, item.label] as const),
      ),
    );
    let nextLabelNumber = Math.max(
      0,
      ...discussion.questionLabels.flatMap((item) => {
        const match = item.label.match(/^Q-(\d+)$/i);
        return match ? [Number(match[1])] : [];
      }),
    ) + 1;
    const questionLabels = Object.fromEntries(
      nextQuestions.map((annotation) => {
        const existing = existingLabelByQuestionId.get(annotation.id);
        if (existing) return [annotation.id, existing];
        const label = `Q-${String(nextLabelNumber).padStart(3, "0")}`;
        nextLabelNumber += 1;
        return [annotation.id, label];
      }),
    );
    const labelStart = Math.min(
      ...Object.values(questionLabels).map((label) =>
        Number(label.match(/^Q-(\d+)$/i)?.[1] ?? 1),
      ),
    );
    const payload = taskQuestions(workspace, day, task, {
      annotationIds: nextQuestions.map((annotation) => annotation.id),
      parentDiscussionId: discussion.id,
      questionLabelStart: labelStart,
      questionLabels,
      unansweredOnly: true,
    });
    const promptBatchId = await savePromptBatch(
      payload,
      `Next ${nextQuestions.length} task question${nextQuestions.length === 1 ? "" : "s"} copied into “${discussion.title}”.`,
    );
    if (promptBatchId) await loadWorkspace(workspace.id);
  }

  function handleOpenTaskQa(dayId: string, task: Task) {
    if (!workspace) return;
    const day = workspace.days.find((candidate) => candidate.id === dayId);
    if (!day) return;
    const questionIds = taskScopedAnnotations(workspace, day, task)
      .filter(
        (annotation) =>
          ["question", "todo"].includes(annotation.kind) &&
          annotation.status !== "archived" &&
          (annotation.discussionResponseCount ?? 0) > 0,
      )
      .map((annotation) => annotation.id);
    const discussion = discussionForTaskQuestions(day, questionIds);
    if (!discussion || !questionIds.length) {
      setActionMessage("No tutor answers are mapped to this task yet.");
      return;
    }
    navigationIntentRef.current = "push";
    setFocusedResourceId(discussion.id);
    setFocusedTaskId(task.id);
    setTaskQaLaunch({
      discussionId: discussion.id,
      label: `Day ${day.number} · ${task.title}`,
      questionIds,
      token: Date.now(),
    });
    setView("discussions");
    resetWorkspaceScroll();
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

  function handleNoteDelete(note: Note) {
    void runMutation(async () => {
      await deleteNote(note.id, note.revision);
      setActionMessage("The tutor answer was unlinked from this exercise task.");
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

  function handleResourceChapterProgressChange(
    resource: Course["resources"][number],
    chapter: Course["resources"][number]["chapters"][number],
    status: ResourceChapterStatus,
  ) {
    void runMutation(
      async () => {
        await updateResourceChapterProgress(
          resource.id,
          chapter.number,
          status,
          chapter.revision,
        );
      },
      { preserveScroll: true },
    );
  }

  function handleExerciseProgressChange(
    resource: Course["resources"][number],
    exercise: string,
    status: ResourceChapterStatus,
  ) {
    if (!workspace) return;
    const note = resource.notes.find((item) => item.kind === "exercise_progress");
    const markdown = serializeExerciseProgress({
      ...parseExerciseProgress(note),
      [exercise]: status,
    });
    void runMutation(
      async () => {
        await upsertNote({
          courseId: workspace.id,
          noteId: note?.id,
          noteRevision: note?.revision,
          documentRevision: note?.document.revision,
          entityId: resource.id,
          entityType: "resource",
          kind: "exercise_progress",
          markdown,
          plainText: markdown,
        });
      },
      { preserveScroll: true },
    );
  }

  function handleExerciseReviewChange(
    task: Course["days"][number]["sections"][number]["tasks"][number],
    progress: ExerciseReviewProgress,
  ) {
    if (!workspace) return;
    const note = task.notes.find((item) => item.kind === "exercise_review");
    const markdown = serializeExerciseReviewProgress(progress);
    void runMutation(
      async () => {
        await upsertNote({
          courseId: workspace.id,
          noteId: note?.id,
          noteRevision: note?.revision,
          documentRevision: note?.document.revision,
          entityId: task.id,
          entityType: "task",
          kind: "exercise_review",
          markdown,
          plainText: markdown,
        });
      },
      { preserveScroll: true },
    );
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
    includeScreenshot = false,
  ) {
    void runMutation(async () => {
      await createAnnotation({
        anchor: {
          anchorType: "pdf_page",
          pageNumber,
          sectionTitle,
          metadata: {
            captureSource: "lecture_reader",
            createdDayId: activeDay?.id,
            contextImageUrl: includeScreenshot || ["question", "todo"].includes(kind)
              ? pdfReaderPageUrl(resourceId, pageNumber)
              : undefined,
            includeSlideScreenshot: includeScreenshot,
          },
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
          metadata: { createdDayId: activeDay?.id },
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
          metadata: { createdDayId: activeDay?.id },
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
      postponed?: boolean;
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
      anchor: {
        anchorType: "resource",
        metadata: { createdDayId: activeDay?.id },
      },
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
          metadata: {
            captureSource: "resource_inline",
            createdDayId: activeDay?.id,
          },
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

  function handleImportMaccyImages(
    resourceId: string,
    taskId: string,
    count: number,
  ) {
    const task = workspace ? findTask(workspace, taskId) : null;
    void runMutation(async () => {
      const result = await importMaccyImageQuestions({
        count,
        resourceId,
        sourceDayId: task?.dayId ?? activeDay?.id,
        sourceTaskId: taskId,
      });
      const duplicateMessage = result.duplicates
        ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? " was" : "s were"} already present.`
        : "";
      setActionMessage(
        `${result.imported} Maccy picture${result.imported === 1 ? "" : "s"} added as open questions.${duplicateMessage}`,
      );
    }, { preserveScroll: true });
  }

  function handleUploadImageQuestions(
    resourceId: string,
    taskId: string,
    files: File[],
  ) {
    const task = workspace ? findTask(workspace, taskId) : null;
    void runMutation(async () => {
      const result = await uploadImageQuestions({
        files,
        resourceId,
        sourceDayId: task?.dayId ?? activeDay?.id,
        sourceTaskId: taskId,
      });
      const duplicateMessage = result.duplicates
        ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? " was" : "s were"} already present.`
        : "";
      setActionMessage(
        `${result.imported} lecture-note picture${result.imported === 1 ? "" : "s"} added as open questions.${duplicateMessage}`,
      );
    }, { preserveScroll: true });
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
        anchor: draft.anchor
          ? {
              ...draft.anchor,
              metadata: {
                ...draft.anchor.metadata,
                createdDayId: draft.anchor.metadata?.createdDayId ?? activeDay?.id,
              },
            }
          : undefined,
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
      const imported = await collectResourcePdfAnnotations(
        resourceId,
        activeDay?.id,
      );
      if (imported.requiresColorRoles) {
        setDrawboardPaletteDraft({
          resourceId,
          resourceTitle: resource.title,
          sourceDayId: activeDay?.id,
          entries: imported.colorPalette,
        });
        return;
      }
      if (imported.changedItems.length) {
        setPdfImportOverview({
          items: imported.changedItems,
          resourceTitle: resource.title,
        });
      }
      setActionMessage(pdfAnnotationCollectionMessage(imported));
    });
  }

  function handleSaveDrawboardColorRoles(
    roles: Record<string, DrawboardColorRole>,
  ) {
    if (!drawboardPaletteDraft) return;
    const draft = drawboardPaletteDraft;
    setDrawboardPaletteDraft(null);
    void runMutation(async () => {
      await saveDrawboardColorRoles(draft.resourceId, roles);
      const imported = await collectResourcePdfAnnotations(
        draft.resourceId,
        draft.sourceDayId,
      );
      if (imported.requiresColorRoles) {
        setDrawboardPaletteDraft({ ...draft, entries: imported.colorPalette });
        return;
      }
      if (imported.changedItems.length) {
        setPdfImportOverview({
          items: imported.changedItems,
          resourceTitle: draft.resourceTitle,
        });
      }
      setActionMessage(pdfAnnotationCollectionMessage(imported));
    });
  }

  function handlePrepareExerciseScreenshots(task: Course["days"][number]["sections"][number]["tasks"][number]) {
    if (!workspace) return;
    void runMutation(async () => {
      const bundle = await prepareExerciseScreenshots(task.id);
      const resource = task.resourceIds
        .map((resourceId) => workspace.resources.find((item) => item.id === resourceId))
        .find((item) => item?.kind === "book");
      if (resource && bundle.available_exercises.length) {
        const note = resource.notes.find((item) => item.kind === "exercise_progress");
        const existing = parseExerciseProgress(note);
        const detected = new Set(bundle.exercises);
        const progress = Object.fromEntries(
          bundle.available_exercises.map((exercise) => [
            exercise,
            existing[exercise] ??
              (detected.has(exercise) ? "read_partially" : "unread"),
          ]),
        );
        const markdown = serializeExerciseProgress(progress);
        await upsertNote({
          courseId: workspace.id,
          noteId: note?.id,
          noteRevision: note?.revision,
          documentRevision: note?.document.revision,
          entityId: resource.id,
          entityType: "resource",
          kind: "exercise_progress",
          markdown,
          plainText: markdown,
        });
      }
      const warningText = bundle.warnings.length
        ? ` ${bundle.warnings.join(" ")}`
        : "";
      setActionMessage(
        `${bundle.screenshots.length} handwritten solution screenshot${
          bundle.screenshots.length === 1 ? "" : "s"
        } ready in ${bundle.directory}.${warningText}`,
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

  function responseQuestionLinks(
    discussion: Discussion | undefined,
    markdown: string,
  ): NonNullable<DiscussionMessageInput["annotationLinks"]> {
    if (!workspace || !discussion) return [];
    return responseQuestionIds(
      discussion,
      markdown,
      workspace.annotations,
      workspace.discussions,
    ).map((annotationId) => ({
      annotationId,
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
        ? responseQuestionLinks(discussion, markdown)
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
    reviewItems: DiscussionReviewItem[] = [],
  ) {
    const markdown = normalizeDiscussionMarkdown(markdownInput);
    void runMutation(async () => {
      if (reviewItems.length) {
        await reviewDiscussionMessage(message.id, {
          revision: message.revision,
          documentRevision: message.body.revision,
          markdown,
          plainText: markdown,
          reviewItems,
        });
      } else {
        await updateDiscussionMessage(message.id, {
          revision: message.revision,
          documentRevision: message.body.revision,
          markdown,
          plainText: markdown,
        });
      }
    });
  }

  function handleDeleteDiscussionMessage(message: DiscussionMessage) {
    void runMutation(async () => {
      await deleteDiscussionMessage(message.id, message.revision);
      setActionMessage(
        "Tutor response deleted fully; its answered questions are open again.",
      );
    });
  }

  function handleMapExerciseSolution(input: ExerciseSolutionMappingInput) {
    if (!workspace) return;
    void runMutation(async () => {
      const task = workspace.days
        .flatMap((day) => day.sections)
        .flatMap((section) => section.tasks)
        .find((item) => item.id === input.taskId);
      const questionIds = new Set(input.questionIds);
      const existing = task?.notes.find(
        (note) =>
          note.kind === "exercise_solution" &&
          note.links.some(
            (link) =>
              link.entityType === "discussion_message" &&
              link.entityId === input.sourceMessageId,
          ) &&
          (
            (questionIds.size > 0 &&
              note.links.some(
                (link) =>
                  link.entityType === "annotation" &&
                  questionIds.has(link.entityId),
              )) ||
            input.exerciseLabels.every((label) =>
              exerciseNumbersInText(
                note.document.markdown ?? note.document.plainText,
              ).includes(label.replace(/^Exercise\s+/i, "")),
            )
          ),
      );
      await upsertNote({
        courseId: workspace.id,
        noteId: existing?.id,
        noteRevision: existing?.revision,
        documentRevision: existing?.document.revision,
        entityId: input.taskId,
        entityType: "task",
        kind: "exercise_solution",
        markdown: input.markdown,
        plainText: input.markdown,
        relatedLinks: [
          {
            entityId: input.sourceMessageId,
            entityType: "discussion_message",
          },
          ...input.questionIds.map((questionId) => ({
            entityId: questionId,
            entityType: "annotation",
          })),
        ],
      });
      setActionMessage(
        `${input.exerciseLabels.join(" and ")} and its formulas were added to the exercise task.`,
      );
    });
  }

  function handleToggleImportantAnswer(input: ImportantAnswerInput) {
    if (!workspace) return;
    void runMutation(async () => {
      if (input.existingNote) {
        await deleteNote(input.existingNote.id, input.existingNote.revision);
        setActionMessage("Answer removed from important notes.");
        return;
      }
      const marker = `<!-- qa-section:${input.messageId}:${input.sectionLabel} -->`;
      await upsertNote({
        courseId: workspace.id,
        entityId: input.messageId,
        entityType: "discussion_message",
        kind: "important_answer",
        markdown: `# ${input.title}\n\n${marker}\n\n${input.markdown}`,
        plainText: input.markdown,
        relatedLinks: input.questionIds.map((questionId) => ({
          entityId: questionId,
          entityType: "annotation",
        })),
      });
      setActionMessage("Answer saved to Important answers in Notes.");
    });
  }

  function handleDeleteDiscussionAnswer(
    message: DiscussionMessage,
    markdownInput: string,
    questionIds: string[],
    archiveQuestions = false,
  ) {
    const markdown = normalizeDiscussionMarkdown(markdownInput);
    void runMutation(async () => {
      await deleteDiscussionAnswer(message.id, {
        revision: message.revision,
        documentRevision: message.body.revision,
        markdown,
        plainText: markdown,
        questionIds,
        archiveQuestions,
      });
      setActionMessage(
        archiveQuestions
          ? "The question was archived and its tutor answer was removed."
          : questionIds.length
          ? "The tutor answer was deleted and its questions are open again."
          : "The tutor answer was deleted.",
      );
    });
  }

  async function handleImportDiscussionFromClipboard(resourceId: string) {
    setError(null);
    try {
      const clipboard = await navigator.clipboard.readText();
      const markdown = importPastedMarkdown(clipboard);
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
        const annotationLinks = existingDiscussion
          ? responseQuestionLinks(existingDiscussion, markdown)
          : [];
        await createDiscussionMessage(discussion.id, {
          annotationLinks,
          importedFromClipboard: true,
          linkPromptQuestions: false,
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

  function handleDiscussionQaViewed(
    discussionId: string,
    messageId: string,
    questionIds: string[],
  ) {
    void runMutation(async () => {
      await reviewDiscussionQa(discussionId, messageId, questionIds);
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
      onCopyDayPrompt={(day, includeTutorSolutions) =>
        void handleStartDiscussion(
          dayPrompt(workspace, day, { includeTutorSolutions }),
        )
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
        activeTaskId: toggl.status.current?.taskId,
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
      {promptProgress ? (
        <div
          aria-live="polite"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={promptProgress.progress}
          className="actionToast promptProgressToast"
          role="progressbar"
        >
          <div className="promptProgressCopy">
            <strong>{promptProgress.stage}</strong>
            <span>{promptProgress.progress}%</span>
          </div>
          <div className="promptProgressTrack">
            <span style={{ width: `${promptProgress.progress}%` }} />
          </div>
        </div>
      ) : null}
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
          activeDayId={activeDayId}
          course={workspaceWithLiveTime ?? workspace}
          onActiveDayChange={setActiveDayId}
          onAnnotationChange={handleAnnotationChange}
          onCollectPdfAnnotations={handleCollectPdfAnnotations}
          onChapterProgressChange={handleResourceChapterProgressChange}
          onDayClosedChange={handleDayClosedChange}
          onExerciseProgressChange={handleExerciseProgressChange}
          onExerciseReviewChange={handleExerciseReviewChange}
          onDayNoteSave={handleDayNoteSave}
          onCreateCapture={handleCreateResourceCapture}
          onImportMaccyImages={handleImportMaccyImages}
          onNoteSave={handleNoteSave}
          onNoteDelete={handleNoteDelete}
          onNoteAttentionChange={handleNoteAttentionChange}
          onOpenDiscussion={handleOpenDiscussion}
          onCopyNextQuestions={(dayId, task) =>
            void handleCopyNextTaskQuestions(dayId, task)
          }
          onOpenTaskQa={handleOpenTaskQa}
          onOpenResource={(resourceId) => void handleOpenResource(resourceId)}
          onPrepareExerciseScreenshots={handlePrepareExerciseScreenshots}
          onUploadImageQuestions={handleUploadImageQuestions}
          onTaskStatusChange={handleTaskStatusChange}
          onToggleTaskTimer={(day, task, resources) =>
            void toggl.toggleTask(day, task, resources)
          }
          taskTimer={{
            activeTaskId: toggl.status.current?.taskId,
            busy: toggl.busy,
            configured: toggl.status.configured,
            error: toggl.error,
            online: toggl.status.online,
            trackedSecondsByTask: toggl.trackedSecondsByTask,
          }}
        />
      ) : null}
      {view === "resources" ? (
        <ResourcesView
          course={workspace}
          onChapterProgressChange={handleResourceChapterProgressChange}
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
          taskQaLaunch={taskQaLaunch}
          onTaskQaClose={() => setTaskQaLaunch(null)}
          onAddMessage={handleAddDiscussionMessage}
          onDeleteMessage={handleDeleteDiscussionMessage}
          onUpdateMessage={handleUpdateDiscussionMessage}
          onAnnotationChange={handleAnnotationChange}
          onCreateCapture={handleCreateResourceCapture}
          onCreateDiscussion={handleCreateDiscussion}
          onDeleteAnswer={handleDeleteDiscussionAnswer}
          onDeleteDiscussion={handleDeleteDiscussion}
          onDiscussionStatusChange={handleDiscussionStatusChange}
          onDiscussionAttentionChange={handleDiscussionAttentionChange}
          onExtractQuestions={handleExtractDiscussionQuestions}
          onQuestionLink={handleDiscussionQuestionLink}
          onQaViewed={handleDiscussionQaViewed}
          onAskMessageQuestion={handleAskDiscussionQuestion}
          onImportClipboard={(resourceId) =>
            void handleImportDiscussionFromClipboard(resourceId)
          }
          onMapExerciseSolution={handleMapExerciseSolution}
          onToggleImportantAnswer={handleToggleImportantAnswer}
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
            includeScreenshot,
          ) =>
            handleReaderPageAnnotation(
              readerResource.id,
              kind,
              markdown,
              pageNumber,
              sectionTitle,
              includeScreenshot,
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
      {drawboardPaletteDraft ? (
        <DrawboardColorPaletteDialog
          entries={drawboardPaletteDraft.entries}
          onClose={() => setDrawboardPaletteDraft(null)}
          onSave={handleSaveDrawboardColorRoles}
          resourceTitle={drawboardPaletteDraft.resourceTitle}
        />
      ) : null}
      {pdfImportOverview ? (
        <PdfImportOverviewDialog
          days={workspace.days}
          items={pdfImportOverview.items}
          onClose={() => setPdfImportOverview(null)}
          resourceTitle={pdfImportOverview.resourceTitle}
        />
      ) : null}
    </>
  );
}
