import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  CircleHelp,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
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
} from "../../types/tracker";
import {
  qaReviewItems,
  sourceQuestionForReview,
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
  onQuestionLink: (
    messageId: string,
    annotationId: string,
    relation: DiscussionQuestionRelation,
  ) => void;
  onUpdateMessage: (
    message: DiscussionMessage,
    markdown: string,
    reviewItems?: DiscussionReviewItem[],
  ) => void;
};

function SourcePageImage({
  annotated,
  focusQuestions = [],
  pageNumber,
  primaryPageNumber,
  resourceId,
}: {
  annotated: boolean;
  focusQuestions?: Annotation[];
  pageNumber: number;
  primaryPageNumber: number;
  resourceId: string;
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
        <div className="qaSourcePages">
          {neighboringPages.map((sourcePage) => (
            <div
              className={
                sourcePage === pageNumber
                  ? "qaSourcePage current"
                  : "qaSourcePage neighbor"
              }
              key={sourcePage}
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
  onQuestionLink,
  onUpdateMessage,
}: DiscussionQaReviewProps) {
  const sections = useMemo(
    () => discussionQaSections(discussion, course.annotations),
    [course.annotations, discussion],
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
                {answeredUnits}/{reviewUnits.length} answer groups understood
              </strong>
            </div>
          </div>
          <div className="qaReviewProgressBlock">
            <div className="qaReviewProgressLabels">
              <span>
                {visibleItems.length
                  ? `${boundedActiveIndex + 1} of ${visibleItems.length}`
                  : "All clear"}
              </span>
              <strong>{Math.round(completionRatio * 100)}%</strong>
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
    </div>
  );

  return createPortal(content, document.body);
}
