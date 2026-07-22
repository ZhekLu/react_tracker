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
import { pdfReaderPageUrl } from "../../api/trackerApi";
import {
  annotationDisplayText,
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

type DiscussionQaReviewProps = {
  course: Course;
  discussion: Discussion;
  onAnnotationChange: (
    annotation: Annotation,
    changes: {
      kind?: AnnotationKind;
      status?: AnnotationStatus;
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

type QaReviewItem = {
  id: string;
  question?: Annotation;
  section?: DiscussionQaSection;
};

function SourcePreview({
  question,
  resource,
}: {
  question?: Annotation;
  resource?: Resource;
}) {
  const [useFallback, setUseFallback] = useState(false);
  const pageNumber = question?.anchor?.pageNumber ?? null;
  const contextImageUrl = question
    ? metadataText(question, "contextImageUrl")
    : "";
  const fullPageUrl =
    question && pageNumber
      ? pdfReaderPageUrl(question.resourceId, pageNumber)
      : "";
  const imageUrl = useFallback ? contextImageUrl : fullPageUrl || contextImageUrl;

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
      {imageUrl ? (
        <div className="qaSourceCanvas">
          <img
            alt={`${resource?.title ?? "Question source"}${pageNumber ? `, page ${pageNumber}` : ""}`}
            key={`${question.id}:${imageUrl}`}
            onError={() => {
              if (!useFallback && contextImageUrl && contextImageUrl !== fullPageUrl) {
                setUseFallback(true);
              }
            }}
            src={imageUrl}
          />
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

function sectionItems(
  sections: DiscussionQaSection[],
  annotationById: Map<string, Annotation>,
  discussion: Discussion,
): QaReviewItem[] {
  const mappedQuestionIds = new Set<string>();
  const items = sections.flatMap((section) => {
    const questions = section.questionIds
      .map((id) => annotationById.get(id))
      .filter((item): item is Annotation => Boolean(item));
    questions.forEach((question) => mappedQuestionIds.add(question.id));
    return questions.length
      ? questions.map((question) => ({
          id: `${section.id}:${question.id}`,
          question,
          section,
        }))
      : [{ id: `${section.id}:orientation`, section }];
  });
  const unmapped = discussion.questionIds
    .filter((id) => !mappedQuestionIds.has(id))
    .map((id) => annotationById.get(id))
    .filter(
      (item): item is Annotation =>
        Boolean(item && ["question", "todo"].includes(item.kind)),
    )
    .map((question) => ({
      id: `unmapped:${question.id}`,
      question,
    }));
  return [...items, ...unmapped];
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
    () => sectionItems(sections, annotationById, discussion),
    [annotationById, discussion, sections],
  );
  const visibleItems = useMemo(
    () =>
      openQuestionsOnly
        ? allItems.filter((item) => item.question?.status === "open")
        : allItems,
    [allItems, openQuestionsOnly],
  );
  const boundedActiveIndex = Math.max(
    0,
    Math.min(activeIndex, Math.max(0, visibleItems.length - 1)),
  );
  const activeItem = visibleItems[boundedActiveIndex];
  const questionItems = allItems.filter(
    (item): item is QaReviewItem & { question: Annotation } =>
      Boolean(item.question),
  );
  const uniqueQuestions = [
    ...new Map(questionItems.map((item) => [item.question.id, item.question])).values(),
  ];
  const answeredQuestions = uniqueQuestions.filter(
    (question) => question.status === "answered",
  ).length;
  const completionRatio = uniqueQuestions.length
    ? answeredQuestions / uniqueQuestions.length
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
                {answeredQuestions}/{uniqueQuestions.length} questions understood
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
              aria-valuemax={uniqueQuestions.length}
              aria-valuemin={0}
              aria-valuenow={answeredQuestions}
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
              key={activeItem.question?.id ?? activeItem.id}
              question={activeItem.question}
              resource={
                activeItem.question
                  ? resourceById.get(activeItem.question.resourceId)
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
                {activeItem.question ? (
                  <button
                    className={
                      activeItem.question.status === "answered"
                        ? "qaAnsweredToggle answered"
                        : "qaAnsweredToggle"
                    }
                    onClick={() => {
                      if (activeItem.question?.status === "answered") {
                        onAnnotationChange(activeItem.question, { status: "open" });
                      } else if (activeItem.section) {
                        onQuestionLink(
                          activeItem.section.messageId,
                          activeItem.question!.id,
                          "answers",
                        );
                      } else {
                        onAnnotationChange(activeItem.question!, {
                          status: "answered",
                        });
                      }
                    }}
                    type="button"
                  >
                    {activeItem.question.status === "answered" ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    {activeItem.question.status === "answered"
                      ? "Understood"
                      : "Mark understood"}
                  </button>
                ) : null}
              </header>
              {activeItem.question ? (
                <section className="qaQuestionPrompt">
                  <span>
                    <CircleHelp size={13} /> Original question
                  </span>
                  <MarkdownMath>
                    {annotationDisplayText(activeItem.question)}
                  </MarkdownMath>
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
