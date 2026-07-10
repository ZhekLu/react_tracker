import { BookOpenCheck } from "lucide-react";
import type {
  Resource,
  ResourceChapter,
  ResourceChapterStatus,
} from "../../types/tracker";
import { nextChapterStatus } from "../../lib/chapterProgress";

type BookChapterProgressProps = {
  compact?: boolean;
  onChange: (
    resource: Resource,
    chapter: ResourceChapter,
    status: ResourceChapterStatus,
  ) => void;
  preferredChapterNumbers?: number[];
  resource: Resource;
};

export function BookChapterProgress({
  compact = false,
  onChange,
  preferredChapterNumbers = [],
  resource,
}: BookChapterProgressProps) {
  const preferred = new Set(preferredChapterNumbers);
  const chapters = preferred.size
    ? resource.chapters.filter((chapter) => preferred.has(chapter.number))
    : resource.chapters;
  if (resource.kind !== "book" || !chapters.length) return null;
  const full = chapters.filter((chapter) => chapter.status === "read_fully").length;

  return (
    <div
      aria-label={`Chapter progress for ${resource.title}`}
      className={`bookChapterProgress ${compact ? "compact" : ""}`}
    >
      <span className="bookChapterProgressLabel">
        <BookOpenCheck size={compact ? 10 : 12} />
        {compact ? `${full}/${chapters.length}` : `${full} of ${chapters.length} read`}
      </span>
      <div className="bookChapterSquares">
        {chapters.map((chapter) => (
          <button
            aria-label={`Chapter ${chapter.number}, ${chapter.title}: ${chapter.status.replaceAll("_", " ")}`}
            className={`chapter-${chapter.status} ${chapter.planned ? "planned" : "unplanned"}`}
            key={chapter.number}
            onClick={() =>
              onChange(resource, chapter, nextChapterStatus(chapter.status))
            }
            title={`Chapter ${chapter.number} · ${chapter.title} · ${chapter.planned ? "planned" : "not planned"} · click to update`}
            type="button"
          >
            <span>{chapter.number}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
