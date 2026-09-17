import type { Annotation } from '../types/tracker';

/** Resolve the saved page version, including neighboring pages, before a legacy fallback. */
export function sourcePageSnapshot(questions: Annotation[], page: number): string | null {
  const ordered = [...questions].sort((a, b) =>
    Number(b.anchor?.pageNumber === page) - Number(a.anchor?.pageNumber === page));
  for (const question of ordered) {
    const metadata = question.anchor?.metadata;
    const pages = metadata?.annotatedPageImageUrls;
    if (pages && typeof pages === 'object' && !Array.isArray(pages)) {
      const url = (pages as Record<string, unknown>)[String(page)];
      if (typeof url === 'string' && url) return url;
    }
    if (question.anchor?.pageNumber === page) {
      const url = metadata?.annotatedPageImageUrl;
      if (typeof url === 'string' && url) return url;
    }
  }
  return null;
}
