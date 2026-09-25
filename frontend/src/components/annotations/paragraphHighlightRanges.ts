import type { Annotation } from "../../types/tracker";

type HighlightRange = {
  start: number;
  end: number;
  annotation: Annotation;
};

type NormalizedSearchText = {
  indexes: number[];
  text: string;
};

function normalizedSearchText(value: string): NormalizedSearchText {
  const indexes: number[] = [];
  let text = "";
  let offset = 0;

  for (const character of value) {
    const expanded = character
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[‐‑‒–—−]/g, "-")
      .toLocaleLowerCase();
    if (/^[\p{L}\p{N}]+$/u.test(expanded)) {
      for (const item of expanded) {
        text += item;
        indexes.push(offset);
      }
    } else if (text && !text.endsWith(" ")) {
      text += " ";
      indexes.push(offset);
    }
    offset += character.length;
  }
  return { indexes, text: text.trimEnd() };
}

function normalizedRanges(
  paragraph: string,
  phrase: string,
): Array<{ start: number; end: number }> {
  const haystack = normalizedSearchText(paragraph);
  const needle = normalizedSearchText(phrase).text;
  if (needle.length < 2) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let normalizedStart = haystack.text.indexOf(needle);
  while (normalizedStart >= 0) {
    const normalizedEnd = normalizedStart + needle.length - 1;
    const start = haystack.indexes[normalizedStart] ?? 0;
    const lastSourceIndex = haystack.indexes[normalizedEnd] ?? start;
    const nextSourceIndex = haystack.indexes
      .slice(normalizedEnd + 1)
      .find((index) => index > lastSourceIndex);
    ranges.push({
      end: nextSourceIndex ?? paragraph.length,
      start,
    });
    normalizedStart = haystack.text.indexOf(
      needle,
      normalizedStart + Math.max(needle.length, 1),
    );
  }
  return ranges;
}

export function paragraphHighlightRanges(
  paragraph: string,
  annotations: Annotation[],
): HighlightRange[] {
  const candidates: HighlightRange[] = [];

  for (const annotation of annotations) {
    const quote = annotation.anchor?.quote?.trim();
    if (!quote || quote.length < 2) continue;
    const ranges = normalizedRanges(paragraph, quote);
    for (const range of ranges) {
      candidates.push({
        annotation,
        ...range,
      });
    }
  }
  return candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );
}

