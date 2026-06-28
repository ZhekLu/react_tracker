import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ExamsView } from "../features/exams/ExamsView";
import { ResourcesView } from "../features/resources/ResourcesView";
import { RoadmapView } from "../features/roadmap/RoadmapView";
import { sampleCourses } from "../mocks/sampleData";
import type { Course, TaskStatus, TrackerView } from "../types/tracker";

function taskProgress(course: Course, dayId: string): number {
  const day = course.days.find((item) => item.id === dayId);
  if (!day?.tasks.length) return 0;
  return day.tasks.filter((task) => task.status === "done").length / day.tasks.length;
}

export function App() {
  const [courses, setCourses] = useState<Course[]>(() => structuredClone(sampleCourses));
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [view, setView] = useState<TrackerView>("roadmap");

  const course = useMemo(
    () => courses.find((item) => item.id === courseId) ?? courses[0],
    [courseId, courses],
  );

  function updateCourse(update: (current: Course) => Course) {
    setCourses((currentCourses) =>
      currentCourses.map((currentCourse) => (currentCourse.id === course.id ? update(currentCourse) : currentCourse)),
    );
  }

  function updateTask(dayId: string, taskId: string, status: TaskStatus) {
    updateCourse((currentCourse) => {
      const nextCourse = {
        ...currentCourse,
        days: currentCourse.days.map((day) =>
          day.id === dayId
            ? {
                ...day,
                tasks: day.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
              }
            : day,
        ),
      };

      return {
        ...nextCourse,
        days: nextCourse.days.map((day) =>
          day.id === dayId ? { ...day, progress: taskProgress(nextCourse, dayId) } : day,
        ),
      };
    });
  }

  function updateDayClosed(dayId: string, closed: boolean) {
    updateCourse((currentCourse) => ({
      ...currentCourse,
      days: currentCourse.days.map((day) => (day.id === dayId ? { ...day, closed } : day)),
    }));
  }

  function updateDayNote(dayId: string, noteHtml: string) {
    updateCourse((currentCourse) => ({
      ...currentCourse,
      days: currentCourse.days.map((day) => (day.id === dayId ? { ...day, noteHtml } : day)),
    }));
  }

  function markResourceRead(resourceId: string) {
    updateCourse((currentCourse) => ({
      ...currentCourse,
      resources: currentCourse.resources.map((resource) =>
        resource.id === resourceId ? { ...resource, progress: resource.progress === 1 ? 0 : 1 } : resource,
      ),
    }));
  }

  function updateExamQuestion(examId: string, questionId: string, status: TaskStatus) {
    updateCourse((currentCourse) => ({
      ...currentCourse,
      exams: currentCourse.exams.map((exam) =>
        exam.id === examId
          ? {
              ...exam,
              questions: exam.questions.map((question) =>
                question.id === questionId ? { ...question, status } : question,
              ),
            }
          : exam,
      ),
    }));
  }

  return (
    <AppShell course={course} courses={courses} view={view} onCourseChange={setCourseId} onViewChange={setView}>
      {view === "roadmap" ? (
        <RoadmapView
          course={course}
          onDayClosedChange={updateDayClosed}
          onDayNoteChange={updateDayNote}
          onTaskStatusChange={updateTask}
        />
      ) : null}
      {view === "resources" ? <ResourcesView course={course} onResourceReadToggle={markResourceRead} /> : null}
      {view === "exams" ? <ExamsView course={course} onQuestionStatusChange={updateExamQuestion} /> : null}
    </AppShell>
  );
}
