import { lazy, Suspense } from "react";
import { MarkdownMath } from "../content/MarkdownMath";

export type DiscussionMarkdownSurfaceProps = {
  className?: string;
  editable?: boolean;
  markdown: string;
  onCancel?: () => void;
  onSave?: (markdown: string) => void;
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
          <MarkdownMath className={props.className}>
            {props.markdown}
          </MarkdownMath>
        )
      }
    >
      <DiscussionMarkdownSurfaceImpl {...props} />
    </Suspense>
  );
}
