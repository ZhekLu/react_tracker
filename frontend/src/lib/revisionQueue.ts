/** Serialize writes to one entity using each server-confirmed revision.
 * A failed write cancels its queued successors so a conflict is never hidden.
 */
export function createRevisionQueue() {
  const pending = new Map<string, Promise<number>>();
  return {
    enqueue(
      key: string,
      revision: number | null | undefined,
      save: (revision: number | null | undefined) => Promise<{ revision: number }>,
    ): Promise<number> {
      const previous = pending.get(key) ?? Promise.resolve(revision);
      const next = previous.then(save).then((result) => result.revision);
      pending.set(key, next);
      const clear = () => { if (pending.get(key) === next) pending.delete(key); };
      void next.then(clear, clear);
      return next;
    },
  };
}
