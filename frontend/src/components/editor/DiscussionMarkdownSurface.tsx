import { lazy, Suspense } from "react";
import { MarkdownMath } from "../content/MarkdownMath";
import type { DiscussionReviewItemInput } from "../../api/trackerApi";

export type DiscussionReviewItem = DiscussionReviewItemInput;

export type DiscussionMarkdownSurfaceProps = {
  className?: string;
  contentType?: "html" | "markdown";
  editable?: boolean;
  markdown: string;
  onCancel?: () => void;
  onSave?: (markdown: string, reviewItems: DiscussionReviewItem[]) => void;
  placeholder?: string;
  reviewMode?: boolean;
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
        props.editable ? (
          <div className="editorLoading">Loading discussion editor...</div>
        ) : (
          props.contentType === "html" ? (
            <div
              className={`markdownMath ${props.className ?? ""}`.trim()}
              dangerouslySetInnerHTML={{ __html: props.markdown }}
            />
          ) : (
            <MarkdownMath className={props.className}>
              {props.markdown}
            </MarkdownMath>
          )
        )
      }
    >
      <DiscussionMarkdownSurfaceImpl {...props} />
    </Suspense>
  );
}
