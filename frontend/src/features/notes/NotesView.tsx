import {
  Archive,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Clock3,
  ClipboardCopy,
  MessageSquareText,
  Save,
  Sparkles,
  RotateCcw,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { MarkdownMath } from "../../components/content/MarkdownMath";
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
  onOpenDiscussion: (resourceId: string) => void;
  onOpenResource: (resourceId: string) => void;
};

type NotesFilter = "all" | "questions" | "later";

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
  onOpenResource,
}: {
  annotation: Annotation;
  resource?: Resource;
  onAnnotationChange: NotesViewProps["onAnnotationChange"];
  onCopyAnnotation: NotesViewProps["onCopyAnnotation"];
  onOpenDiscussion: NotesViewProps["onOpenDiscussion"];
  onOpenResource: NotesViewProps["onOpenResource"];
}) {
  const initialMarkdown =
    annotation.body?.markdown ?? annotation.body?.plainText ?? "";
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [priority, setPriority] = useState(annotation.priority);
  const editable = ["question", "todo"].includes(annotation.kind);
  const dirty =
    markdown !== initialMarkdown || priority !== annotation.priority;

  return (
    <article className={`annotationCard kind-${annotation.kind}`}>
      <header>
        <div>
          <strong>{resource?.title ?? "Unknown resource"}</strong>
          <span>
            {annotation.anchor?.pageNumber
              ? `Page ${annotation.anchor.pageNumber}`
              : null}
            {annotation.anchor?.sectionTitle
              ? ` · ${annotation.anchor.sectionTitle}`
              : null}
          </span>
        </div>
        <span className={`annotationKind ${annotation.kind}`}>
          {annotation.kind} · {annotation.status}
        </span>
      </header>
      {annotation.anchor?.quote ? (
        <blockquote>{annotation.anchor.quote}</blockquote>
      ) : null}
      {editable ? (
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
      ) : annotation.body?.plainText ? (
        <MarkdownMath>
          {annotation.body.markdown ?? annotation.body.plainText}
        </MarkdownMath>
      ) : null}
      <footer>
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
      </footer>
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
  onOpenDiscussion,
  onOpenResource,
}: NotesViewProps) {
  const [filter, setFilter] = useState<NotesFilter>("all");
  const [query, setQuery] = useState("");
  const meetingNote = course.notes.find((note) => note.kind === "meeting");

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
  const filteredNotes = noteContexts.filter((item) => {
    if (filter === "later") return false;
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
    if (filter === "later") return false;
    if (filter === "questions" && !["question", "todo"].includes(annotation.kind)) return false;
    const resource = resourceById.get(annotation.resourceId);
    return (
      !normalizedQuery ||
      `${resource?.title ?? ""} ${annotation.anchor?.quote ?? ""} ${annotation.body?.plainText ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  });
  const visibleLaterTasks = laterTasks.filter(({ task }) =>
    !normalizedQuery || task.title.toLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="notesLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Study memory</p>
          <h2>{course.notes.length} notes · {course.annotations.length} annotations</h2>
        </div>
        <div className="viewToolbarActions">
          <label className="searchField">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes and questions"
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
        {(["all", "questions", "later"] as const).map((item) => (
          <button
            className={filter === item ? "filterButton active" : "filterButton"}
            key={item}
            onClick={() => setFilter(item)}
            type="button"
          >
            {item === "all" ? "All notes" : item === "questions" ? "Questions" : "Do later"}
          </button>
        ))}
      </div>

      <section className="meetingScratchpad">
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
      </section>

      {filter !== "later" ? (
        <section className="noteCollection">
          <header className="collectionHeader">
            <h2>Editable notes</h2>
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

      {filter !== "later" ? (
        <section className="noteCollection">
          <header className="collectionHeader">
            <h2>Source annotations</h2>
            <span>{filteredAnnotations.length}</span>
          </header>
          {filteredAnnotations.map((annotation) => {
            const resource = resourceById.get(annotation.resourceId);
            return (
              <AnnotationSummaryCard
                annotation={annotation}
                key={`${annotation.id}:${annotation.revision}`}
                onAnnotationChange={onAnnotationChange}
                onCopyAnnotation={onCopyAnnotation}
                onOpenDiscussion={onOpenDiscussion}
                onOpenResource={onOpenResource}
                resource={resource}
              />
            );
          })}
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
