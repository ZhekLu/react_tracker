import type { Course, TaskStatus } from "../../types/tracker";

type ExamsViewProps = {
  course: Course;
};

const statusClass: Record<TaskStatus, string> = {
  done: "examSquare done",
  question: "examSquare question",
  later: "examSquare later",
  todo: "examSquare",
};

export function ExamsView({ course }: ExamsViewProps) {
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
      {course.exams.map((exam) => (
        <section className="examCard" key={exam.id}>
          <header className="sectionHeader">
            <div>
              <p className="eyebrow">{exam.sourcePath}</p>
              <h2>{exam.title}</h2>
            </div>
          </header>
          <div className="examSquareGrid" aria-label={`${exam.title} questions`}>
            {exam.questions.map((question) => (
              <button className={statusClass[question.status]} title={`${question.label}: ${question.topic}`} key={question.id}>
                {question.label}
              </button>
            ))}
          </div>
          <div className="examQuestionList">
            {exam.questions.map((question) => (
              <article className="examQuestionRow" key={question.id}>
                <strong>{question.label}</strong>
                <span>{question.topic}</span>
                <span className={`stateBadge tone-${question.status}`}>{question.status}</span>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
