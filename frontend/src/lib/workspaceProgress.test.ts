import { expect, test } from 'vitest';
import { applyDayStatus, applyTaskStatus } from './workspaceProgress';
import type { Course } from '../types/tracker';
const course = {
  days: [{id:'day', status:'open', revision:1, sections:[{tasks:[
    {id:'first', status:'todo', revision:1, isOptional:false},
    {id:'skip', status:'skipped', revision:1, isOptional:false},
    {id:'optional', status:'done', revision:1, isOptional:true},
  ]}], progress:{required:2, done:0, skipped:1, later:0, optional:1, ratio:0}}],
  skills:[{id:'one', dayIds:['day'], completedDayCount:0, covered:false},
    {id:'two', dayIds:['day','other'], completedDayCount:0, covered:false}],
  stats:{completedTaskCount:1, doLaterCount:0, progressRatio:0},
} as unknown as Course;

test('task progress excludes skipped/optional tasks from the required denominator', () => {
  const next = applyTaskStatus(course, 'first', 'done', 2);
  expect(next.days[0].progress).toEqual({required:2, done:1, skipped:1, later:0, optional:1, ratio:1});
  expect(next.stats.completedTaskCount).toBe(2);
  expect(next.stats.progressRatio).toBe(1);
  expect(next.days[0].sections[0].tasks[0].revision).toBe(2);
  expect(course.days[0].sections[0].tasks[0].status).toBe('todo');
});
test('closing a day only covers skills whose entire linked scope is closed', () => {
  const next = applyDayStatus(course, 'day', 'closed', 2);
  expect(next.skills.map((skill) => skill.covered)).toEqual([true, false]);
  expect(next.skills.map((skill) => skill.completedDayCount)).toEqual([1, 1]);
});
