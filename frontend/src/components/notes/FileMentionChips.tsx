import { FileCode2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchCourseFiles,
  openCourseFile,
  type CourseFileItem,
} from "../../api/trackerApi";

type FileMentionChipsProps = {
  courseId?: string;
  markdown: string;
};

function fileMentions(markdown: string): string[] {
  const matches = markdown.matchAll(
    /@\s*([A-Za-z0-9][A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,12})/g,
  );
  return [...new Set([...matches].map((match) => match[1]))];
}

function resolveMention(
  mention: string,
  files: CourseFileItem[],
): CourseFileItem | undefined {
  const normalized = mention.replace(/^\.\//, "");
  return (
    files.find((file) => file.relativePath === normalized) ??
    files.find((file) => file.name === normalized)
  );
}

export function FileMentionChips({
  courseId,
  markdown,
}: FileMentionChipsProps) {
  const mentions = useMemo(() => fileMentions(markdown), [markdown]);
  const [files, setFiles] = useState<CourseFileItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!courseId || !mentions.length) return;
    let cancelled = false;
    fetchCourseFiles(courseId)
      .then((items) => {
        if (!cancelled) setFiles(items);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load course files.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, mentions.length]);

  if (!mentions.length) return null;

  return (
    <div className="fileMentionChips" aria-label="Files mentioned in this note">
      {mentions.map((mention) => {
        const file = resolveMention(mention, files);
        return (
          <button
            className={file ? "" : "unresolved"}
            disabled={!file}
            key={mention}
            onClick={() => {
              if (!courseId || !file) return;
              setError("");
              void openCourseFile(courseId, file.id).catch(
                (caught: unknown) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "Could not open course file.",
                  ),
              );
            }}
            title={
              file
                ? `${file.rootName}/${file.relativePath}`
                : `No configured course file matches ${mention}`
            }
            type="button"
          >
            <FileCode2 size={12} />
            <span>{mention}</span>
          </button>
        );
      })}
      {error ? <small>{error}</small> : null}
    </div>
  );
}
