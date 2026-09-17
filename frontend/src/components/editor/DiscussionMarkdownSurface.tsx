import { lazy, Suspense } from "react";
import type { DiscussionReviewItemInput } from "../../api/trackerApi";

export type DiscussionReviewItem = DiscussionReviewItemInput;

export type DiscussionMarkdownSurfaceProps = {
  className?: string;
  contentType?: "html" | "markdown";
  editable?: boolean;
  markdown: string;
  onCancel?: () => void;
  onChange?: (markdown: string) => void;
  onReviewItemsChange?: (items: DiscussionReviewItem[]) => void;
  onSave?: (markdown: string, reviewItems: DiscussionReviewItem[]) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  reviewMode?: boolean;
  initialReviewItems?: DiscussionReviewItem[];
  showActions?: boolean;
};

const DiscussionMarkdownSurfaceImpl = lazy(() =>
  import("./DiscussionMarkdownSurfaceImpl").then((module) => ({
    default: module.DiscussionMarkdownSurfaceImpl,
  })),
);

export function DiscussionMarkdownSurface(
  props: DiscussionMarkdownSurfaceProps,
) {
  return (
    <Suspense
      fallback={
        <div className="editorLoading">{props.editable ? "Loading editor…" : "Loading note…"}</div>
      }
    >
      <DiscussionMarkdownSurfaceImpl {...props} />
    </Suspense>
  );
}
