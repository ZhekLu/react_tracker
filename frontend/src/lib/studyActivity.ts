export function studyActivityLevel(
  progress: number,
  trackedSeconds: number,
): number {
  const timeLevel =
    trackedSeconds >= 4 * 3_600
      ? 4
      : trackedSeconds >= 2 * 3_600
        ? 3
        : trackedSeconds >= 45 * 60
          ? 2
          : trackedSeconds > 0
            ? 1
            : 0;
  const progressLevel =
    progress >= 1 ? 4 : progress >= 0.65 ? 3 : progress > 0 ? 1 : 0;
  return Math.max(timeLevel, progressLevel);
}
