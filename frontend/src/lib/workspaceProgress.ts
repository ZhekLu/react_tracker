import type { Course, DayStatus, TaskStatus } from '../types/tracker';

export function applyTaskStatus(course: Course, id: string, status: TaskStatus, revision?: number): Course {
  const days = course.days.map((day) => {
    if (!day.sections.some((section) => section.tasks.some((task) => task.id === id))) return day;
    const sections = day.sections.map((section) => ({...section, tasks: section.tasks.map((task) =>
      task.id === id ? {...task, status, deferUntil: null, revision: revision ?? task.revision} : task)}));
    const tasks = sections.flatMap((section) => section.tasks);
    const required = tasks.filter((task) => !task.isOptional);
    const done = required.filter((task) => task.status === 'done').length;
    const skipped = required.filter((task) => task.status === 'skipped').length;
    return {...day, sections, progress: {
      required: required.length, done, skipped,
      later: required.filter((task) => task.status === 'later').length,
      optional: tasks.length - required.length,
      ratio: required.length > skipped ? done / (required.length - skipped) : 0,
    }};
  });
  const tasks = days.flatMap((day) => day.sections.flatMap((section) => section.tasks));
  return {...course, days, stats: {...course.stats,
    completedTaskCount: tasks.filter((task) => task.status === 'done').length,
    doLaterCount: tasks.filter((task) => task.status === 'later').length,
    progressRatio: days.length ? days.reduce((sum, day) => sum + day.progress.ratio, 0) / days.length : 0,
  }};
}

export function applyDayStatus(course: Course, id: string, status: DayStatus, revision?: number): Course {
  const days = course.days.map((day) => day.id === id ? {...day, status, revision: revision ?? day.revision} : day);
  const closed = new Set(days.filter((day) => ['closed', 'completed'].includes(day.status)).map((day) => day.id));
  return {...course, days, skills: course.skills.map((skill) => {
    const completedDayCount = skill.dayIds.filter((dayId) => closed.has(dayId)).length;
    return {...skill, completedDayCount, covered: skill.dayIds.length > 0 && completedDayCount >= skill.dayIds.length};
  })};
}
