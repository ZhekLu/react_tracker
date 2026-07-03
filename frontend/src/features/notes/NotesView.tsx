import {
  Archive,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  ClipboardCopy,
  MessageSquareText,
  Save,
  Sparkles,
  RotateCcw,
  Search,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { AnnotationChapterGroups } from "../../components/annotations/AnnotationChapterGroups";
import {
  annotationDisplayText,
  annotationRgbCss,
  metadataText,
} from "../../components/annotations/annotationDisplay";
import type {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Course,
  EntityNoteSaveInput,
  Note,
  Resource,
  Task,
} from "../../types/tracker";

type NotesViewProps = {
  course: Course;
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
  onCopyAgenda: () => void;
  onCopyAnnotation: (annotation: Annotation) => void;
  onCopyQuestions: () => void;
  onStartQuestionDiscussion: () => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onNoteAttentionChange: (
    note: Note,
    attention: Note["attention"],
  ) => void;
  onDiscussionAttentionChange: (
    discussion: Course["discussions"][number],
    attention: Course["discussions"][number]["attention"],
  ) => void;
  onOpenDiscussion: (resourceId: string) => void;
  onOpenDay: (dayId: string) => void;
  onOpenResource: (resourceId: string) => void;
};

type NotesFilter = "all" | "questions" | "professor" | "later";

type NoteContext = {
  entityId: string;
  entityType: EntityNoteSaveInput["entityType"];
  label: string;
  note: Note;
  resourceId?: string;
};

function AnnotationSummaryCard({
  annotation,
  resource,
  onAnnotationChange,
  onCopyAnnotation,
  onOpenDiscussion,
  onOpenDay,
  onOpenResource,
  days,
}: {
  annotation: Annotation;
  days: Course["days"];
  resource?: Resource;
  onAnnotationChange: NotesViewProps["onAnnotationChange"];
  onCopyAnnotation: NotesViewProps["onCopyAnnotation"];
  onOpenDiscussion: NotesViewProps["onOpenDiscussion"];
  onOpenDay: NotesViewProps["onOpenDay"];
  onOpenResource: NotesViewProps["onOpenResource"];
}) {
  const initialMarkdown =
    annotation.body?.markdown ?? annotation.body?.plainText ?? "";
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [priority, setPriority] = useState(annotation.priority);
  const editable = ["question", "todo"].includes(annotation.kind);
  const [expanded, setExpanded] = useState(!editable);
  const dirty =
    markdown !== initialMarkdown || priority !== annotation.priority;
  const displayText = annotationDisplayText(annotation);
  const rgb = annotationRgbCss(annotation);
  const contextBefore = metadataText(annotation, "contextBefore");
  const contextAfter = metadataText(annotation, "contextAfter");
  const contextImageUrl = metadataText(annotation, "contextImageUrl");

  return (
    <article
      className={`annotationCard kind-${annotation.kind} status-${annotation.status} ${editable ? "compactQuestionCard" : ""} ${rgb ? "exactCaptureColor" : ""}`}
      style={
        rgb
          ? ({ "--capture-color": rgb } as CSSProperties)
          : undefined
      }
    >
      <header>
        <button
          className="annotationCardToggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {editable ? (
            <ChevronDown
              className={expanded ? "expanded" : ""}
              size={14}
            />
          ) : null}
          <span>
            <MarkdownMath className="questionSummaryMath">
              {annotation.body?.markdown || displayText}
            </MarkdownMath>
            <small>
              {resource?.title ?? "Unknown resource"}
              {annotation.anchor?.pageNumber
                ? ` · Page ${annotation.anchor.pageNumber}`
                : ""}
              {annotation.anchor?.sectionTitle
                ? ` · ${annotation.anchor.sectionTitle}`
                : ""}
            </small>
          </span>
        </button>
        <div className="annotationCardBadges">
          <span className={`questionPriority priority-${annotation.priority}`}>
            {annotation.priority}
          </span>
          <span className={`annotationKind ${annotation.kind}`}>
            {annotation.status}
          </span>
        </div>
      </header>
      {days.length ? (
        <div className="questionDayLinks">
          {days.map((day) => (
            <button
              key={day.id}
              onClick={() => onOpenDay(day.id)}
              title={`Open Day ${day.number}`}
              type="button"
            >
              D{day.number}
            </button>
          ))}
        </div>
      ) : null}
      {expanded ? (
        <div className="annotationExpandedContext">
          {contextImageUrl ? (
            <img
              alt={`Page ${annotation.anchor?.pageNumber ?? ""} around handwritten question`}
              src={contextImageUrl}
            />
          ) : null}
          {contextBefore ? <p>{contextBefore}</p> : null}
          {annotation.anchor?.quote ? (
            <blockquote>{annotation.anchor.quote}</blockquote>
          ) : null}
          {contextAfter ? <p>{contextAfter}</p> : null}
        </div>
      ) : null}
      {expanded && editable ? (
        <div className="questionEditBody">
          <textarea
            aria-label={`Question for ${resource?.title ?? "resource"}`}
            onChange={(event) => setMarkdown(event.target.value)}
            rows={4}
            value={markdown}
          />
          {markdown.trim() ? (
            <MarkdownMath className="questionFormulaPreview">
              {markdown}
            </MarkdownMath>
          ) : null}
          <div>
            <label>
              <span>Priority</span>
              <select
                onChange={(event) =>
                  setPriority(event.target.value as Annotation["priority"])
                }
                value={priority}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
            <button
              disabled={!dirty || !markdown.trim()}
              onClick={() =>
                onAnnotationChange(annotation, {
                  documentRevision: annotation.body?.revision,
                  markdown: markdown.trim(),
                  plainText: markdown.trim(),
                  priority,
                })
              }
              type="button"
            >
              <Save size={13} /> Save question
            </button>
          </div>
        </div>
      ) : expanded && annotation.body?.plainText ? (
        <MarkdownMath>
          {annotation.body.markdown ?? annotation.body.plainText}
        </MarkdownMath>
      ) : null}
      {expanded ? <footer>
        <button onClick={() => onOpenResource(annotation.resourceId)} type="button">
          <BookOpen size={13} /> Open
        </button>
        <button
          onClick={() => onOpenDiscussion(annotation.resourceId)}
          type="button"
        >
          <MessageSquareText size={13} /> Discuss
        </button>
        <button onClick={() => onCopyAnnotation(annotation)} type="button">
          <ClipboardCopy size={13} /> Copy context
        </button>
        <button
          onClick={() =>
            onAnnotationChange(annotation, {
              kind: annotation.kind === "question" ? "note" : "question",
            })
          }
          type="button"
        >
          <CircleHelp size={13} />
          {annotation.kind === "question" ? "Make note" : "Make question"}
        </button>
        <button
          onClick={() =>
            onAnnotationChange(annotation, {
              status: annotation.status === "answered" ? "open" : "answered",
            })
          }
          type="button"
        >
          {annotation.status === "answered" ? (
            <RotateCcw size={13} />
          ) : (
            <CheckCircle2 size={13} />
          )}
          {annotation.status === "answered" ? "Reopen" : "Answered"}
        </button>
        <button
          onClick={() =>
            onAnnotationChange(annotation, { status: "archived" })
          }
          type="button"
        >
          <Archive size={13} /> Archive
        </button>
      </footer> : null}
    </article>
  );
}

function containsQuestionMarker(value: string): boolean {
  return value.includes("??") || value.toLowerCase().includes("todo!");
}

export function NotesView({
  course,
  onAnnotationChange,
  onCopyAgenda,
  onCopyAnnotation,
  onCopyQuestions,
  onStartQuestionDiscussion,
  onNoteSave,
  onNoteAttentionChange,
  onDiscussionAttentionChange,
  onOpenDiscussion,
  onOpenDay,
  onOpenResource,
}: NotesViewProps) {
  const [filter, setFilter] = useState<NotesFilter>("questions");
  const [query, setQuery] = useState("");
  const [annotationResourceFilter, setAnnotationResourceFilter] =
    useState("all");
  const [questionDayFilter, setQuestionDayFilter] = useState("all");
  const [questionStatusFilter, setQuestionStatusFilter] =
    useState<"open" | "all">("open");
  const meetingNote = course.notes.find((note) => note.kind === "meeting");
  const professorDiscussions = course.discussions.filter(
    (discussion) => discussion.attention === "professor",
  );

  const dayById = useMemo(() => new Map(course.days.map((day) => [day.id, day])), [course.days]);
  const taskById = useMemo(
    () =>
      new Map(
        course.days.flatMap((day) =>
          day.sections.flatMap((section) =>
            section.tasks.map((task) => [task.id, task] as const),
          ),
        ),
      ),
    [course.days],
  );
  const resourceById = useMemo(
    () => new Map(course.resources.map((resource) => [resource.id, resource])),
    [course.resources],
  );
  const discussionByResourceId = useMemo(
    () =>
      new Map(
        course.discussions.map((discussion) => [
          discussion.resourceId,
          discussion,
        ]),
      ),
    [course.discussions],
  );
  const questionById = useMemo(
    () =>
      new Map(
        course.exams.flatMap((exam) =>
          exam.questions.map((question) => [question.id, question] as const),
        ),
      ),
    [course.exams],
  );

  const noteContexts = useMemo<NoteContext[]>(() => {
    return course.notes.reduce<NoteContext[]>((items, note) => {
      const link = note.links.find((item) => item.relation === "primary") ?? note.links[0];
      if (!link) return items;
      if (link.entityType === "day") {
        const day = dayById.get(link.entityId);
        if (day) {
          items.push({
            entityId: day.id,
            entityType: "day",
            label: `Day ${day.number}: ${day.topic || day.title}`,
            note,
          });
        }
        return items;
      }
      if (link.entityType === "task") {
        const task = taskById.get(link.entityId);
        if (task) {
          items.push({ entityId: task.id, entityType: "task", label: task.title, note });
        }
        return items;
      }
      if (link.entityType === "resource") {
        const resource = resourceById.get(link.entityId);
        if (resource) {
          items.push({
            entityId: resource.id,
            entityType: "resource",
            label: resource.title,
            note,
            resourceId: resource.id,
          });
        }
        return items;
      }
      if (link.entityType === "exam_question") {
        const question = questionById.get(link.entityId);
        if (question) {
          items.push({
            entityId: question.id,
            entityType: "exam_question",
            label: `${question.label}: ${question.topic || "Exam question"}`,
            note,
            resourceId: question.id,
          });
        }
        return items;
      }
      return items;
    }, []);
  }, [course.notes, dayById, questionById, resourceById, taskById]);

  const laterTasks = useMemo(
    () =>
      course.days.flatMap((day) =>
        day.sections.flatMap((section) =>
          section.tasks
            .filter((task) => task.status === "later")
            .map((task) => ({ day, task })),
        ),
      ),
    [course.days],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const questionItems = useMemo(
    () =>
      course.annotations
        .filter(
          (annotation) =>
            ["question", "todo"].includes(annotation.kind) &&
            annotation.status !== "archived",
        )
        .map((annotation) => {
          const resource = resourceById.get(annotation.resourceId);
          const directDayIds = resource?.dayIds ?? [];
          const discussion = discussionByResourceId.get(annotation.resourceId);
          const sourceDayIds =
            discussion?.sourceResourceIds.flatMap(
              (resourceId) => resourceById.get(resourceId)?.dayIds ?? [],
            ) ?? [];
          const dayIds = [...new Set([...directDayIds, ...sourceDayIds])];
          return {
            annotation,
            days: dayIds
              .map((dayId) => dayById.get(dayId))
              .filter(
                (day): day is Course["days"][number] => Boolean(day),
              )
              .sort((left, right) => left.number - right.number),
            resource,
          };
        }),
    [
      course.annotations,
      dayById,
      discussionByResourceId,
      resourceById,
    ],
  );
  const openQuestionCount = questionItems.filter(
    (item) => item.annotation.status === "open",
  ).length;
  const questionDays = course.days
    .map((day) => ({
      day,
      count: questionItems.filter(
        (item) =>
          item.annotation.status === "open" &&
          item.days.some((linkedDay) => linkedDay.id === day.id),
      ).length,
    }))
    .filter((item) => item.count > 0);
  const visibleQuestionItems = questionItems.filter((item) => {
    if (
      questionStatusFilter === "open" &&
      item.annotation.status !== "open"
    ) {
      return false;
    }
    if (
      questionDayFilter !== "all" &&
      !item.days.some((day) => day.id === questionDayFilter)
    ) {
      return false;
    }
    return (
      !normalizedQuery ||
      `${item.resource?.title ?? ""} ${item.annotation.anchor?.quote ?? ""} ${item.annotation.body?.plainText ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  });
  const questionGroups = [...visibleQuestionItems.reduce((groups, item) => {
    const groupId =
      questionDayFilter !== "all"
        ? questionDayFilter
        : item.days[0]?.id ?? "unassigned";
    const group = groups.get(groupId) ?? [];
    group.push(item);
    groups.set(groupId, group);
    return groups;
  }, new Map<string, typeof visibleQuestionItems>()).entries()].sort(
    ([left], [right]) => {
      if (left === "unassigned") return 1;
      if (right === "unassigned") return -1;
      return (dayById.get(left)?.number ?? 0) - (dayById.get(right)?.number ?? 0);
    },
  );
  const filteredNotes = noteContexts.filter((item) => {
    if (filter === "later") return false;
    if (filter === "professor" && item.note.attention !== "professor") {
      return false;
    }
    if (
      filter === "questions" &&
      !containsQuestionMarker(`${item.note.document.markdown ?? ""} ${item.note.document.plainText}`)
    ) {
      return false;
    }
    return (
      !normalizedQuery ||
      `${item.label} ${item.note.document.plainText}`.toLowerCase().includes(normalizedQuery)
    );
  });
  const filteredAnnotations = course.annotations.filter((annotation) => {
    if (filter === "later" || filter === "professor") return false;
    if (filter === "questions" && !["question", "todo"].includes(annotation.kind)) return false;
    if (annotation.status === "archived") return false;
    if (
      annotationResourceFilter !== "all" &&
      annotation.resourceId !== annotationResourceFilter
    ) {
      return false;
    }
    const resource = resourceById.get(annotation.resourceId);
    return (
      !normalizedQuery ||
      `${resource?.title ?? ""} ${annotation.anchor?.quote ?? ""} ${annotation.body?.plainText ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  });
  const annotationResources = course.resources
    .map((resource) => ({
      count: course.annotations.filter(
        (annotation) =>
          annotation.resourceId === resource.id &&
          annotation.status !== "archived",
      ).length,
      resource,
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => left.resource.title.localeCompare(right.resource.title));
  const annotationsByResource = [
    ...filteredAnnotations.reduce((groups, annotation) => {
      const group = groups.get(annotation.resourceId) ?? [];
      group.push(annotation);
      groups.set(annotation.resourceId, group);
      return groups;
    }, new Map<string, Annotation[]>()).entries(),
  ];
  const visibleLaterTasks = laterTasks.filter(({ task }) =>
    !normalizedQuery || task.title.toLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="notesLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Question and study memory</p>
          <h2>
            {openQuestionCount} open question
            {openQuestionCount === 1 ? "" : "s"} · {course.notes.length} notes
          </h2>
        </div>
        <div className="viewToolbarActions">
          <label className="searchField">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                filter === "questions"
                  ? "Search questions and sources"
                  : "Search notes and questions"
              }
              type="search"
              value={query}
            />
          </label>
          <button className="commandButton subtle" onClick={onCopyQuestions} type="button">
            <CircleHelp size={14} />
            <span>Copy questions</span>
          </button>
          <button
            className="commandButton"
            onClick={onStartQuestionDiscussion}
            type="button"
          >
            <Sparkles size={14} />
            <span>Discuss questions</span>
          </button>
          <button className="commandButton subtle" onClick={onCopyAgenda} type="button">
            <ClipboardCopy size={14} />
            <span>Copy agenda</span>
          </button>
        </div>
      </header>

      <div className="filterBar" aria-label="Notes filters">
        {(["questions", "all", "professor", "later"] as const).map((item) => (
          <button
            className={filter === item ? "filterButton active" : "filterButton"}
            key={item}
            onClick={() => setFilter(item)}
            type="button"
          >
            {item === "all"
              ? "All notes"
              : item === "questions"
                ? `Questions · ${openQuestionCount}`
                : item === "professor"
                  ? `Professor · ${
                      noteContexts.filter(
                        ({ note }) => note.attention === "professor",
                      ).length + professorDiscussions.length
                    }`
                  : "Do later"}
          </button>
        ))}
      </div>

      {filter === "questions" ? (
        <section className="questionWorkspace">
          <header className="questionQueueHeader">
            <div>
              <p className="eyebrow">Compact queue</p>
              <h2>
                {visibleQuestionItems.length} visible · {questionDays.length} day
                {questionDays.length === 1 ? "" : "s"} affected
              </h2>
            </div>
            <div className="questionStatusToggle">
              <button
                className={questionStatusFilter === "open" ? "active" : ""}
                onClick={() => setQuestionStatusFilter("open")}
                type="button"
              >
                Open
              </button>
              <button
                className={questionStatusFilter === "all" ? "active" : ""}
                onClick={() => setQuestionStatusFilter("all")}
                type="button"
              >
                Open + answered
              </button>
            </div>
          </header>
          <nav className="questionDayRail" aria-label="Filter questions by day">
            <button
              className={questionDayFilter === "all" ? "active" : ""}
              onClick={() => setQuestionDayFilter("all")}
              type="button"
            >
              <strong>{openQuestionCount}</strong>
              <span>All open</span>
            </button>
            {questionDays.map(({ day, count }) => (
              <button
                className={questionDayFilter === day.id ? "active" : ""}
                key={day.id}
                onClick={() => setQuestionDayFilter(day.id)}
                type="button"
              >
                <strong>{count}</strong>
                <span>D{day.number}</span>
              </button>
            ))}
          </nav>
          <div className="questionGroups">
            {questionGroups.map(([groupId, items]) => {
              const day = dayById.get(groupId);
              return (
                <section className="questionDayGroup" key={groupId}>
                  <header>
                    <div>
                      <CalendarDays size={15} />
                      <span>
                        <strong>
                          {day ? `Day ${day.number}` : "Course-wide"}
                        </strong>
                        <small>
                          {day?.topic || day?.title || "No day link"}
                        </small>
                      </span>
                    </div>
                    {day ? (
                      <button onClick={() => onOpenDay(day.id)} type="button">
                        Open day
                      </button>
                    ) : null}
                  </header>
                  <div>
                    {items.map(({ annotation, days, resource }) => (
                      <AnnotationSummaryCard
                        annotation={annotation}
                        days={days}
                        key={`${annotation.id}:${annotation.revision}`}
                        onAnnotationChange={onAnnotationChange}
                        onCopyAnnotation={onCopyAnnotation}
                        onOpenDay={onOpenDay}
                        onOpenDiscussion={onOpenDiscussion}
                        onOpenResource={onOpenResource}
                        resource={resource}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {!questionGroups.length ? (
              <div className="emptyInline">
                No questions match this day, status, and search.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {filter === "all" ? <section className="meetingScratchpad">
        <header className="collectionHeader">
          <div>
            <p className="eyebrow">Supervisor / study meeting</p>
            <h2>Meeting scratchpad</h2>
          </div>
          <span>{meetingNote ? "saved" : "new"}</span>
        </header>
        <EntityNoteEditor
          key={`${meetingNote?.id ?? course.id}:${meetingNote?.revision ?? 0}`}
          label="Meeting scratchpad"
          note={meetingNote}
          onAttentionChange={onNoteAttentionChange}
          onSave={(html) =>
            onNoteSave({
              entityId: course.id,
              entityType: "course",
              html,
              kind: "meeting",
              note: meetingNote,
            })
          }
          placeholder="Loose agenda, decisions, questions for the professor, and follow-ups..."
        />
      </section> : null}

      {filter === "all" || filter === "professor" ? (
        <section className="noteCollection">
          <header className="collectionHeader">
            <h2>
              {filter === "professor"
                ? "Discuss with professor"
                : "Editable notes"}
            </h2>
            <span>{filteredNotes.length}</span>
          </header>
          {filteredNotes.map((item) => (
            <article className="summaryNoteCard" key={item.note.id}>
              <div className="summaryNoteIdentity">
                <MessageSquareText size={16} />
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.entityType.replace("_", " ")}</span>
                </div>
                {item.resourceId ? (
                  <div className="summaryNoteActions">
                    <button onClick={() => onOpenResource(item.resourceId!)} type="button">
                      <BookOpen size={14} />
                      <span>Open</span>
                    </button>
                    <button onClick={() => onOpenDiscussion(item.resourceId!)} type="button">
                      <MessageSquareText size={14} />
                      <span>Discuss</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <EntityNoteEditor
                key={`${item.note.id}:${item.note.revision}`}
                label="Edit note"
                note={item.note}
                onAttentionChange={onNoteAttentionChange}
                onSave={(html) =>
                  onNoteSave({
                    entityId: item.entityId,
                    entityType: item.entityType,
                    html,
                    kind: item.note.kind,
                    note: item.note,
                  })
                }
                placeholder={`Notes for ${item.label}`}
              />
            </article>
          ))}
          {!filteredNotes.length ? <div className="emptyInline">No editable notes in this view.</div> : null}
        </section>
      ) : null}

      {filter === "professor" && professorDiscussions.length ? (
        <section className="noteCollection professorDiscussionCollection">
          <header className="collectionHeader">
            <h2>Flagged discussions</h2>
            <span>{professorDiscussions.length}</span>
          </header>
          {professorDiscussions.map((discussion) => (
            <article className="professorDiscussionCard" key={discussion.id}>
              <Sparkles size={16} />
              <button
                onClick={() => onOpenDiscussion(discussion.resourceId)}
                type="button"
              >
                <strong>{discussion.title}</strong>
                <span>
                  {discussion.messages.length} message
                  {discussion.messages.length === 1 ? "" : "s"}
                </span>
              </button>
              <button
                aria-label="Remove professor discussion flag"
                onClick={() =>
                  onDiscussionAttentionChange(discussion, "none")
                }
                title="Remove professor flag"
                type="button"
              >
                ×
              </button>
            </article>
          ))}
        </section>
      ) : null}

      {filter === "all" ? (
        <section className="noteCollection">
          <header className="collectionHeader">
            <div>
              <p className="eyebrow">By source</p>
              <h2>Resource captures</h2>
            </div>
            <span>{filteredAnnotations.length}</span>
          </header>
          <nav
            aria-label="Filter captures by resource"
            className="resourceCaptureRail"
          >
            <button
              className={annotationResourceFilter === "all" ? "active" : ""}
              onClick={() => setAnnotationResourceFilter("all")}
              type="button"
            >
              <strong>
                {annotationResources.reduce(
                  (total, item) => total + item.count,
                  0,
                )}
              </strong>
              <span>All resources</span>
            </button>
            {annotationResources.map(({ count, resource }) => (
              <button
                className={
                  annotationResourceFilter === resource.id ? "active" : ""
                }
                key={resource.id}
                onClick={() => setAnnotationResourceFilter(resource.id)}
                title={resource.title}
                type="button"
              >
                <strong>{count}</strong>
                <span>{resource.title}</span>
              </button>
            ))}
          </nav>
          <div className="resourceCaptureCollections">
            {annotationsByResource.map(([resourceId, annotations]) => {
              const resource = resourceById.get(resourceId);
              return (
                <section className="resourceCaptureCollection" key={resourceId}>
                  <header>
                    <div>
                      <BookOpen size={15} />
                      <span>
                        <strong>{resource?.title ?? "Unknown resource"}</strong>
                        <small>{annotations.length} captures</small>
                      </span>
                    </div>
                    {resource ? (
                      <div>
                        <button
                          onClick={() => onOpenResource(resource.id)}
                          type="button"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => onOpenDiscussion(resource.id)}
                          type="button"
                        >
                          Discuss
                        </button>
                      </div>
                    ) : null}
                  </header>
                  <AnnotationChapterGroups
                    annotations={annotations}
                    onAnnotationChange={onAnnotationChange}
                    onDiscuss={
                      resource
                        ? () => onOpenDiscussion(resource.id)
                        : undefined
                    }
                    onNoteSave={onNoteSave}
                  />
                </section>
              );
            })}
          </div>
          {!filteredAnnotations.length ? <div className="emptyInline">No annotations in this view.</div> : null}
        </section>
      ) : null}

      {filter === "later" ? (
        <section className="noteCollection">
          <header className="collectionHeader">
            <h2>Deferred tasks</h2>
            <span>{visibleLaterTasks.length}</span>
          </header>
          {visibleLaterTasks.map(({ day, task }: { day: Course["days"][number]; task: Task }) => (
            <article className="laterTaskCard" key={task.id}>
              <Clock3 size={16} />
              <div>
                <strong>{task.title}</strong>
                <span>Day {day.number}: {day.topic || day.title}</span>
              </div>
              <EntityNoteEditor
                key={`${task.notes[0]?.id ?? task.id}:${task.notes[0]?.revision ?? 0}`}
                label="Task note"
                note={task.notes[0]}
                onAttentionChange={onNoteAttentionChange}
                onSave={(html) =>
                  onNoteSave({
                    entityId: task.id,
                    entityType: "task",
                    html,
                    kind: "task",
                    note: task.notes[0],
                  })
                }
                placeholder="Why was this deferred? What should you remember when returning?"
              />
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
