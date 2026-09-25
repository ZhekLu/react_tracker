import { taskReviewParts } from "./taskReview";

/** Strip only complete structural review blocks; preserve code and all original
 * source slices. Malformed boundaries fall back to the complete note. */
export function originalTaskWork(markdown: string): {markdown: string; reviewCount: number; reviews: string[]} {
  let fence: string | null = null;
  let opening: {id: string; start: number; contentStart: number} | null = null;
  let offset = 0;
  const ranges: {start: number; end: number; content: string}[] = [];
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
    } else if (boundary) fence = boundary[1];
    else {
      const tag = line.match(/^<!-- (\/)?tutor-review:([a-zA-Z0-9-]+) -->\s*$/);
      if (tag) {
        if (!tag[1]) {
          if (opening) return {markdown, reviewCount: 0, reviews: []};
          opening = {id: tag[2], start: offset, contentStart: offset + line.length};
        } else {
          if (!opening || opening.id !== tag[2]) return {markdown, reviewCount: 0, reviews: []};
          ranges.push({start: opening.start, end: offset + line.length, content: markdown.slice(opening.contentStart, offset).trim()}); opening = null;
        }
      }
    }
    offset += line.length;
  }
  if (opening) return {markdown, reviewCount: 0, reviews: []};
  for (const range of [...ranges].reverse()) markdown = markdown.slice(0, range.start) + markdown.slice(range.end);
  return {markdown: markdown.trim(), reviewCount: ranges.length, reviews: ranges.map(range => range.content)};
}

export function taskNoteCopyParts(markdown: string) {
  return taskReviewParts(markdown, undefined, []).map(part => ({...part,
    title: part.title === "Introduction / review" ? "Opening note" : part.title,
    isMyWork: /^(?:my\s+(?:work|attempt|answers?|explanation|solution|notes?)|worked example)\b/i.test(part.title),
  }));
}
