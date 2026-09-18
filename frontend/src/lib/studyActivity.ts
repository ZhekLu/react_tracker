import type { Course, StudyDay } from "../types/tracker";
import { trackedQuestionGroups } from "./questionIdentity";

export function studyActivityLevel(progress: number, trackedSeconds: number): number {
  const timeLevel = trackedSeconds >= 4 * 3600 ? 4 : trackedSeconds >= 2 * 3600 ? 3
    : trackedSeconds >= 45 * 60 ? 2 : trackedSeconds > 0 ? 1 : 0;
  const progressLevel = progress >= 1 ? 4 : progress >= 0.65 ? 3 : progress >= 0.3 ? 2 : progress > 0 ? 1 : 0;
  return Math.max(timeLevel, progressLevel);
}

export function dayAchievements(day: StudyDay, liveSeconds = 0) {
  const tasks = day.sections.flatMap(section => section.tasks).filter(task => task.status !== "skipped");
  const core = tasks.filter(task => !task.isOptional);
  const done = tasks.filter(task => task.status === "done").length;
  const coreDone = core.filter(task => task.status === "done").length;
  const trackedSeconds = Math.max(0, day.trackedSeconds, liveSeconds);
  const ratio = core.length ? coreDone / core.length : tasks.length ? done / tasks.length : 0;
  const todoDone = day.todoCounts?.done ?? 0;
  const started = done > 0 || todoDone > 0 || trackedSeconds > 0 || tasks.some(task => task.status === "in_progress");
  return {day, done, coreDone, coreTotal: core.length, todoDone, trackedSeconds, started,
    complete: core.length > 0 && coreDone === core.length,
    level: started ? Math.max(1, studyActivityLevel(ratio, trackedSeconds)) : 0};
}

export function courseAchievements(course: Course) {
  const tasks = course.days.flatMap(day => day.sections.flatMap(section => section.tasks))
    .filter(task => task.status !== "skipped");
  const core = tasks.filter(task => !task.isOptional);
  const bonus = tasks.filter(task => task.isOptional);
  const coreDone = core.filter(task => task.status === "done").length;
  const bonusDone = bonus.filter(task => task.status === "done").length;
  const groups = trackedQuestionGroups(course.annotations).map(group => ({...group,
    annotations: group.annotations.filter(annotation => annotation.status !== "archived" && !annotation.skipped),
  })).filter(group => group.annotations.length);
  const questions = groups.filter(group => group.annotations.some(annotation => annotation.kind !== "todo"));
  const todos = groups.filter(group => group.annotations.every(annotation => annotation.kind === "todo"));
  const understood = (group: typeof groups[number]) => group.annotations.some(annotation => annotation.status === "answered");
  const questionDone = questions.filter(understood).length;
  const answersReady = questions.filter(group => !understood(group) && group.annotations.some(annotation =>
    !annotation.postponed && (annotation.discussionResponseCount ?? 0) > 0)).length;
  const todoDone = todos.filter(understood).length;
  const resources = course.resources.filter(resource => !["discussion", "exam_question"].includes(resource.kind) && resource.status !== "archived");
  const resourceDone = resources.filter(resource => ["read", "review"].includes(resource.status)).length;
  const resourceStarted = resources.filter(resource => !["read", "review"].includes(resource.status)
    && (resource.progress > 0 || ["skimmed", "reading"].includes(resource.status))).length;
  const exams = course.exams.flatMap(exam => exam.questions).filter(question => question.solveStatus !== "skipped");
  const examDone = exams.filter(question => ["solved", "review"].includes(question.solveStatus)).length;
  const nextMilestone = Math.min(core.length, coreDone === 0 ? 1 : (Math.floor(coreDone / 5) + 1) * 5);
  return {coreDone, coreTotal: core.length, bonusDone, bonusTotal: bonus.length,
    taskDone: coreDone + bonusDone, nextMilestone, questionDone, questionTotal: questions.length,
    answersReady, todoDone, todoTotal: todos.length, resourceDone, resourceTotal: resources.length,
    resourceStarted, skillDone: course.skills.filter(skill => skill.covered).length, skillTotal: course.skills.length,
    examDone, examTotal: exams.length};
}
