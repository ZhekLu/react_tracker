import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownMathRendererProps = {
  className?: string;
  children: string;
};

export function MarkdownMathRenderer({
  className = "",
  children,
}: MarkdownMathRendererProps) {
  return (
    <div className={`markdownMath ${className}`.trim()}>
      <Markdown
        components={{
          a: ({ children: linkChildren, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank">
              {linkChildren}
            </a>
          ),
        }}
        rehypePlugins={[
          [rehypeKatex, { output: "htmlAndMathml", throwOnError: false }],
        ]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {children}
      </Markdown>
    </div>
  );
}
