import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Circle,
  CircleHelp,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  annotationImageUrl,
  pdfReaderPageUrl,
} from "../../api/trackerApi";
import {
  annotationDisplayText,
  metadataNumber,
  metadataText,
} from "../../components/annotations/annotationDisplay";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { DiscussionMarkdownSurface } from "../../components/editor/DiscussionMarkdownSurface";
import type { DiscussionReviewItem } from "../../components/editor/DiscussionMarkdownSurface";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  discussionQaSections,
  reconstructQaMessage,
  type DiscussionQaSection,
} from "../../lib/discussionQa";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  Discussion,
  DiscussionMessage,
  DiscussionQuestionRelation,
  Resource,
  ExerciseSolutionMappingInput,
} from "../../types/tracker";
import {
  inferredExerciseLabels,
  qaReviewItems,
  sourceQuestionForReview,
  type QaReviewItem,
} from "./discussionQaReviewModel";

type DiscussionQaReviewProps = {
  course: Course;
  discussion: Discussion;
  onAnnotationChange: (
    annotation: Annotation,
    changes: {
      kind?: AnnotationKind;
      status?: AnnotationStatus;
      postponed?: boolean;
      priority?: Annotation["priority"];
      markdown?: string;
      plainText?: string;
      documentRevision?: number;
    },
  ) => void;
  onClose: () => void;
  onDeleteAnswer: (
    message: DiscussionMessage,
    markdown: string,
    questionIds: string[],
  ) => void;
  onQuestionLink: (
    messageId: string,
    annotationId: string,
    relation: DiscussionQuestionRelation,
  ) => void;
  onMapExerciseSolution: (input: ExerciseSolutionMappingInput) => void;
  onUpdateMessage: (
    message: DiscussionMessage,
    markdown: string,
    reviewItems?: DiscussionReviewItem[],
  ) => void;
};

type ExerciseTaskOption = {
  dayNumber: number;
  dayTitle: string;
  task: Course["days"][number]["sections"][number]["tasks"][number];
};

function exerciseLabelsFromInput(value: string): string[] {
  const labels: string[] = [];
  for (const match of value.matchAll(/(?:Exercise\s*)?(\d+(?:\.\d+)+)/gi)) {
    const label = `Exercise ${match[1]}`;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.length ? labels : ["Exercise"];
}

function exerciseHeading(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  return `Exercises ${labels.map((label) => label.replace(/^Exercise\s+/i, "")).join(", ")}`;
}

function exerciseTaskOptions(
  course: Course,
  item: QaReviewItem,
  exerciseLabel: string,
): ExerciseTaskOption[] {
  const resourceIds = new Set(item.questions.map((question) => question.resourceId));
  const createdDayIds = new Set(
    item.questions
      .map((question) => metadataText(question, "createdDayId"))
      .filter(Boolean),
  );
  const sourceDayNumber = course.days.find((day) => createdDayIds.has(day.id))?.number;
  const chapter = Number(exerciseLabel.match(/(\d+)\./)?.[1] ?? 0);
  const all = course.days.flatMap((day) =>
    day.sections.flatMap((section) =>
      section.tasks
        .filter((task) => task.resourceIds.some((id) => resourceIds.has(id)))
        .map((task) => ({ dayNumber: day.number, dayTitle: day.title, task })),
    ),
  );
  const exerciseTasks = all.filter(
    ({ task }) =>
      /\b(?:exercise|problem|solve|practice)\b/i.test(task.title) ||
      task.taskType === "solve",
  );
  const candidates = exerciseTasks.length ? exerciseTasks : all;
  return candidates.sort((first, second) => {
    const firstFuture = sourceDayNumber === undefined || first.dayNumber >= sourceDayNumber;
    const secondFuture = sourceDayNumber === undefined || second.dayNumber >= sourceDayNumber;
    if (firstFuture !== secondFuture) return firstFuture ? -1 : 1;
    const firstChapter = !chapter || first.task.chapterNumbers.includes(chapter);
    const secondChapter = !chapter || second.task.chapterNumbers.includes(chapter);
    if (firstChapter !== secondChapter) return firstChapter ? -1 : 1;
    const firstOpen = !["done", "skipped"].includes(first.task.status);
    const secondOpen = !["done", "skipped"].includes(second.task.status);
    if (firstOpen !== secondOpen) return firstOpen ? -1 : 1;
    return first.dayNumber - second.dayNumber || first.task.orderIndex - second.task.orderIndex;
  });
}

function ExerciseSolutionMapper({
  course,
  discussion,
  item,
  onMap,
}: {
  course: Course;
  discussion: Discussion;
  item: QaReviewItem;
  onMap: (input: ExerciseSolutionMappingInput) => void;
}) {
  const initialLabels = inferredExerciseLabels(item);
  const [open, setOpen] = useState(false);
  const [exerciseLabelInput, setExerciseLabelInput] = useState(
    initialLabels.join(", "),
  );
  const exerciseLabels = exerciseLabelsFromInput(exerciseLabelInput);
  const options = exerciseTaskOptions(course, item, exerciseLabels[0]);
  const [taskId, setTaskId] = useState(options[0]?.task.id ?? "");
  const mappedOption = options.find(({ task }) =>
    task.notes.some(
      (note) =>
        note.kind === "exercise_solution" &&
        note.links.some(
          (link) =>
            link.entityType === "annotation" &&
            item.questions.some((question) => question.id === link.entityId),
        ),
    ),
  );

  if (!item.section || !item.questions.length || !options.length) return null;

  function save() {
    const labels = exerciseLabelsFromInput(exerciseLabelInput);
    const heading = exerciseHeading(labels);
    const questionText = item.questions
      .filter(
        (question) =>
          !annotationDisplayText(question).startsWith("Screenshot ·"),
      )
      .map((question) => annotationDisplayText(question))
      .join("\n\n");
    const markdown = [
      `# ${heading} — tutor material`,
      `_From “${discussion.title}”, response #${item.section!.messageSequenceNumber}_`,
      questionText ? `## Question context\n\n${questionText}` : "",
      `## Tutor explanation\n\n${item.section!.bodyMarkdown}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    onMap({
      exerciseLabels: labels,
      markdown,
      questionIds: item.questions.map((question) => question.id),
      sourceMessageId: item.section!.messageId,
      taskId,
    });
    setOpen(false);
  }

  return (
    <section className="qaExerciseMapper">
      <button
        className={mappedOption ? "qaExerciseMapButton mapped" : "qaExerciseMapButton"}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {mappedOption ? <CheckCircle2 size={14} /> : <BookMarked size={14} />}
        <span>
          {mappedOption
            ? `Sent to Day ${mappedOption.dayNumber} exercises`
            : "Send to exercise task"}
        </span>
      </button>
      {open ? (
        <div className="qaExerciseMapForm">
          <label>
            <span>Exercises</span>
            <input
              onChange={(event) => setExerciseLabelInput(event.target.value)}
              placeholder="Exercise 6.2, Exercise 6.6"
              value={exerciseLabelInput}
            />
          </label>
          <label>
            <span>Study task</span>
            <select onChange={(event) => setTaskId(event.target.value)} value={taskId}>
              {options.map((option) => (
                <option key={option.task.id} value={option.task.id}>
                  Day {option.dayNumber} · {option.task.title}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!taskId} onClick={save} type="button">
            Save rich answer
          </button>
          <p>
            Every listed exercise is saved with the same exact Markdown and formulas.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function SourcePageImage({
  annotated,
  focusQuestions = [],
  pageNumber,
  primaryPageNumber,
  resourceId,
  onLoad,
}: {
  annotated: boolean;
  focusQuestions?: Annotation[];
  pageNumber: number;
  primaryPageNumber: number;
  resourceId: string;
  onLoad?: () => void;
}) {
  const [useCleanPage, setUseCleanPage] = useState(!annotated);
  const representative = focusQuestions[0];
  const pageWidth = representative
    ? metadataNumber(representative, "pageWidth")
    : null;
  const pageHeight = representative
    ? metadataNumber(representative, "pageHeight")
    : null;
  const focusRects =
    pageNumber === primaryPageNumber && pageWidth && pageHeight
      ? focusQuestions
          .filter(
            (question) =>
              question.anchor?.pageNumber === pageNumber &&
              question.anchor.rect?.length === 4,
          )
          .map((question) => {
            const rect = question.anchor!.rect!;
            const drawboard = question.origin.startsWith("drawboard_cloud");
            return {
              x: rect[0],
              y: drawboard ? pageHeight - rect[3] : rect[1],
              width: Math.max(2, rect[2] - rect[0]),
              height: Math.max(2, rect[3] - rect[1]),
            };
          })
      : [];
  const annotatedUrl = annotationImageUrl(
    resourceId,
    `drawboard-page-${pageNumber}`,
  );
  const cleanUrl = pdfReaderPageUrl(resourceId, pageNumber);

  return (
    <div className="qaSourcePageFrame">
      <img
        alt={`Source page ${pageNumber}`}
        onError={() => {
          if (!useCleanPage) setUseCleanPage(true);
        }}
        onLoad={onLoad}
        src={useCleanPage ? cleanUrl : annotatedUrl}
      />
      {focusRects.length && pageWidth && pageHeight ? (
        <svg
          aria-hidden="true"
          className="qaSourceFocus"
          preserveAspectRatio="none"
          viewBox={`0 0 ${pageWidth} ${pageHeight}`}
        >
          {focusRects.map((rect, index) => (
            <rect
              height={rect.height}
              key={`${rect.x}:${rect.y}:${index}`}
              rx="3"
              width={rect.width}
              x={rect.x}
              y={rect.y}
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}

function SourcePreview({
  questions,
  resource,
}: {
  questions: Annotation[];
  resource?: Resource;
}) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef<HTMLDivElement>(null);
  const question = sourceQuestionForReview(questions);
  const pageNumber = question?.anchor?.pageNumber ?? null;
  const pageCount =
    (question ? metadataNumber(question, "pageCount") : null) ??
    resource?.version?.pageCount ??
    null;
  const annotated = questions.some((item) =>
    Boolean(metadataText(item, "annotatedPageImageUrl")),
  );
  const neighboringPages = pageNumber
    ? [pageNumber - 1, pageNumber, pageNumber + 1].filter(
        (page) => page >= 1 && (!pageCount || page <= pageCount),
      )
    : [];

  const focusCurrentPage = useCallback(() => {
    const pages = pagesRef.current;
    const current = currentPageRef.current;
    if (!pages || !current) return;
    window.requestAnimationFrame(() => {
      const pagesTop = pages.getBoundingClientRect().top;
      const currentTop = current.getBoundingClientRect().top;
      pages.scrollTop = Math.max(
        0,
        pages.scrollTop + currentTop - pagesTop - 8,
      );
    });
  }, []);

  useLayoutEffect(() => {
    focusCurrentPage();
  }, [focusCurrentPage, pageNumber]);

  if (!question) {
    return (
      <div className="qaSourceEmpty">
        <BookOpen size={34} />
        <strong>Orientation section</strong>
        <p>This answer section is not mapped to a particular page or slide.</p>
      </div>
    );
  }

  return (
    <section className="qaSourcePanel">
      <header>
        <span>{resource?.kind === "slides" ? "Slide" : "Source page"}</span>
        <strong>
          {pageNumber ? `p. ${pageNumber}` : "Text context"}
        </strong>
      </header>
      {pageNumber ? (
        <div className="qaSourcePages" ref={pagesRef}>
          {neighboringPages.map((sourcePage) => (
            <div
              className={
                sourcePage === pageNumber
                  ? "qaSourcePage current"
                  : "qaSourcePage neighbor"
              }
              key={sourcePage}
              ref={sourcePage === pageNumber ? currentPageRef : undefined}
            >
              <span>
                {sourcePage === pageNumber
                  ? "Current"
                  : sourcePage < pageNumber
                    ? "Previous"
                    : "Next"}{" "}
                · p. {sourcePage}
              </span>
              <SourcePageImage
                annotated={annotated}
                focusQuestions={questions}
                pageNumber={sourcePage}
                primaryPageNumber={pageNumber}
                resourceId={question.resourceId}
                onLoad={
                  sourcePage === pageNumber ? focusCurrentPage : undefined
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="qaSourceText">
          {metadataText(question, "contextBefore") ? (
            <p>{metadataText(question, "contextBefore")}</p>
          ) : null}
          {question.anchor?.quote ? (
            <blockquote>{question.anchor.quote}</blockquote>
          ) : null}
          {metadataText(question, "contextAfter") ? (
            <p>{metadataText(question, "contextAfter")}</p>
          ) : null}
        </div>
      )}
      <footer title={resource?.title}>{resource?.title ?? "Linked resource"}</footer>
    </section>
  );
}

export function DiscussionQaReview({
  course,
  discussion,
  onAnnotationChange,
  onClose,
  onDeleteAnswer,
  onMapExerciseSolution,
  onQuestionLink,
  onUpdateMessage,
}: DiscussionQaReviewProps) {
  const parsedSections = useMemo(
    () => discussionQaSections(discussion, course.annotations),
    [course.annotations, discussion],
  );
  const [hiddenSectionIds, setHiddenSectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const sections = useMemo(
    () => parsedSections.filter((section) => !hiddenSectionIds.has(section.id)),
    [hiddenSectionIds, parsedSections],
  );
  const annotationById = useMemo(
    () => new Map(course.annotations.map((item) => [item.id, item])),
    [course.annotations],
  );
  const resourceById = useMemo(
    () => new Map(course.resources.map((item) => [item.id, item])),
    [course.resources],
  );
  const messageById = useMemo(
    () => new Map(discussion.messages.map((message) => [message.id, message])),
    [discussion.messages],
  );
  const sectionsByMessage = useMemo(
    () =>
      sections.reduce((groups, section) => {
        const current = groups.get(section.messageId) ?? [];
        current.push(section);
        groups.set(section.messageId, current);
        return groups;
      }, new Map<string, DiscussionQaSection[]>()),
    [sections],
  );
  const initialSectionDrafts = useMemo(
    () => new Map(sections.map((section) => [section.id, section.bodyMarkdown])),
    [sections],
  );
  const [sectionDrafts, setSectionDrafts] = useState(
    () => new Map(initialSectionDrafts),
  );
  const [savedMessageMarkdown, setSavedMessageMarkdown] = useState(
    () =>
      new Map(
        [...sectionsByMessage.entries()].map(([messageId, messageSections]) => [
          messageId,
          reconstructQaMessage(messageSections, initialSectionDrafts).markdown,
        ]),
      ),
  );
  const [reviewItemsBySection, setReviewItemsBySection] = useState(
    new Map<string, DiscussionReviewItem[]>(),
  );
  const [openQuestionsOnly, setOpenQuestionsOnly] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [savedPulse, setSavedPulse] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDeleteAnswer, setConfirmDeleteAnswer] = useState(false);
  const allItems = useMemo(
    () => qaReviewItems(sections, annotationById, discussion),
    [annotationById, discussion, sections],
  );
  const visibleItems = useMemo(
    () =>
      openQuestionsOnly
        ? allItems.filter((item) =>
            item.questions.some(
              (question) =>
                question.status === "open" && !question.postponed,
            ),
          )
        : allItems,
    [allItems, openQuestionsOnly],
  );
  const boundedActiveIndex = Math.max(
    0,
    Math.min(activeIndex, Math.max(0, visibleItems.length - 1)),
  );
  const activeItem = visibleItems[boundedActiveIndex];
  const reviewUnits = allItems.filter((item) => item.questions.length);
  const answeredUnits = reviewUnits.filter(
    (item) =>
      item.questions.length > 0 &&
      item.questions.every((question) => question.status === "answered"),
  ).length;
  const completionRatio = reviewUnits.length
    ? answeredUnits / reviewUnits.length
    : 0;

  const reconstructedByMessage = useMemo(
    () =>
      new Map(
        [...sectionsByMessage.entries()].map(([messageId, messageSections]) => [
          messageId,
          reconstructQaMessage(messageSections, sectionDrafts),
        ]),
      ),
    [sectionDrafts, sectionsByMessage],
  );
  const dirtyMessageIds = [...reconstructedByMessage.entries()]
    .filter(
      ([messageId, rebuilt]) =>
        rebuilt.markdown !== (savedMessageMarkdown.get(messageId) ?? ""),
    )
    .map(([messageId]) => messageId);
  const pendingReviewCount = [...reviewItemsBySection.values()].reduce(
    (count, items) => count + items.length,
    0,
  );
  const hasUnsavedChanges =
    dirtyMessageIds.length > 0 || pendingReviewCount > 0;

  useEffect(() => {
    function navigateWithKeyboard(event: KeyboardEvent) {
      if (
        !event.metaKey ||
        !event.altKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      setActiveIndex((current) =>
        Math.max(
          0,
          Math.min(
            current + (event.key === "ArrowRight" ? 1 : -1),
            Math.max(0, visibleItems.length - 1),
          ),
        ),
      );
    }
    window.addEventListener("keydown", navigateWithKeyboard);
    return () => window.removeEventListener("keydown", navigateWithKeyboard);
  }, [visibleItems.length]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function setCurrentDraft(markdown: string) {
    if (!activeItem?.section) return;
    setSectionDrafts((current) => {
      const next = new Map(current);
      next.set(activeItem.section!.id, markdown);
      return next;
    });
  }

  function setCurrentReviewItems(items: DiscussionReviewItem[]) {
    if (!activeItem?.section) return;
    setReviewItemsBySection((current) => {
      const next = new Map(current);
      next.set(activeItem.section!.id, items);
      return next;
    });
  }

  function saveSession(
    activeMarkdown?: string,
    activeReviewItems?: DiscussionReviewItem[],
  ) {
    const drafts = new Map(sectionDrafts);
    const reviewItems = new Map(reviewItemsBySection);
    if (activeItem?.section && activeMarkdown !== undefined) {
      drafts.set(activeItem.section.id, activeMarkdown);
    }
    if (activeItem?.section && activeReviewItems !== undefined) {
      reviewItems.set(activeItem.section.id, activeReviewItems);
    }
    const nextSaved = new Map(savedMessageMarkdown);
    for (const [messageId, messageSections] of sectionsByMessage) {
      const message = messageById.get(messageId);
      if (!message) continue;
      const rebuilt = reconstructQaMessage(messageSections, drafts);
      const messageReviewItems = messageSections.flatMap((section) => {
        const offset = rebuilt.sectionBodyOffsets.get(section.id) ?? 0;
        return (reviewItems.get(section.id) ?? []).map((item) => ({
          ...item,
          fromPosition:
            item.fromPosition === undefined
              ? undefined
              : item.fromPosition + offset,
          toPosition:
            item.toPosition === undefined
              ? undefined
              : item.toPosition + offset,
        }));
      });
      if (
        rebuilt.markdown !== (savedMessageMarkdown.get(messageId) ?? "") ||
        messageReviewItems.length
      ) {
        onUpdateMessage(message, rebuilt.markdown, messageReviewItems);
        nextSaved.set(messageId, rebuilt.markdown);
      }
    }
    setSectionDrafts(drafts);
    setSavedMessageMarkdown(nextSaved);
    setReviewItemsBySection(new Map());
    setEditorGeneration((current) => current + 1);
    setSavedPulse(true);
    window.setTimeout(() => setSavedPulse(false), 1_500);
  }

  function requestClose() {
    if (hasUnsavedChanges) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  function deleteCurrentAnswer() {
    const section = activeItem?.section;
    if (!section) return;
    const message = messageById.get(section.messageId);
    if (!message) return;
    const remainingSections = (sectionsByMessage.get(section.messageId) ?? []).filter(
      (candidate) => candidate.id !== section.id,
    );
    const rebuilt = reconstructQaMessage(remainingSections, sectionDrafts);
    onDeleteAnswer(
      message,
      rebuilt.markdown,
      activeItem.questions.map((question) => question.id),
    );
    setHiddenSectionIds((current) => new Set([...current, section.id]));
    setSavedMessageMarkdown((current) => {
      const next = new Map(current);
      next.set(section.messageId, rebuilt.markdown);
      return next;
    });
    setConfirmDeleteAnswer(false);
    setActiveIndex((current) => Math.max(0, current - 1));
  }

  const content = (
    <div className="qaReviewBackdrop">
      <main className="qaReviewSession" role="dialog" aria-modal="true">
        <header className="qaReviewHeader">
          <div className="qaReviewTitle">
            <span className="qaReviewBadge">
              <Sparkles size={15} /> QA review
            </span>
            <div>
              <p>{discussion.title}</p>
              <strong>
                {answeredUnits} of {reviewUnits.length} answer groups understood
              </strong>
            </div>
          </div>
          <div className="qaReviewProgressBlock">
            <div className="qaReviewProgressLabels">
              <span>
                {visibleItems.length
                  ? `Reviewing ${openQuestionsOnly ? "open " : ""}group ${boundedActiveIndex + 1} of ${visibleItems.length}`
                  : "All clear"}
              </span>
              <strong>{Math.round(completionRatio * 100)}% complete</strong>
            </div>
            <div
              aria-label="Questions understood"
              aria-valuemax={reviewUnits.length}
              aria-valuemin={0}
              aria-valuenow={answeredUnits}
              className="qaReviewProgressTrack"
              role="progressbar"
            >
              <span
                style={
                  {
                    "--qa-progress": `${Math.max(3, completionRatio * 100)}%`,
                  } as CSSProperties
                }
              />
            </div>
          </div>
          <div className="qaReviewHeaderActions">
            <label className="qaReviewFilter">
              <input
                checked={openQuestionsOnly}
                onChange={(event) => {
                  setOpenQuestionsOnly(event.target.checked);
                  setActiveIndex(0);
                }}
                type="checkbox"
              />
              <span>Open only</span>
            </label>
            <button
              className={`commandButton qaSaveAll ${savedPulse ? "saved" : ""}`}
              disabled={!hasUnsavedChanges}
              onClick={() => saveSession()}
              type="button"
            >
              {savedPulse ? <CheckCircle2 size={15} /> : <Save size={15} />}
              <span>{savedPulse ? "Saved" : `Save session${pendingReviewCount ? ` · ${pendingReviewCount}` : ""}`}</span>
            </button>
            <button
              aria-label="Close QA review"
              className="qaReviewClose"
              onClick={requestClose}
              title="Close QA review"
              type="button"
            >
              <X size={19} />
            </button>
          </div>
        </header>

        {activeItem ? (
          <div className="qaReviewWorkspace">
            <SourcePreview
              key={activeItem.id}
              questions={activeItem.questions}
              resource={
                activeItem.questions[0]
                  ? resourceById.get(activeItem.questions[0].resourceId)
                  : undefined
              }
            />
            <section className="qaAnswerPanel">
              <header className="qaAnswerHeading">
                <div>
                  <span>
                    Response #{activeItem.section?.messageSequenceNumber ?? "—"}
                  </span>
                  <h2>{activeItem.section?.title ?? "Unmapped question"}</h2>
                </div>
                <div className="qaAnswerActions">
                  {activeItem.section ? (
                    <button
                      aria-label="Delete this tutor answer"
                      className="qaDeleteAnswer"
                      disabled={hasUnsavedChanges}
                      onClick={() => setConfirmDeleteAnswer(true)}
                      title={
                        hasUnsavedChanges
                          ? "Save the QA session before deleting an answer"
                          : "Delete answer and reopen its questions"
                      }
                      type="button"
                    >
                      <Trash2 size={14} /> Delete answer
                    </button>
                  ) : null}
                  {activeItem.questions.length ? (
                    <button
                      className={
                        activeItem.questions.every(
                          (question) => question.status === "answered",
                        )
                          ? "qaAnsweredToggle answered"
                          : "qaAnsweredToggle"
                      }
                      onClick={() => {
                        const allAnswered = activeItem.questions.every(
                          (question) => question.status === "answered",
                        );
                        for (const question of activeItem.questions) {
                          if (allAnswered) {
                            onAnnotationChange(question, { status: "open" });
                          } else if (
                            activeItem.section &&
                            question.status !== "answered"
                          ) {
                            onQuestionLink(
                              activeItem.section.messageId,
                              question.id,
                              "answers",
                            );
                          } else if (question.status !== "answered") {
                            onAnnotationChange(question, { status: "answered" });
                          }
                        }
                      }}
                      type="button"
                    >
                      {activeItem.questions.every(
                        (question) => question.status === "answered",
                      ) ? (
                        <CheckCircle2 size={15} />
                      ) : (
                        <Circle size={15} />
                      )}
                      {activeItem.questions.every(
                        (question) => question.status === "answered",
                      )
                        ? "Understood"
                        : "Mark understood"}
                    </button>
                  ) : null}
                </div>
              </header>
              {activeItem.questions.length ? (
                <section className="qaQuestionPrompt">
                  <span>
                    <CircleHelp size={13} /> Original question
                    {activeItem.questions.length > 1
                      ? ` · ${activeItem.questions.length} linked captures`
                      : ""}
                  </span>
                  {(
                    activeItem.questions.filter(
                      (question) =>
                        !annotationDisplayText(question).startsWith("Screenshot ·"),
                    ).length
                      ? activeItem.questions.filter(
                          (question) =>
                            !annotationDisplayText(question).startsWith("Screenshot ·"),
                        )
                      : activeItem.questions.slice(0, 1)
                  ).map((question) => (
                    <MarkdownMath key={question.id}>
                      {annotationDisplayText(question)}
                    </MarkdownMath>
                  ))}
                </section>
              ) : null}
              <ExerciseSolutionMapper
                course={course}
                discussion={discussion}
                item={activeItem}
                key={`exercise:${activeItem.id}`}
                onMap={onMapExerciseSolution}
              />
              {activeItem.section ? (
                <DiscussionMarkdownSurface
                  className="qaAnswerEditor"
                  editable
                  key={`${activeItem.section.id}:${editorGeneration}`}
                  markdown={
                    sectionDrafts.get(activeItem.section.id) ??
                    activeItem.section.bodyMarkdown
                  }
                  onCancel={requestClose}
                  onChange={setCurrentDraft}
                  onReviewItemsChange={setCurrentReviewItems}
                  onSave={(markdown, items) => saveSession(markdown, items)}
                  placeholder="Refine the answer, highlight the useful parts, or select text and press ⌘D for a follow-up…"
                  reviewMode
                  showActions={false}
                />
              ) : (
                <div className="qaUnmappedAnswer">
                  <CircleHelp size={24} />
                  <h3>No answer section was mapped</h3>
                  <p>
                    Keep it open for the next tutor round, or mark it understood if
                    another section already resolved it.
                  </p>
                </div>
              )}
            </section>
          </div>
        ) : (
          <section className="qaReviewComplete">
            <div className="qaCompletionHalo">
              <Sparkles size={38} />
            </div>
            <h2>Every open question is reviewed</h2>
            <p>
              Switch off “Open only” to revisit the full answer, including
              orientation sections.
            </p>
          </section>
        )}

        <footer className="qaReviewNavigation">
          <button
            disabled={boundedActiveIndex <= 0}
            onClick={() => setActiveIndex(Math.max(0, boundedActiveIndex - 1))}
            type="button"
          >
            <ArrowLeft size={18} /> Previous
          </button>
          <span>⌘⌥ ← / → to navigate</span>
          <button
            disabled={boundedActiveIndex >= visibleItems.length - 1}
            onClick={() =>
              setActiveIndex(
                Math.min(visibleItems.length - 1, boundedActiveIndex + 1),
              )
            }
            type="button"
          >
            Next <ArrowRight size={18} />
          </button>
        </footer>
      </main>
      {confirmClose ? (
        <ConfirmDialog
          confirmLabel="Discard edits"
          description="The answer edits and queued highlights or follow-ups in this QA session have not been saved."
          onCancel={() => setConfirmClose(false)}
          onConfirm={onClose}
          title="Close without saving?"
        />
      ) : null}
      {confirmDeleteAnswer ? (
        <ConfirmDialog
          confirmLabel="Delete answer"
          description="Only this tutor answer will be removed. Its linked questions will return to the open queue for your next tutor round."
          onCancel={() => setConfirmDeleteAnswer(false)}
          onConfirm={deleteCurrentAnswer}
          title="Delete this tutor answer?"
        />
      ) : null}
    </div>
  );

  return createPortal(content, document.body);
}
