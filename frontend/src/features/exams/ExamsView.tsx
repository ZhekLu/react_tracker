import {
  CheckCircle2,
  CircleHelp,
  ClipboardCopy,
  Clock3,
  FileQuestion,
  FolderOpen,
  MessageSquareText,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import type {
  Course,
  EntityNoteSaveInput,
  ExamQuestion,
  ExamSet,
  ExamStatus,
} from "../../types/tracker";

type ExamsViewProps = {
  course: Course;
  onCopyOverview: () => void;
  onFlagQuestion: (resourceId: string, label: string) => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onOpenDiscussion: (resourceId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onQuestionStatusChange: (examId: string, question: ExamQuestion, status: ExamStatus) => void;
};

type ExamFilter = "all" | "open" | "questions" | "solved" | "unmapped";

function isSolved(question: ExamQuestion): boolean {
  return question.solveStatus === "solved" || question.solveStatus === "review";
}

function statusClass(question: ExamQuestion, compact: boolean): string {
  const classes = ["examSquare"];
  if (compact) classes.push("compact");
  if (question.openQuestionCount > 0) classes.push("question");
  else if (isSolved(question)) classes.push("done");
  else if (question.solveStatus === "attempted") classes.push("later");
  return classes.join(" ");
}

function shortQuestionLabel(label: string): string {
  const partQuestion = label.match(/Part\s*(\d+)\s*(?:Q|Ex(?:ercise)?)\s*(\d+)/i);
  if (partQuestion) return `${partQuestion[1]}.${partQuestion[2]}`;
  const exercise = label.match(/Exercise\s*(\d+)/i);
  if (exercise) return `E${exercise[1]}`;
  const theory = label.match(/Theory\s*Q\s*(\d+)/i);
  if (theory) return `T${theory[1]}`;
  const question = label.match(/\bQ\s*(\d+)/i);
  if (question) return `Q${question[1]}`;
  return label.slice(0, 4);
}

function ExamSquare({
  compact = false,
  examId,
  question,
  onStatusChange,
}: {
  compact?: boolean;
  examId: string;
  question: ExamQuestion;
  onStatusChange: (examId: string, question: ExamQuestion, status: ExamStatus) => void;
}) {
  const reward = useCompletionReward();

  function toggleDone() {
    const nextStatus = question.solveStatus === "solved" ? "unsolved" : "solved";
    if (nextStatus === "solved") reward.celebrate();
    onStatusChange(examId, question, nextStatus);
  }

  return (
    <button
      aria-label={`${question.label}: ${question.topic}, ${question.solveStatus}`}
      className={statusClass(question, compact)}
      onClick={toggleDone}
      title={`${question.label}: ${question.topic}`}
      type="button"
    >
      {compact ? null : shortQuestionLabel(question.label)}
      <CompletionBurst token={reward.token} />
    </button>
  );
}

function examProgress(exam: ExamSet): number {
  if (!exam.questions.length) return 0;
  return exam.questions.filter(isSolved).length / exam.questions.length;
}

export function ExamsView({
  course,
  onCopyOverview,
  onFlagQuestion,
  onNoteSave,
  onOpenDiscussion,
  onOpenResource,
  onQuestionStatusChange,
}: ExamsViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExamFilter>("all");

  const allQuestions = course.exams.flatMap((exam) => exam.questions);
  const doneCount = allQuestions.filter((question) => question.solveStatus === "solved" || question.solveStatus === "review").length;
  const questionCount = allQuestions.filter((question) => question.openQuestionCount > 0).length;
  const laterCount = allQuestions.filter((question) => question.solveStatus === "attempted").length;
  const normalizedQuery = query.trim().toLowerCase();
  const questionResourceById = useMemo(
    () =>
      new Map(
        course.resources
          .filter((resource) => resource.kind === "exam_question")
          .map((resource) => [resource.id, resource]),
      ),
    [course.resources],
  );
  const visibleExams = useMemo(
    () =>
      course.exams
        .map((exam) => {
          const examMatches = `${exam.title} ${exam.category ?? ""} ${exam.sourcePath ?? ""}`
            .toLowerCase()
            .includes(normalizedQuery);
          const questions = exam.questions.filter((question) => {
            const matchesFilter =
              filter === "all" ||
              (filter === "open" && !isSolved(question)) ||
              (filter === "questions" && question.openQuestionCount > 0) ||
              (filter === "solved" && isSolved(question)) ||
              (filter === "unmapped" &&
                !questionResourceById.get(question.id)?.taskIds.length);
            if (!matchesFilter) return false;
            if (!normalizedQuery || examMatches) return true;
            return `${question.label} ${question.part ?? ""} ${question.topic ?? ""} ${question.prompt?.plainText ?? ""}`
              .toLowerCase()
              .includes(normalizedQuery);
          });
          return { exam, questions };
        })
        .filter(({ exam, questions }) => questions.length > 0 || (!normalizedQuery && exam.questions.length === 0)),
    [course.exams, filter, normalizedQuery, questionResourceById],
  );

  if (!course.exams.length) {
    return (
      <section className="emptyPanel">
        <h2>No exam tracker for this course</h2>
        <p>Project-only courses can use Roadmap and Resources without the exam dashboard.</p>
      </section>
    );
  }

  return (
    <div className="examLayout">
      <section className="examOverview">
        <header className="viewToolbar">
          <div>
            <p className="eyebrow">Practice overview</p>
            <h2>{doneCount}/{allQuestions.length} questions completed</h2>
          </div>
          <div className="examLegend">
            <span><CheckCircle2 size={14} /> Done {doneCount}</span>
            <span><CircleHelp size={14} /> Questions {questionCount}</span>
            <span><Clock3 size={14} /> Later {laterCount}</span>
            <button className="commandButton subtle" onClick={onCopyOverview} type="button">
              <ClipboardCopy size={14} /> Copy overview
            </button>
          </div>
        </header>

        <div className="examMap" aria-label="All exams and exercise sets">
          {course.exams.map((exam) => {
            const solved = exam.questions.filter(isSolved).length;
            return (
              <div className="examMapRow" key={exam.id}>
                <div className="examMapIdentity">
                  <strong>{exam.title}</strong>
                  <span>{solved}/{exam.questions.length}</span>
                </div>
                <div className="examMapSquares">
                  {exam.questions.map((question) => (
                    <ExamSquare
                      compact
                      examId={exam.id}
                      key={`${exam.id}-${question.id}`}
                      onStatusChange={onQuestionStatusChange}
                      question={question}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="examControls" aria-label="Exam filters">
        <label className="searchField">
          <Search size={16} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search exams, topics, questions"
            type="search"
            value={query}
          />
        </label>
        <div className="filterBar">
          {(["all", "open", "questions", "solved", "unmapped"] as const).map((item) => (
            <button
              className={filter === item ? "filterButton active" : "filterButton"}
              key={item}
              onClick={() => setFilter(item)}
              type="button"
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {visibleExams.map(({ exam, questions }) => (
        <section className="examCard" id={`exam-${exam.id}`} key={exam.id}>
          <header className="sectionHeader">
            <div className="sectionTitle">
              <span className="sectionIcon"><FileQuestion size={18} /></span>
              <div>
                <h2>{exam.title}</h2>
                <p>
                  {exam.sourcePath ? (
                    <span title={exam.sourcePath}>{exam.sourcePath.split("/").at(-1)}</span>
                  ) : "No source file"}
                  {exam.category ? ` · ${exam.category}` : ""}
                </p>
              </div>
            </div>
            <div className="examCardProgress">
              <span>{exam.questions.filter(isSolved).length}/{exam.questions.length} solved</span>
              <ProgressBar accent={course.accent} value={examProgress(exam)} />
            </div>
            <div className="examSourceActions">
              <button
                disabled={!exam.sourcePath}
                onClick={() => onOpenResource(exam.id)}
                title={exam.sourcePath ? "Open exam source" : "No source file is mapped"}
                type="button"
              >
                <FolderOpen size={15} />
              </button>
              <button
                onClick={() => onOpenDiscussion(exam.id)}
                title="Open linked discussion"
                type="button"
              >
                <MessageSquareText size={15} />
              </button>
            </div>
          </header>
          <div className="examSquareGrid" aria-label={`${exam.title} questions`}>
            {questions.map((question) => (
              <ExamSquare
                examId={exam.id}
                key={question.id}
                onStatusChange={onQuestionStatusChange}
                question={question}
              />
            ))}
          </div>
          <div className="examQuestionList">
            {questions.map((question) => (
              <article
                className={[
                  "examQuestionRow",
                  question.openQuestionCount ? "attention" : "",
                  !questionResourceById.get(question.id)?.taskIds.length
                    ? "unmapped"
                    : "",
                ].filter(Boolean).join(" ")}
                key={question.id}
              >
                <ExamSquare
                  examId={exam.id}
                  onStatusChange={onQuestionStatusChange}
                  question={question}
                />
                <div className="examQuestionCopy">
                  <strong>
                    {question.label}
                    {question.part ? <span>{question.part}</span> : null}
                    {question.points ? <span>{question.points} pts</span> : null}
                  </strong>
                  <p>{question.topic || question.prompt?.plainText || "Topic not mapped"}</p>
                  {!questionResourceById.get(question.id)?.taskIds.length ? (
                    <span className="unmappedLabel">Not linked to the study plan</span>
                  ) : null}
                </div>
                <div className="examQuestionMeta">
                  {question.openQuestionCount ? (
                    <span className="examQuestionFlag">
                      <CircleHelp size={13} /> {question.openQuestionCount}
                    </span>
                  ) : null}
                  <StatusBadge status={question.solveStatus} />
                  <button
                    className="resourceIconButton"
                    onClick={() => onFlagQuestion(question.id, question.label)}
                    title={`Add a question about ${question.label}`}
                    type="button"
                  >
                    <CircleHelp size={14} />
                  </button>
                  <label className="workflowSelect compact">
                    <span className="srOnly">Status for {question.label}</span>
                    <select
                      aria-label={`Status for ${question.label}`}
                      onChange={(event) =>
                        onQuestionStatusChange(
                          exam.id,
                          question,
                          event.target.value as ExamStatus,
                        )
                      }
                      value={question.solveStatus}
                    >
                      <option value="unsolved">Unsolved</option>
                      <option value="attempted">Attempted</option>
                      <option value="solved">Solved</option>
                      <option value="review">Review</option>
                      <option value="skipped">Skipped</option>
                    </select>
                  </label>
                </div>
                <div className="examQuestionNote">
                  <EntityNoteEditor
                    key={`${question.notes[0]?.id ?? question.id}:${question.notes[0]?.revision ?? 0}`}
                    label="Solution / notes"
                    note={question.notes[0]}
                    onSave={(html) =>
                      onNoteSave({
                        entityId: question.id,
                        entityType: "exam_question",
                        html,
                        kind: "exam_solution",
                        note: question.notes[0],
                      })
                    }
                    placeholder={`Solution, questions, and review notes for ${question.label}`}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!visibleExams.length ? <div className="emptyInline">No exam questions match this view.</div> : null}
    </div>
  );
}
