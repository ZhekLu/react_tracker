import { CheckCircle2, CircleHelp, Clock3 } from "lucide-react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import type { Course, ExamQuestion, TaskStatus } from "../../types/tracker";

type ExamsViewProps = {
  course: Course;
  onQuestionStatusChange: (examId: string, questionId: string, status: TaskStatus) => void;
};

const statusClass: Record<TaskStatus, string> = {
  done: "examSquare done",
  question: "examSquare question",
  later: "examSquare later",
  todo: "examSquare",
};

function ExamSquare({
  examId,
  question,
  onStatusChange,
}: {
  examId: string;
  question: ExamQuestion;
  onStatusChange: (examId: string, questionId: string, status: TaskStatus) => void;
}) {
  const reward = useCompletionReward();

  function toggleDone() {
    const nextStatus = question.status === "done" ? "todo" : "done";
    if (nextStatus === "done") reward.celebrate();
    onStatusChange(examId, question.id, nextStatus);
  }

  return (
    <button
      aria-label={`${question.label}: ${question.topic}, ${question.status}`}
      className={statusClass[question.status]}
      onClick={toggleDone}
      title={`${question.label}: ${question.topic}`}
      type="button"
    >
      {question.label}
      <CompletionBurst token={reward.token} />
    </button>
  );
}

export function ExamsView({ course, onQuestionStatusChange }: ExamsViewProps) {
  if (!course.exams.length) {
    return (
      <section className="emptyPanel">
        <h2>No exam tracker for this course</h2>
        <p>Project-only courses can use Roadmap and Resources without the exam dashboard.</p>
      </section>
    );
  }

  const allQuestions = course.exams.flatMap((exam) => exam.questions);
  const doneCount = allQuestions.filter((question) => question.status === "done").length;
  const questionCount = allQuestions.filter((question) => question.status === "question").length;
  const laterCount = allQuestions.filter((question) => question.status === "later").length;

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
          </div>
        </header>
        <div className="examActivityGrid" aria-label="All exam questions">
          {course.exams.flatMap((exam) =>
            exam.questions.map((question) => (
              <ExamSquare
                examId={exam.id}
                key={`${exam.id}-${question.id}`}
                onStatusChange={onQuestionStatusChange}
                question={question}
              />
            )),
          )}
        </div>
      </section>
      {course.exams.map((exam) => (
        <section className="examCard" key={exam.id}>
          <header className="sectionHeader">
            <div className="sectionTitle">
              <div>
                <p className="eyebrow" title={exam.sourcePath}>Source · {exam.sourcePath.split("/").at(-1)}</p>
                <h2>{exam.title}</h2>
              </div>
            </div>
          </header>
          <div className="examSquareGrid" aria-label={`${exam.title} questions`}>
            {exam.questions.map((question) => (
              <ExamSquare
                examId={exam.id}
                key={question.id}
                onStatusChange={onQuestionStatusChange}
                question={question}
              />
            ))}
          </div>
          <div className="examQuestionList">
            {exam.questions.map((question) => (
              <article className="examQuestionRow" key={question.id}>
                <strong>{question.label}</strong>
                <span>{question.topic}</span>
                <StatusBadge status={question.status} />
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
