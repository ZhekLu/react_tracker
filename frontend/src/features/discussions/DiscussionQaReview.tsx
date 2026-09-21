import { StudyPassProgress } from "../../components/StudyPassProgress";
import { trackedQuestionGroups } from "../../lib/questionIdentity";
import { sourcePageSnapshot } from "../../lib/annotationSnapshots";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Circle,
  CircleHelp,
  ChevronDown,
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
  annotationChapter,
  annotationChapterNumber,
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
import { canonicalQuestionCaptures } from "../../lib/questionIdentity";
import {
  discussionPriority,
  discussionPriorityLabel,
  savedDiscussionPriority,
} from "../../lib/discussionPriority";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  Discussion,
  DiscussionMessage,
  DiscussionQaViewInput,
  DiscussionQuestionRelation,
  Resource,
  ExerciseSolutionMappingInput,
  ImportantAnswerInput,
} from "../../types/tracker";
import {
  exerciseSolutionNoteMatches,
  centeredQaSourceScrollTop,
  inferredExerciseLabels,
  qaReviewItemVisible,
  qaReviewScopeProgress,
  qaGroupNavigationTarget,
  qaReviewStatus,
  qaReviewThreads,
  qaSectionFingerprint,
  type QaReviewFilter,
  type QaReviewItem,
  type QaReviewRecord,
} from "./discussionQaReviewModel";

type DiscussionQaReviewProps = {
  course: Course;
  discussion: Discussion;
  questionIds?: string[];
  scopeLabel?: string;
  initialFilter?: "all" | "open" | "new";
  scopeKind?: "task" | "resource";
  onAnnotationChange: (
    annotation: Annotation,
    changes: {
      kind?: AnnotationKind;
      status?: AnnotationStatus;
      postponed?: boolean;
      skipped?: boolean;
      priority?: Annotation["priority"];
      discussionPriority?: Annotation["discussionPriority"];
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
    archiveQuestions?: boolean,
  ) => void;
  onQuestionLink: (
    messageId: string,
    annotationId: string,
    relation: DiscussionQuestionRelation,
  ) => void;
  onQaViewed: (views: DiscussionQaViewInput[]) => void;
  onMapExerciseSolution: (input: ExerciseSolutionMappingInput) => void;
  onToggleImportantAnswer: (input: ImportantAnswerInput) => void;
  onUpdateMessage: (
    message: DiscussionMessage,
    markdown: string,
    reviewItems?: DiscussionReviewItem[],
  ) => void | boolean | Promise<void | boolean>;
};

function unresolvedQuestionsAreSkipped(questions: Annotation[]): boolean {
  const unresolved = questions.filter(
    (question) => question.status !== "answered",
  );
  return unresolved.length > 0 && unresolved.every((question) => question.skipped);
}

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
        .filter(
          (task) =>
            !resourceIds.size || task.resourceIds.some((id) => resourceIds.has(id)),
        )
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
    task.notes.some((note) =>
      exerciseSolutionNoteMatches(note, item, initialLabels),
    ),
  );

  if (!item.section || !options.length) return null;

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
  const snapshot = sourcePageSnapshot(focusQuestions, pageNumber);
  const annotatedUrl = snapshot
    ? annotationImageUrl(resourceId, snapshot.split("/annotation-images/")[1] ?? "")
    : annotationImageUrl(resourceId, `drawboard-page-${pageNumber}`);
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
  resourceById,
  labelsByAnnotationId,
}: {
  questions: Annotation[];
  resourceById: Map<string, Resource>;
  labelsByAnnotationId: Map<string, string>;
}) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef<HTMLDivElement>(null);
  const sourceQuestions = canonicalQuestionCaptures(questions);
  const resourceGroups = [...sourceQuestions.reduce((groups, question) => {
    const current = groups.get(question.resourceId) ?? [];
    current.push(question);
    groups.set(question.resourceId, current);
    return groups;
  }, new Map<string, Annotation[]>())];
  const firstPageNumber = resourceGroups
    .flatMap(([, items]) => items.map((item) => item.anchor?.pageNumber ?? null))
    .find((page): page is number => Boolean(page));

  const focusCurrentPage = useCallback(() => {
    const pages = pagesRef.current;
    const current = currentPageRef.current;
    if (!pages || !current) return;
    window.requestAnimationFrame(() => {
      const pagesRect = pages.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      const focusRects = [...current.querySelectorAll<SVGRectElement>(
        ".qaSourceFocus rect",
      )].map((element) => element.getBoundingClientRect());
      pages.scrollTop = centeredQaSourceScrollTop({
        currentBottom: currentRect.bottom,
        currentScrollTop: pages.scrollTop,
        currentTop: currentRect.top,
        focusRects: focusRects
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({ bottom: rect.bottom, top: rect.top })),
        viewportHeight: pages.clientHeight,
        viewportTop: pagesRect.top,
      });
    });
  }, []);

  useLayoutEffect(() => {
    focusCurrentPage();
  }, [focusCurrentPage, firstPageNumber]);

  if (!sourceQuestions.length) {
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
        <span>Linked source{sourceQuestions.length === 1 ? "" : "s"}</span>
        <strong>
          {sourceQuestions.length} capture{sourceQuestions.length === 1 ? "" : "s"}
        </strong>
      </header>
      <div className="qaSourcePages" ref={pagesRef}>
        {resourceGroups.map(([resourceId, resourceQuestions]) => {
          const resource = resourceById.get(resourceId);
          const targetPages = [...new Set(
            resourceQuestions
              .map((item) => item.anchor?.pageNumber)
              .filter((page): page is number => Boolean(page)),
          )].sort((left, right) => left - right);
          const pageCount =
            resourceQuestions
              .map((item) => metadataNumber(item, "pageCount"))
              .find((value): value is number => Boolean(value)) ??
            resource?.version?.pageCount ??
            null;
          const pages = [...new Set(
            targetPages.flatMap((page) => [page - 1, page, page + 1]),
          )]
            .filter((page) => page >= 1 && (!pageCount || page <= pageCount))
            .sort((left, right) => left - right);
          const annotated = resourceQuestions.some((item) =>
            Boolean(metadataText(item, "annotatedPageImageUrl")),
          );
          return (
            <section className="qaSourceResource" key={resourceId}>
              <strong className="qaSourceResourceTitle" title={resource?.title}>
                {resource?.title ?? "Linked resource"}
              </strong>
              {pages.map((sourcePage) => {
                const isTarget = targetPages.includes(sourcePage);
                const pageQuestions = resourceQuestions.filter(
                  (item) => item.anchor?.pageNumber === sourcePage,
                );
                return (
                  <div
                    className={isTarget ? "qaSourcePage current" : "qaSourcePage neighbor"}
                    key={`${resourceId}:${sourcePage}`}
                    ref={sourcePage === firstPageNumber ? currentPageRef : undefined}
                  >
                    <span>
                      {isTarget
                        ? pageQuestions
                            .map((item) => labelsByAnnotationId.get(item.id))
                            .filter(Boolean)
                            .join(" / ") || "Linked capture"
                        : sourcePage < (targetPages[0] ?? sourcePage)
                          ? "Previous"
                          : "Next"}{" "}
                      · p. {sourcePage}
                    </span>
                    <SourcePageImage
                      annotated={annotated}
                      focusQuestions={resourceQuestions}
                      pageNumber={sourcePage}
                      primaryPageNumber={targetPages[0] ?? sourcePage}
                      resourceId={resourceId}
                      onLoad={sourcePage === firstPageNumber ? focusCurrentPage : undefined}
                    />
                  </div>
                );
              })}
              {!pages.length
                ? resourceQuestions.map((question) => (
                    <div className="qaSourceText" key={question.id}>
                      <strong>{labelsByAnnotationId.get(question.id) ?? "Linked question"}</strong>
                      {metadataText(question, "contextBefore") ? (
                        <p>{metadataText(question, "contextBefore")}</p>
                      ) : null}
                      {question.anchor?.quote ? <blockquote>{question.anchor.quote}</blockquote> : null}
                      {metadataText(question, "contextAfter") ? (
                        <p>{metadataText(question, "contextAfter")}</p>
                      ) : null}
                    </div>
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function DiscussionQaReview({
  course,
  discussion,
  questionIds,
  scopeLabel,
  initialFilter,
  scopeKind,
  onAnnotationChange,
  onClose,
  onDeleteAnswer,
  onMapExerciseSolution,
  onToggleImportantAnswer,
  onQuestionLink,
  onQaViewed,
  onUpdateMessage,
}: DiscussionQaReviewProps) {
  const courseSections = useMemo(
    () =>
      course.discussions.flatMap((item) =>
        discussionQaSections(item, course.annotations),
      ),
    [course.annotations, course.discussions],
  );
  const [hiddenSectionIds, setHiddenSectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const annotationById = useMemo(
    () => new Map(course.annotations.map((item) => [item.id, item])),
    [course.annotations],
  );
  const resourceById = useMemo(
    () => new Map(course.resources.map((item) => [item.id, item])),
    [course.resources],
  );
  const labelsByAnnotationId = useMemo(() => {
    const labels = new Map(
      course.annotations.flatMap((annotation) =>
        annotation.stableLabel
          ? [[annotation.id, annotation.stableLabel] as const]
          : [],
      ),
    );
    course.discussions.forEach((item) =>
      item.questionLabels.forEach((label) =>
        label.annotationIds.forEach((annotationId) => {
          if (!labels.has(annotationId)) labels.set(annotationId, label.label);
        }),
      ),
    );
    const discussionMessageIds = new Set(
      discussion.messages.map((message) => message.id),
    );
    const linkedAnnotationIds = new Set(
      discussion.messages.flatMap((message) =>
        message.annotationLinks.map((link) => link.annotationId),
      ),
    );
    course.annotations.forEach((annotation) => {
      const label = annotation.anchor?.metadata?.promptLabel;
      if (
        annotation.origin === "discussion_review_followup" &&
        typeof label === "string" &&
        (discussionMessageIds.has(annotation.anchor?.discussionMessageId ?? "") ||
          linkedAnnotationIds.has(annotation.id))
      ) {
        const belongsToThisDiscussion = discussionMessageIds.has(
          annotation.anchor?.discussionMessageId ?? "",
        );
        const collidesWithLocalLabel = discussion.questionLabels.some(
          (item) =>
            item.label === label && !item.annotationIds.includes(annotation.id),
        );
        if (!belongsToThisDiscussion && collidesWithLocalLabel) return;
        if (!labels.has(annotation.id)) labels.set(annotation.id, label);
      }
    });
    return labels;
  }, [course.annotations, course.discussions, discussion.messages, discussion.questionLabels]);
  const messageById = useMemo(
    () =>
      new Map(
        course.discussions.flatMap((item) =>
          item.messages.map((message) => [message.id, message] as const),
        ),
      ),
    [course.discussions],
  );
  const qaReviewRecords = useMemo<QaReviewRecord[]>(
    () =>
      course.discussions.flatMap((item) =>
        item.qaReviews.map((review) => ({
          ...review,
          discussionId: item.id,
        })),
      ),
    [course.discussions],
  );
  const allItems = useMemo(
    () => {
      const items = qaReviewThreads(
        course.discussions,
        course.annotations,
        discussion,
        questionIds,
      );
      return items
        .map((item) => {
          const answers = (item.answers ?? []).filter(
            (answer) => !hiddenSectionIds.has(answer.section.id),
          );
          const latest = answers.at(-1);
          return {
            ...item,
            answers,
            section: latest?.section,
            sectionDiscussionId: latest?.discussionId,
          };
        });
    },
    [course.annotations, course.discussions, discussion, hiddenSectionIds, questionIds],
  );
  const editableMessageIds = useMemo(
    () =>
      new Set(
        allItems.flatMap((item) =>
          (item.answers ?? []).map((answer) => answer.section.messageId),
        ),
      ),
    [allItems],
  );
  const editableSections = useMemo(
    () =>
      courseSections.filter(
        (section) =>
          editableMessageIds.has(section.messageId) &&
          !hiddenSectionIds.has(section.id),
      ),
    [courseSections, editableMessageIds, hiddenSectionIds],
  );
  const sectionsByMessage = useMemo(
    () =>
      editableSections.reduce((groups, section) => {
        const current = groups.get(section.messageId) ?? [];
        current.push(section);
        groups.set(section.messageId, current);
        return groups;
      }, new Map<string, DiscussionQaSection[]>()),
    [editableSections],
  );
  const initialSectionDrafts = useMemo(
    () =>
      new Map(
        editableSections.map((section) => [section.id, section.bodyMarkdown]),
      ),
    [editableSections],
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
  const [reviewFilter, setReviewFilter] = useState<QaReviewFilter>(
    initialFilter ?? (questionIds?.length ? "all" : "open"),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedPulse, setSavedPulse] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [answerToDelete, setAnswerToDelete] = useState<{
    questionIds: string[];
    section: DiscussionQaSection;
  } | null>(null);
  const [confirmArchiveQuestion, setConfirmArchiveQuestion] = useState(false);
  const [editingFollowupId, setEditingFollowupId] = useState<string | null>(null);
  const [visitedItemIds, setVisitedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleItems = useMemo(
    () =>
      allItems.filter((item) =>
        qaReviewItemVisible(
          item,
          reviewFilter,
          qaReviewRecords,
          visitedItemIds.has(item.id),
        ),
      ),
    [
      allItems,
      qaReviewRecords,
      reviewFilter,
      visitedItemIds,
    ],
  );
  const boundedActiveIndex = Math.max(
    0,
    Math.min(activeIndex, Math.max(0, visibleItems.length - 1)),
  );
  const activeItem = visibleItems[boundedActiveIndex];
  const pendingViewsByItemId = useRef(
    new Map<string, { input: DiscussionQaViewInput; viewKey: string }>(),
  );
  const activeRootQuestions = useMemo(
    () =>
      activeItem
        ? canonicalQuestionCaptures(
            activeItem.rootQuestions ?? activeItem.questions.filter(
              (question) => question.origin !== "discussion_review_followup",
            ),
          )
        : [],
    [activeItem],
  );
  const activeFollowups = useMemo(
    () =>
      (activeItem?.questions ?? [])
        .filter(
          (question) => question.origin === "discussion_review_followup",
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        ),
    [activeItem],
  );
  const activeAnswerRecords = useMemo(
    () => activeItem?.answers ?? [],
    [activeItem],
  );
  const activeFollowupIdSet = useMemo(
    () => new Set(activeFollowups.map((followup) => followup.id)),
    [activeFollowups],
  );
  const rootAnswerRecords = useMemo(
    () =>
      activeAnswerRecords.filter(
        (answer) =>
          !answer.section.questionIds.some((id) => activeFollowupIdSet.has(id)),
      ),
    [activeAnswerRecords, activeFollowupIdSet],
  );
  const followupAnswersById = useMemo(
    () =>
      new Map(
        activeFollowups.map((followup) => [
          followup.id,
          activeAnswerRecords.filter((answer) =>
            answer.section.questionIds.includes(followup.id),
          ),
        ]),
      ),
    [activeAnswerRecords, activeFollowups],
  );
  const activeSourceQuestions = useMemo(() => {
    if (!activeItem) return [];
    const candidates = activeRootQuestions;
    return candidates.filter(
      (question, index) =>
        candidates.findIndex((candidate) => candidate.id === question.id) === index,
    );
  }, [activeItem, activeRootQuestions]);
  const activeChapterLabels = useMemo(
    () =>
      [
        ...new Map(
          activeRootQuestions.flatMap((question) => {
            const chapterNumber = annotationChapterNumber(question);
            if (chapterNumber === null) return [];
            return [
              [
                chapterNumber,
                { label: annotationChapter(question), number: chapterNumber },
              ] as const,
            ];
          }),
        ).values(),
      ],
    [activeRootQuestions],
  );
  const activeImportantNote = activeItem
    ? course.notes.find(
        (note) =>
          note.kind === "important_answer" &&
          note.links.some(
            (link) =>
              link.entityType === "annotation" &&
              activeItem.questions.some((question) => question.id === link.entityId),
          ),
      ) ?? (activeItem.section ? course.notes.find(
        (note) =>
          note.kind === "important_answer" &&
          note.document.plainText.includes(
            `qa-section:${activeItem.section!.messageId}:${activeItem.section!.label}`,
          ),
      ) ?? course.notes.find(
        (note) =>
          note.kind === "important_answer" &&
          note.links.some(
            (link) =>
              link.entityType === "discussion_message" &&
              link.entityId === activeItem.section!.messageId,
          ) &&
          (note.document.markdown ?? "").includes(
            `qa-section:${activeItem.section!.messageId}:${activeItem.section!.label}`,
          ),
      ) : undefined)
    : undefined;
  const activePriority = activeItem
    ? discussionPriority(
        activeAnswerRecords.map((answer) => answer.section.bodyMarkdown).join("\n\n"),
        activeRootQuestions,
      )
    : "medium";
  const activeSavedPriority = savedDiscussionPriority(activeRootQuestions);
  const reviewUnits = allItems;
  const scopeProgress = useMemo(
    () => qaReviewScopeProgress(allItems, questionIds, course.resources),
    [allItems, questionIds, course.resources],
  );
  const visitedUnits = reviewUnits.filter((item) =>
    !["new", "updated"].includes(
      qaReviewStatus(item, qaReviewRecords, visitedItemIds.has(item.id)),
    ),
  ).length;
  const [passNumber, setPassNumber] = useState(1);
  const [passVisited, setPassVisited] = useState<Set<string>>(() => new Set());
  const [passTargets, setPassTargets] = useState(() => visibleItems.map(item => item.id));
  const [understandingTargets, setUnderstandingTargets] = useState(() => new Set(scopeProgress.questions.filter(q => q.status === "open").map(q => q.id)));
  const liveTargets = passTargets.filter(id => allItems.some(item => item.id === id));
  const passReadCount = liveTargets.filter(id => passVisited.has(id)).length;
  const currentUnderstandingTargets = scopeProgress.questions.filter(q => understandingTargets.has(q.id) && q.status !== "setAside");
  const gainedUnderstanding = currentUnderstandingTargets.filter(q => q.status === "understood").length;
  const setAside = scopeProgress.total - scopeProgress.open - scopeProgress.understood;

  function changeFilter(filter: QaReviewFilter) {
    setReviewFilter(filter);
    setPassTargets(allItems.filter(item => qaReviewItemVisible(item, filter, qaReviewRecords)).map(item => item.id));
  }
  function restartPass() {
    setPassNumber(number => number + 1);
    setPassVisited(new Set());
    if (!visibleItems.length) changeFilter("all");
    setPassTargets((visibleItems.length ? visibleItems : allItems).map(item => item.id));
    setUnderstandingTargets(new Set(scopeProgress.questions.filter(q => q.status === "open").map(q => q.id)));
    setActiveIndex(0);
  }
  useEffect(() => {
    if (!activeItem) return;
    const timer = window.setTimeout(() => setPassVisited(current => {
      if (current.has(activeItem.id)) return current;
      return new Set([...current, activeItem.id]);
    }), 700);
    return () => window.clearTimeout(timer);
  }, [activeItem, passNumber]);

  const statusForItem = useCallback(
    (item: QaReviewItem | undefined) =>
      qaReviewStatus(
        item,
        qaReviewRecords,
        Boolean(item && visitedItemIds.has(item.id)),
      ),
    [qaReviewRecords, visitedItemIds],
  );
  const activeReviewStatus = statusForItem(activeItem);
  const maximumSectionOpen = Math.max(
    1,
    ...scopeProgress.sections.map((section) => section.open),
  );

  useEffect(() => {
    if (!activeItem?.section || !activeItem.questions.length) return;
    const fingerprint = qaSectionFingerprint(activeItem.section);
    const viewKey = `${activeItem.section.messageId}:${activeItem.section.id}:${fingerprint}`;
    if (pendingViewsByItemId.current.get(activeItem.id)?.viewKey === viewKey) {
      return;
    }
    const questionIds = activeItem.questions.map((question) => question.id);
    const timer = window.setTimeout(() => {
      pendingViewsByItemId.current.set(activeItem.id, {
        input: {
          discussionId: activeItem.sectionDiscussionId ?? discussion.id,
          messageId: activeItem.section!.messageId,
          questionIds,
          sectionFingerprint: fingerprint,
          sectionId: activeItem.section!.id,
        },
        viewKey,
      });
      setVisitedItemIds((current) => new Set([...current, activeItem.id]));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeItem, discussion.id]);

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

  const navigateTo = useCallback(
    (nextIndex: number) => {
      const bounded = Math.max(
        0,
        Math.min(nextIndex, Math.max(0, visibleItems.length - 1)),
      );
      setActiveIndex(bounded);
    },
    [visibleItems],
  );

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
      navigateTo(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
    }
    window.addEventListener("keydown", navigateWithKeyboard);
    return () => window.removeEventListener("keydown", navigateWithKeyboard);
  }, [activeIndex, navigateTo]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function setSectionDraft(sectionId: string, markdown: string) {
    setSectionDrafts((current) => {
      const next = new Map(current);
      next.set(sectionId, markdown);
      return next;
    });
  }

  function setSectionReviewItems(
    sectionId: string,
    items: DiscussionReviewItem[],
  ) {
    setReviewItemsBySection((current) => {
      const next = new Map(current);
      next.set(sectionId, items);
      return next;
    });
  }

  async function saveSession(
    activeSectionId?: string,
    activeMarkdown?: string,
    activeReviewItems?: DiscussionReviewItem[],
  ) {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true); setSaveError("");
    const drafts = new Map(sectionDrafts);
    const reviewItems = new Map(reviewItemsBySection);
    if (activeSectionId && activeMarkdown !== undefined) {
      drafts.set(activeSectionId, activeMarkdown);
    }
    if (activeSectionId && activeReviewItems !== undefined) {
      reviewItems.set(activeSectionId, activeReviewItems);
    }
    const nextSaved = new Map(savedMessageMarkdown);
    try {
    for (const [messageId, messageSections] of sectionsByMessage) {
      const message = messageById.get(messageId);
      if (!message) continue;
      const rebuilt = reconstructQaMessage(messageSections, drafts);
      const messageReviewItems = messageSections.flatMap((section) => {
        const rootQuestionIds = section.questionIds.flatMap((questionId) => {
          const question = annotationById.get(questionId);
          const storedRoots = question?.anchor?.metadata?.rootQuestionIds;
          return Array.isArray(storedRoots)
            ? storedRoots.filter((id): id is string => typeof id === "string")
            : [questionId];
        });
        return (reviewItems.get(section.id) ?? []).map((item) => ({
          ...item,
          fromPosition: undefined,
          toPosition: undefined,
          sectionLabel: section.label,
          questionIds: [...new Set(rootQuestionIds)],
        }));
      });
      if (
        rebuilt.markdown !== (savedMessageMarkdown.get(messageId) ?? "") ||
        messageReviewItems.length
      ) {
        const result = await onUpdateMessage(message, rebuilt.markdown, messageReviewItems);
        if (result === false) throw new Error("Some changes could not be saved. Your remaining drafts are still here.");
        nextSaved.set(messageId, rebuilt.markdown);
        setSavedMessageMarkdown(new Map(nextSaved));
        for (const section of messageSections) reviewItems.delete(section.id);
        setReviewItemsBySection(new Map(reviewItems));
      }
    }
    setSectionDrafts(drafts);
    setSavedMessageMarkdown(nextSaved);
    setReviewItemsBySection(new Map());
    setSavedPulse(true);
    window.setTimeout(() => setSavedPulse(false), 1_500);
    return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed. Your drafts are still here.");
      return false;
    } finally {
      setEditorGeneration((current) => current + 1);
      savingRef.current = false; setSaving(false);
    }
  }

  function requestClose() {
    if (hasUnsavedChanges) {
      setConfirmClose(true);
      return;
    }
    closeSession();
  }

  function closeSession() {
    const views = [...pendingViewsByItemId.current.values()].map(
      ({ input }) => input,
    );
    pendingViewsByItemId.current.clear();
    if (views.length) onQaViewed(views);
    onClose();
  }

  function removeAnswer(
    section: DiscussionQaSection,
    linkedQuestionIds: string[],
    archiveQuestions = false,
  ) {
    const message = messageById.get(section.messageId);
    if (!message) return;
    const remainingSections = (sectionsByMessage.get(section.messageId) ?? []).filter(
      (candidate) => candidate.id !== section.id,
    );
    const rebuilt = reconstructQaMessage(remainingSections, sectionDrafts);
    onDeleteAnswer(
      message,
      rebuilt.markdown,
      linkedQuestionIds,
      archiveQuestions,
    );
    setHiddenSectionIds((current) => new Set([...current, section.id]));
    setSavedMessageMarkdown((current) => {
      const next = new Map(current);
      next.set(section.messageId, rebuilt.markdown);
      return next;
    });
    setAnswerToDelete(null);
    setConfirmArchiveQuestion(false);
    setActiveIndex((current) => Math.max(0, current - 1));
  }

  const content = (
    <div className="qaReviewBackdrop">
      <main className="qaReviewSession" role="dialog" aria-modal="true" aria-labelledby="qa-review-title" aria-busy={saving} inert={saving}>
        <header className="qaReviewHeader">
          <div className="qaReviewTitle">
            <div className="qaReviewHeadingLine">
              <span className="qaReviewBadge"><BookOpen size={14} /> Q&A</span>
              <p id="qa-review-title" title={scopeLabel ?? discussion.title}>
                {scopeLabel ?? discussion.title}
              </p>
            </div>
            <div className="qaReviewScopeStats" aria-label="Questions in this scope">
              <span className={scopeProgress.open ? "qaScopeOpen" : "qaScopeClear"}>
                <b>{scopeProgress.open}</b> open
              </span>
              <span><CheckCircle2 size={13} /><b>{scopeProgress.understood}</b> understood</span>
              <span>{scopeProgress.total} total {scopeKind === "task" ? "in task" : "in scope"}</span>
            </div>
          </div>
          <div className="qaReviewProgressBlock">
            {scopeProgress.sections.length > 0 ? (
              <div className="qaReviewSectionMap">
                <span>Jump to · open</span>
                <div>
                  {scopeProgress.sections.map((section) => {
                    const current = Boolean(activeItem && section.itemIds.includes(activeItem.id));
                    const heatLevel = section.open === 0
                      ? 0
                      : Math.max(1, Math.ceil((section.open / maximumSectionOpen) * 4));
                    return (
                      <button
                        type="button"
                        data-track="qa.group"
                        aria-current={current ? "true" : undefined}
                        aria-label={`Go to ${section.title}: ${section.open} open of ${section.total}`}
                        className={`qaReviewSectionCell heat${heatLevel}${current ? " current" : ""}`}
                        key={section.id}
                        title={`${section.title} · ${section.open} open of ${section.total}${!section.open ? " · opens all questions" : ""}`}
                        onClick={() => {
                          const target = qaGroupNavigationTarget(section, visibleItems, allItems);
                          if (!target) return;
                          if (target.showAll) changeFilter("all");
                          setActiveIndex(target.index);
                        }}
                      >
                        <small>{section.label}</small>
                        <strong>{section.open}</strong>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="qaReviewProgressLabels">
              <span>
                {visibleItems.length
                  ? `Reviewing ${reviewFilter === "all" ? "" : `${reviewFilter} `}group ${boundedActiveIndex + 1} of ${visibleItems.length}`
                  : reviewFilter === "new"
                    ? "New queue clear"
                    : reviewFilter === "open"
                      ? "Open queue clear"
                      : "No review groups"}
              </span>
              <span title="Saved reading history is kept across passes">{visitedUnits}/{reviewUnits.length} seen overall</span>
            </div>
            <div className="qaPassProgress">
              <StudyPassProgress
                label={`Reading pass ${passNumber}`} done={passReadCount} total={liveTargets.length}
                onRestart={restartPass}
                detail={!liveTargets.length ? "Start a new pass to read the answers again" : passReadCount === liveTargets.length
                  ? "Reading pass complete. Keep your notes, or start another pass."
                  : `${Math.max(0, liveTargets.length - passReadCount)} groups left in this pass`}
              />
              <StudyPassProgress
                label={understandingTargets.size ? "Understanding this pass" : "Understood overall"} tone="understood"
                done={understandingTargets.size ? gainedUnderstanding : scopeProgress.understood}
                total={understandingTargets.size ? currentUnderstandingTargets.length : scopeProgress.understood + scopeProgress.open}
                detail={`${gainedUnderstanding ? `+${gainedUnderstanding} understood this pass · ` : ""}${scopeProgress.open ? `${scopeProgress.open} still open` : "Open queue complete"}${setAside ? ` · ${setAside} set aside` : ""}`}
              />
            </div>
          </div>
          {saveError ? <p className="editorSaveError" role="alert">{saveError}</p> : null}
          <div className="qaReviewHeaderActions">
            <label className="qaReviewFilter">
              <span>Show</span>
              <select
                aria-label="QA review filter" data-track="qa.filter"
                onChange={(event) => {
                  changeFilter(event.target.value as QaReviewFilter);
                  setActiveIndex(0);
                }}
                value={reviewFilter}
              >
                <option value="new">New & updated</option>
                <option value="open">Open questions</option>
                <option value="all">All answers</option>
              </select>
            </label>
            <button
              aria-label={savedPulse ? "Session saved" : "Save QA session"}
              className={`commandButton qaSaveAll ${savedPulse ? "saved" : ""}`}
              disabled={saving || !hasUnsavedChanges}
              onClick={() => saveSession()}
              type="button"
            >
              {savedPulse ? <CheckCircle2 size={15} /> : <Save size={15} />}
              <span>{saving ? "Saving…" : savedPulse ? "Saved" : `Save session${pendingReviewCount ? ` · ${pendingReviewCount}` : ""}`}</span>
            </button>
            <button
              aria-label="Close QA review" data-track="qa.close"
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
            {activeRootQuestions.some(q => q.anchor?.metadata?.taskNoteId) ? (
              <section className="qaSourcePanel taskReviewSource">
                <header><span>Original task &amp; your work</span><small>Snapshot when the review was inserted</small></header>
                <div className="qaSourcePages">{activeRootQuestions.filter(q => q.anchor?.metadata?.taskNoteId).map(q => (
                  <MarkdownMath key={q.id}>{q.body?.markdown ?? q.body?.plainText ?? q.anchor?.quote ?? ""}</MarkdownMath>
                ))}</div>
              </section>
            ) : <SourcePreview
              key={activeItem.id}
              labelsByAnnotationId={labelsByAnnotationId}
              questions={activeSourceQuestions.length ? activeSourceQuestions : activeItem.questions}
              resourceById={resourceById}
            />}
            <section className={`qaAnswerPanel priority-${activePriority}${activeImportantNote ? " importantQuestion" : ""}`}>
              <header className="qaAnswerHeading">
                <div className="qaAnswerIdentity">
                  <span className="qaResponseTag">
                    Question thread · {activeAnswerRecords.length} tutor answer{activeAnswerRecords.length === 1 ? "" : "s"}
                    {activeFollowups.length
                      ? ` · ${activeFollowups.length} follow-up${activeFollowups.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                  <h2>
                    {activeRootQuestions
                      .map((question) => labelsByAnnotationId.get(question.id))
                      .filter(Boolean)
                      .join(" / ") || activeItem.section?.title || "Unmapped question"}
                  </h2>
                  {activeChapterLabels.length ? (
                    <div className="qaChapterTags">
                      {activeChapterLabels.map((chapter, index) => (
                        <span
                          className="qaChapterTag"
                          key={chapter.number}
                          style={{ "--chapter-tone": index % 6 } as CSSProperties}
                          title={chapter.label}
                        >
                          Chapter {chapter.number}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="qaAnswerActions">
                  {activeRootQuestions.length ? (
                    <label className="qaPriorityControl">
                      <span className={`qaPriorityBadge priority-${activePriority}`}>
                        {discussionPriorityLabel(activePriority)}
                      </span>
                      <select
                        aria-label="Question priority"
                        onChange={(event) => {
                          const discussionPriority = event.target.value as Annotation["discussionPriority"];
                          trackedQuestionGroups(activeRootQuestions).forEach((group) =>
                            onAnnotationChange(group.annotations[0], { discussionPriority }),
                          );
                        }}
                        title="Auto follows the tutor’s wording. Your choice overrides it everywhere."
                        value={activeSavedPriority}
                      >
                        <option value="auto">Auto · tutor guidance</option>
                        <option value="core">Core</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                  ) : null}
                  {activeItem.section ? (
                    <button
                      className={activeImportantNote ? "qaImportantAnswer active" : "qaImportantAnswer"}
                      onClick={() =>
                        onToggleImportantAnswer({
                          existingNote: activeImportantNote,
                          markdown:
                            sectionDrafts.get(activeItem.section!.id) ??
                            activeItem.section!.bodyMarkdown,
                          messageId: activeItem.section!.messageId,
                          questionIds: activeItem.questions.map((question) => question.id),
                          sectionLabel: activeItem.section!.label,
                          title: activeItem.section!.title,
                        })
                      }
                      title={activeImportantNote ? "Unpin this important question" : "Pin this question and answer to the top"}
                      type="button"
                    >
                      <BookMarked size={14} />
                      {activeImportantNote ? "Pinned" : "Pin important"}
                    </button>
                  ) : null}
                  {activeItem.section && activeItem.questions.length ? (
                    <button
                      aria-label="Archive this question and remove its tutor answer"
                      className="qaArchiveQuestion"
                      disabled={hasUnsavedChanges}
                      onClick={() => setConfirmArchiveQuestion(true)}
                      title={
                        hasUnsavedChanges
                          ? "Save the QA session before archiving a question"
                          : "Archive this question and remove its tutor answer"
                      }
                      type="button"
                    >
                      <Archive size={14} /> Archive question
                    </button>
                  ) : null}
                  {activeItem.questions.length ? (
                    <button
                      className={
                        unresolvedQuestionsAreSkipped(activeItem.questions)
                          ? "qaSkipQuestion skipped"
                          : "qaSkipQuestion"
                      }
                      onClick={() => {
                        const allSkipped = unresolvedQuestionsAreSkipped(
                          activeItem.questions,
                        );
                        for (const question of activeItem.questions) {
                          if (allSkipped) {
                            onAnnotationChange(question, { skipped: false });
                          } else if (question.status !== "answered") {
                            onAnnotationChange(question, { skipped: true });
                          }
                        }
                      }}
                      title="Keep the question and answer history, but remove it from the active review queue"
                      type="button"
                    >
                      <ArrowRight size={15} />
                      {unresolvedQuestionsAreSkipped(activeItem.questions)
                        ? "Skipped"
                        : "Skip"}
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
                      data-track="qa.understood"
                      onClick={() => {
                        setPassVisited(current => new Set([...current, activeItem.id]));
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
              {activeItem.questions.length && !activeRootQuestions.some(q => q.anchor?.metadata?.taskNoteId) ? (
                <section className="qaQuestionPrompt">
                  <span>
                    <CircleHelp size={13} />
                    {activeRootQuestions.some(question => question.origin === "discussion_review_source") ? "Review source" : "Original question"}
                    {activeRootQuestions.length > 1
                      ? ` · ${activeRootQuestions.length} linked captures`
                      : ""}
                    <em className={`qaReviewStatus ${activeReviewStatus}`}>
                      {activeReviewStatus}
                    </em>
                  </span>
                  {activeRootQuestions.map((question) => (
                    <div className="qaMappedQuestion" key={question.id}>
                      <small>{labelsByAnnotationId.get(question.id) ?? "Linked capture"}</small>
                      <MarkdownMath>{annotationDisplayText(question)}</MarkdownMath>
                    </div>
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
              {activeAnswerRecords.length ? (
                <section className="qaThreadTimeline">
                  {rootAnswerRecords.map((answer, index) => (
                    <article className="qaTimelineAnswer" key={answer.section.id}>
                      <header>
                        <span className="qaTutorTag">Tutor · answer {index + 1}</span>
                        <small>Response #{answer.section.messageSequenceNumber}</small>
                        <button
                          aria-label={`Delete tutor answer ${index + 1}`}
                          disabled={hasUnsavedChanges}
                          onClick={() =>
                            setAnswerToDelete({
                              questionIds: answer.section.questionIds.length
                                ? answer.section.questionIds
                                : activeRootQuestions.map((question) => question.id),
                              section: answer.section,
                            })
                          }
                          title={
                            hasUnsavedChanges
                              ? "Save the QA session before deleting an answer"
                              : "Delete only this answer version"
                          }
                          type="button"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </header>
                      <DiscussionMarkdownSurface
                        className="qaAnswerEditor"
                        editable
                        key={`${answer.section.id}:${editorGeneration}`}
                        markdown={
                          sectionDrafts.get(answer.section.id) ??
                          answer.section.bodyMarkdown
                        }
                        initialReviewItems={reviewItemsBySection.get(answer.section.id)}
                        onCancel={requestClose}
                        onChange={(markdown) =>
                          setSectionDraft(answer.section.id, markdown)
                        }
                        onReviewItemsChange={(items) =>
                          setSectionReviewItems(answer.section.id, items)
                        }
                        onSave={(markdown, items) =>
                          saveSession(answer.section.id, markdown, items)
                        }
                        placeholder="Refine the answer, highlight the useful parts, or select text and press ⌘D for a follow-up…"
                        reviewMode
                        showActions={false}
                      />
                    </article>
                  ))}
                  {activeFollowups.map((followup, followupIndex) => {
                    const answers = followupAnswersById.get(followup.id) ?? [];
                    const done = followup.status === "answered";
                    return (
                      <details
                        className={`qaFollowupExchange${done ? " completed" : ""}`}
                        key={`${followup.id}:${done}`}
                        open={!done}
                      >
                        <summary>
                          <ChevronDown size={15} />
                          <span>
                            <strong>
                              {labelsByAnnotationId.get(followup.id) ??
                                `Follow-up ${followupIndex + 1}`}
                            </strong>
                            <small>
                              {done
                                ? "Done · click to expand"
                                : answers.length
                                  ? `${answers.length} mapped answer${answers.length === 1 ? "" : "s"}`
                                  : "Awaiting tutor"}
                            </small>
                          </span>
                          <p>{annotationDisplayText(followup)}</p>
                          <div className="qaFollowupActions">
                            <button
                              className={done ? "done" : ""}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onAnnotationChange(followup, {
                                  status: done ? "open" : "answered",
                                });
                              }}
                              type="button"
                            >
                              <CheckCircle2 size={12} /> {done ? "Reopen" : "Done"}
                            </button>
                            <button
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setEditingFollowupId(followup.id);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="danger"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onAnnotationChange(followup, { status: "archived" });
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </summary>
                        <div className="qaFollowupContent">
                        <article className="qaFollowupMessage">
                          {followup.anchor?.quote ? (
                            <blockquote>
                              <MarkdownMath>{followup.anchor.quote}</MarkdownMath>
                            </blockquote>
                          ) : null}
                          {editingFollowupId === followup.id ? (
                            <DiscussionMarkdownSurface
                              editable
                              markdown={annotationDisplayText(followup)}
                              onCancel={() => setEditingFollowupId(null)}
                              onSave={(markdown) => {
                                onAnnotationChange(followup, {
                                  markdown,
                                  plainText: markdown,
                                });
                                setEditingFollowupId(null);
                              }}
                              placeholder="Refine this follow-up question…"
                            />
                          ) : (
                            <MarkdownMath>{annotationDisplayText(followup)}</MarkdownMath>
                          )}
                        </article>
                        {answers.length ? (
                          answers.map((answer, answerIndex) => (
                            <article
                              className="qaTimelineAnswer followupAnswer"
                              key={answer.section.id}
                            >
                              <header>
                                <span className="qaTutorTag">
                                  Tutor · follow-up answer {answerIndex + 1}
                                </span>
                                <small>
                                  Response #{answer.section.messageSequenceNumber}
                                </small>
                                <button
                                  aria-label={`Delete follow-up answer ${answerIndex + 1}`}
                                  disabled={hasUnsavedChanges}
                                  onClick={() =>
                                    setAnswerToDelete({
                                      questionIds: [followup.id],
                                      section: answer.section,
                                    })
                                  }
                                  title={
                                    hasUnsavedChanges
                                      ? "Save the QA session before deleting an answer"
                                      : "Delete only this follow-up answer version"
                                  }
                                  type="button"
                                >
                                  <Trash2 size={13} /> Delete
                                </button>
                              </header>
                              <DiscussionMarkdownSurface
                                className="qaAnswerEditor"
                                editable
                                key={`${answer.section.id}:${editorGeneration}`}
                                markdown={
                                  sectionDrafts.get(answer.section.id) ??
                                  answer.section.bodyMarkdown
                                }
                                initialReviewItems={reviewItemsBySection.get(answer.section.id)}
                                onCancel={requestClose}
                                onChange={(markdown) =>
                                  setSectionDraft(answer.section.id, markdown)
                                }
                                onReviewItemsChange={(items) =>
                                  setSectionReviewItems(answer.section.id, items)
                                }
                                onSave={(markdown, items) =>
                                  saveSession(answer.section.id, markdown, items)
                                }
                                placeholder="Refine this answer, highlight it, or ask another follow-up…"
                                reviewMode
                                showActions={false}
                              />
                            </article>
                          ))
                        ) : (
                          <p className="qaAwaitingFollowup">
                            Awaiting a tutor response to this follow-up.
                          </p>
                        )}
                        </div>
                      </details>
                    );
                  })}
                </section>
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
            <h2>{scopeProgress.open ? "Reading queue complete" : "Open queue complete"}</h2>
            <p>
              Your saved answers and notes are here whenever you want another pass.
            </p>
            <button className="commandButton" onClick={() => {
              changeFilter("all");
              setPassVisited(new Set());
              setPassNumber(number => number + 1);
              setUnderstandingTargets(new Set(scopeProgress.questions.filter(q => q.status === "open").map(q => q.id)));
              setActiveIndex(0);
            }} type="button"><BookOpen size={16} /> Read all answers again</button>
          </section>
        )}

        <footer className="qaReviewNavigation">
          <button
            disabled={boundedActiveIndex <= 0}
            data-track="qa.previous" onClick={() => navigateTo(boundedActiveIndex - 1)}
            type="button"
          >
            <ArrowLeft size={18} /> Previous
            {visibleItems[boundedActiveIndex - 1] ? (
              <small>{statusForItem(visibleItems[boundedActiveIndex - 1])}</small>
            ) : null}
          </button>
          <span>⌘⌥ ← / → to navigate</span>
          <button
            disabled={boundedActiveIndex >= visibleItems.length - 1}
            data-track="qa.next" onClick={() => navigateTo(boundedActiveIndex + 1)}
            type="button"
          >
            {visibleItems[boundedActiveIndex + 1] ? (
              <small>{statusForItem(visibleItems[boundedActiveIndex + 1])}</small>
            ) : null}
            Next <ArrowRight size={18} />
          </button>
        </footer>
      </main>
      {confirmClose ? (
        <ConfirmDialog
          confirmLabel="Discard edits"
          description="The answer edits and queued highlights or follow-ups in this QA session have not been saved."
          onCancel={() => setConfirmClose(false)}
          onConfirm={closeSession}
          title="Close without saving?"
        />
      ) : null}
      {answerToDelete ? (
        <ConfirmDialog
          confirmLabel="Delete answer"
          description="Only this answer version will be removed. Other answers and follow-ups in this question thread stay intact."
          onCancel={() => setAnswerToDelete(null)}
          onConfirm={() =>
            removeAnswer(
              answerToDelete.section,
              answerToDelete.questionIds,
              false,
            )
          }
          title="Delete this answer version?"
        />
      ) : null}
      {confirmArchiveQuestion ? (
        <ConfirmDialog
          confirmLabel="Archive question"
          description="This question thread will leave the active queue and this tutor answer will be removed from the discussion. Use this for questions that are no longer useful."
          onCancel={() => setConfirmArchiveQuestion(false)}
          onConfirm={() => {
            if (!activeItem?.section) return;
            removeAnswer(
              activeItem.section,
              activeItem.questions.map((question) => question.id),
              true,
            );
          }}
          title="Archive this question and answer?"
        />
      ) : null}
    </div>
  );

  return createPortal(content, document.body);
}
