import { expect, test, vi } from 'vitest';
import { createRevisionQueue } from './revisionQueue';

test('rapid clicks wait for server revisions, including a new chapter', async () => {
  const queue = createRevisionQueue();
  const revisions: (number | null | undefined)[] = [];
  let resolve!: (value: {revision: number}) => void;
  const first = queue.enqueue('chapter', null, (revision) => {
    revisions.push(revision);
    return new Promise((done) => {resolve = done;});
  });
  const second = queue.enqueue('chapter', null, async (revision) => {
    revisions.push(revision); return {revision: 2};
  });
  await Promise.resolve();
  expect(revisions).toEqual([null]);
  resolve({revision: 1});
  expect(await first).toBe(1);
  expect(await second).toBe(2);
  expect(revisions).toEqual([null, 1]);
});

test('a conflict cancels queued clicks and allows a retry after refresh', async () => {
  const queue = createRevisionQueue();
  const rejected = queue.enqueue('chapter', 1, async () => {throw Error('Conflict');});
  const save = vi.fn();
  const next = queue.enqueue('chapter', 1, save);
  await expect(rejected).rejects.toThrow('Conflict');
  await expect(next).rejects.toThrow('Conflict');
  expect(save).not.toHaveBeenCalled();
  await expect(queue.enqueue('chapter', 3, async (revision) => ({revision: revision! + 1}))).resolves.toBe(4);
});
