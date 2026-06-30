import { lazy, Suspense } from "react";
import { normalizeMathMarkdown } from "../../lib/mathMarkdown";

type MarkdownMathProps = {
  className?: string;
  children: string;
};

const MarkdownMathRenderer = lazy(() =>
  import("./MarkdownMathRenderer").then((module) => ({
    default: module.MarkdownMathRenderer,
  })),
);

export function MarkdownMath({ className = "", children }: MarkdownMathProps) {
  const normalized = normalizeMathMarkdown(children);
  return (
    <Suspense
      fallback={
        <div className={`markdownMath markdownMathFallback ${className}`.trim()}>
          {normalized}
        </div>
      }
    >
      <MarkdownMathRenderer className={className}>
        {normalized}
      </MarkdownMathRenderer>
    </Suspense>
  );
}
