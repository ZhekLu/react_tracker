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
  ImportantAnswerInput,
} from "../../types/tracker";
import {
  inferredExerciseLabels,
  qaReviewThreads,
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
  onQaViewed: (
    discussionId: string,
    messageId: string,
    questionIds: string[],
  ) => void;
  onMapExerciseSolution: (input: ExerciseSolutionMappingInput) => void;
  onToggleImportantAnswer: (input: ImportantAnswerInput) => void;
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

type FollowupTrailEntry = {
  answerMarkdown: string;
  followup: Annotation;
  originalQuestions: Annotation[];
  responseTitle: string;
  selectedContext: string;
};

function comparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function followupTrail(
  course: Course,
  current: Annotation,
): FollowupTrailEntry[] {
  const annotationById = new Map(course.annotations.map((item) => [item.id, item]));
  const entries: FollowupTrailEntry[] = [];
  const seen = new Set<string>();
  let followup: Annotation | undefined = current;
  while (
    followup?.origin === "discussion_review_followup" &&
    followup.anchor?.discussionMessageId &&
    !seen.has(followup.id)
  ) {
    seen.add(followup.id);
    const parentDiscussion = course.discussions.find((discussion) =>
      discussion.messages.some(
        (message) => message.id === followup?.anchor?.discussionMessageId,
      ),
    );
    if (!parentDiscussion) break;
    const selected = comparableText(followup.anchor.quote ?? "");
    const storedSectionLabel: unknown = followup.anchor.metadata?.sectionLabel;
    const storedRootQuestionIds: unknown =
      followup.anchor.metadata?.rootQuestionIds;
    const candidates = discussionQaSections(
      parentDiscussion,
      course.annotations,
    ).filter(
      (section) =>
        section.messageId === followup?.anchor?.discussionMessageId,
    );
    const parentSection: DiscussionQaSection | undefined =
      (typeof storedSectionLabel === "string"
        ? candidates.find((section) => section.label === storedSectionLabel)
        : undefined) ??
      candidates.find((section) => {
        const body = comparableText(section.bodyMarkdown);
        return selected.length > 12 && body.includes(selected.slice(0, 80));
      });
    if (!parentSection) break;
    const rootQuestionIds: string[] = Array.isArray(storedRootQuestionIds)
      ? storedRootQuestionIds.filter(
          (id: unknown): id is string => typeof id === "string",
        )
      : parentSection.questionIds;
    const originalQuestions: Annotation[] = rootQuestionIds
      .map((id) => annotationById.get(id))
      .filter((item): item is Annotation => Boolean(item));
    entries.unshift({
      answerMarkdown: parentSection.bodyMarkdown,
      followup,
      originalQuestions,
      responseTitle: parentSection.title,
      selectedContext: followup.anchor.quote ?? "",
    });
    followup = originalQuestions.find(
      (question) => question.origin === "discussion_review_followup",
    );
  }
  return entries;
}

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
    task.notes.some(
      (note) =>
        note.kind === "exercise_solution" &&
        (
          note.links.some(
            (link) =>
              link.entityType === "annotation" &&
              item.questions.some((question) => question.id === link.entityId),
          ) ||
          initialLabels.every((label) =>
            (note.document.markdown ?? note.document.plainText).includes(label),
          )
        ),
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
  resourceById,
  labelsByAnnotationId,
}: {
  questions: Annotation[];
  resourceById: Map<string, Resource>;
  labelsByAnnotationId: Map<string, string>;
}) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef<HTMLDivElement>(null);
  const sourceQuestions = questions.filter(
    (question, index) =>
      questions.findIndex((candidate) => candidate.id === question.id) === index,
  );
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
  onAnnotationChange,
  onClose,
  onDeleteAnswer,
  onMapExerciseSolution,
  onToggleImportantAnswer,
  onQuestionLink,
  onQaViewed,
  onUpdateMessage,
}: DiscussionQaReviewProps) {
  const parsedSections = useMemo(
    () => discussionQaSections(discussion, course.annotations),
    [course.annotations, discussion],
  );
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
    const labels = new Map<string, string>();
    course.discussions.forEach((item) =>
      item.questionLabels.forEach((label) =>
        label.annotationIds.forEach((annotationId) =>
          labels.set(annotationId, label.label),
        ),
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
        labels.set(annotation.id, label);
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
  const qaReviewByAnnotationId = useMemo(
    () =>
      new Map(
        course.discussions.flatMap((item) =>
          item.qaReviews.map((review) => [review.annotationId, review] as const),
        ),
      ),
    [course.discussions],
  );
  const allItems = useMemo(
    () =>
      qaReviewThreads(course.discussions, course.annotations, discussion).filter(
        (item) =>
          !item.answers?.every((answer) => hiddenSectionIds.has(answer.section.id)),
      ),
    [course.annotations, course.discussions, discussion, hiddenSectionIds],
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
  const [openQuestionsOnly, setOpenQuestionsOnly] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [savedPulse, setSavedPulse] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDeleteAnswer, setConfirmDeleteAnswer] = useState(false);
  const [editingFollowupId, setEditingFollowupId] = useState<string | null>(null);
  const visibleItems = useMemo(
    () =>
      openQuestionsOnly
        ? allItems.filter(
            (item) =>
              !item.questions.length ||
              inferredExerciseLabels(item).some((label) =>
                /^Exercise\s+\d/i.test(label),
              ) ||
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
  const [visitedItemIds, setVisitedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const reportedViewKeys = useRef(new Set<string>());
  const activeFollowupTrail = useMemo(() => {
    const entries =
      activeItem?.questions
        .filter((question) => question.origin === "discussion_review_followup")
        .flatMap((question) => followupTrail(course, question)) ?? [];
    return entries.filter(
      (entry, index) =>
        entries.findIndex((candidate) => candidate.followup.id === entry.followup.id) ===
        index,
    );
  }, [activeItem, course]);
  const activeSourceQuestions = useMemo(() => {
    if (!activeItem) return [];
    const candidates = [
      ...(activeItem.rootQuestions ?? activeItem.questions.filter(
        (question) => question.origin !== "discussion_review_followup",
      )),
      ...activeFollowupTrail.flatMap((entry) => entry.originalQuestions),
    ];
    return candidates.filter(
      (question, index) =>
        candidates.findIndex((candidate) => candidate.id === question.id) === index,
    );
  }, [activeFollowupTrail, activeItem]);
  const activeImportantNote = activeItem?.section
    ? course.notes.find(
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
      )
    : undefined;
  const reviewUnits = allItems;
  const visitedUnits = reviewUnits.filter((item) =>
    visitedItemIds.has(item.id) ||
    (item.questions.length > 0 &&
      item.questions.every((question) =>
        qaReviewByAnnotationId.has(question.id),
      )),
  ).length;
  const remainingOpenQuestions = course.stats.openQuestionCount;
  const completionRatio = reviewUnits.length
    ? visitedUnits / reviewUnits.length
    : 0;

  const statusForItem = useCallback(
    (item: QaReviewItem | undefined) => {
      if (!item) return "new" as const;
      const isFollowup = item.questions.some(
        (question) => question.origin === "discussion_review_followup",
      );
      const message = item.section
        ? messageById.get(item.section.messageId)
        : undefined;
      const reviews = item.questions
        .map((question) => qaReviewByAnnotationId.get(question.id))
        .filter((review): review is Discussion["qaReviews"][number] =>
          Boolean(review),
        );
      const hasEarlierVersion = Boolean(
        (item.answers?.length ?? 0) > 1 ||
          (item.section &&
            parsedSections.some(
              (section) =>
                section.id !== item.section!.id &&
                section.messageSequenceNumber < item.section!.messageSequenceNumber &&
                section.questionIds.some((id) =>
                  item.questions.some((question) => question.id === id),
                ),
            )),
      );
      const answerChanged = Boolean(
        message &&
          reviews.some(
            (review) =>
              review.messageId !== message.id ||
              review.messageRevision < message.revision,
          ),
      );
      if (
        answerChanged ||
        ((isFollowup || hasEarlierVersion) && !reviews.length)
      ) {
        return "updated" as const;
      }
      const wasReviewed =
        reviews.length === item.questions.length || visitedItemIds.has(item.id);
      if (
        wasReviewed &&
        item.questions.length &&
        item.questions.every((question) => question.status === "answered")
      ) {
        return "understood" as const;
      }
      if (wasReviewed) {
        return "viewed" as const;
      }
      return "new" as const;
    },
    [messageById, parsedSections, qaReviewByAnnotationId, visitedItemIds],
  );
  const activeReviewStatus = statusForItem(activeItem);

  useEffect(() => {
    if (!activeItem?.section || !activeItem.questions.length) return;
    const viewKey = `${activeItem.section.messageId}:${activeItem.section.id}`;
    if (reportedViewKeys.current.has(viewKey)) return;
    reportedViewKeys.current.add(viewKey);
    const questionIds = activeItem.questions.map((question) => question.id);
    const timer = window.setTimeout(() => {
      onQaViewed(
        activeItem.sectionDiscussionId ?? discussion.id,
        activeItem.section!.messageId,
        questionIds,
      );
      setVisitedItemIds((current) => new Set([...current, activeItem.id]));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeItem, discussion.id, onQaViewed]);

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
        const rootQuestionIds = section.questionIds.flatMap((questionId) => {
          const question = annotationById.get(questionId);
          const storedRoots = question?.anchor?.metadata?.rootQuestionIds;
          return Array.isArray(storedRoots)
            ? storedRoots.filter((id): id is string => typeof id === "string")
            : [questionId];
        });
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
          sectionLabel: section.label,
          questionIds: [...new Set(rootQuestionIds)],
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
                {visitedUnits} of {reviewUnits.length} groups reviewed in this response
              </strong>
              <small>{remainingOpenQuestions} questions still open overall</small>
            </div>
          </div>
          <div className="qaReviewProgressBlock">
            <div className="qaReviewProgressLabels">
              <span>
                {visibleItems.length
                  ? `Reviewing ${openQuestionsOnly ? "open " : ""}group ${boundedActiveIndex + 1} of ${visibleItems.length}`
                  : "All clear"}
              </span>
              <strong>{Math.round(completionRatio * 100)}% reviewed</strong>
            </div>
            <div
              aria-label="Current response groups reviewed"
              aria-valuemax={reviewUnits.length}
              aria-valuemin={0}
              aria-valuenow={visitedUnits}
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
              labelsByAnnotationId={labelsByAnnotationId}
              questions={activeSourceQuestions.length ? activeSourceQuestions : activeItem.questions}
              resourceById={resourceById}
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
                      title={activeImportantNote ? "Remove from important answers" : "Keep this answer in Notes"}
                      type="button"
                    >
                      <BookMarked size={14} />
                      {activeImportantNote ? "Important" : "Mark important"}
                    </button>
                  ) : null}
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
                    <CircleHelp size={13} />
                    {activeFollowupTrail.length ? "Follow-up review" : "Original question"}
                    {activeItem.questions.length > 1
                      ? ` · ${activeItem.questions.length} linked captures`
                      : ""}
                    <em className={`qaReviewStatus ${activeReviewStatus}`}>
                      {activeReviewStatus}
                    </em>
                  </span>
                  {activeFollowupTrail.map((entry, index) => (
                    <details className="qaFollowupTrail" key={entry.followup.id} open>
                      <summary>
                        {index ? `Earlier follow-up ${index + 1}` : "Original Q&A"}
                        <small>{entry.responseTitle}</small>
                      </summary>
                      {entry.originalQuestions.map((question) => (
                        <div className="qaFollowupOriginal" key={question.id}>
                          <strong>Question</strong>
                          <MarkdownMath>{annotationDisplayText(question)}</MarkdownMath>
                        </div>
                      ))}
                      <div className="qaFollowupAnswer">
                        <strong>Tutor answer</strong>
                        <MarkdownMath>{entry.answerMarkdown}</MarkdownMath>
                      </div>
                      {entry.selectedContext ? (
                        <blockquote>
                          <MarkdownMath>{entry.selectedContext}</MarkdownMath>
                        </blockquote>
                      ) : null}
                      <div className="qaFollowupAsked">
                        <strong>Your follow-up</strong>
                        {editingFollowupId === entry.followup.id ? (
                          <DiscussionMarkdownSurface
                            editable
                            markdown={annotationDisplayText(entry.followup)}
                            onCancel={() => setEditingFollowupId(null)}
                            onSave={(markdown) => {
                              onAnnotationChange(entry.followup, {
                                markdown,
                                plainText: markdown,
                              });
                              setEditingFollowupId(null);
                            }}
                            placeholder="Refine this follow-up question…"
                          />
                        ) : (
                          <>
                            <MarkdownMath>{annotationDisplayText(entry.followup)}</MarkdownMath>
                            <div className="qaFollowupActions">
                              <button
                                onClick={() => setEditingFollowupId(entry.followup.id)}
                                type="button"
                              >
                                Edit follow-up
                              </button>
                              <button
                                className="danger"
                                onClick={() =>
                                  onAnnotationChange(entry.followup, { status: "archived" })
                                }
                                type="button"
                              >
                                Delete follow-up
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </details>
                  ))}
                  {!activeFollowupTrail.length
                    ? activeItem.questions.map((question) => (
                        <div className="qaMappedQuestion" key={question.id}>
                          <small>{labelsByAnnotationId.get(question.id) ?? "Linked capture"}</small>
                          <MarkdownMath>{annotationDisplayText(question)}</MarkdownMath>
                        </div>
                      ))
                    : null}
                </section>
              ) : null}
              {(activeItem.answers?.length ?? 0) > 1 ? (
                <section className="qaAnswerHistory">
                  <header>
                    <strong>{activeItem.answers!.length} tutor responses</strong>
                    <span>One question thread · oldest to newest</span>
                  </header>
                  {activeItem.answers!.slice(0, -1).map((answer, index) => (
                    <details key={answer.section.id} open={index === activeItem.answers!.length - 2}>
                      <summary>
                        <span>Response version {index + 1}</span>
                        <small>{answer.section.title}</small>
                      </summary>
                      <MarkdownMath>{answer.section.bodyMarkdown}</MarkdownMath>
                    </details>
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
            onClick={() => navigateTo(boundedActiveIndex - 1)}
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
            onClick={() => navigateTo(boundedActiveIndex + 1)}
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
