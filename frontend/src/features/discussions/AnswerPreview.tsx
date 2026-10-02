import { MarkdownMath } from "../../components/content/MarkdownMath";
import type { AnswerPreviewPart } from "./answerPreviewModel";

export function AnswerPreview({parts}: {parts: AnswerPreviewPart[]}) {
  return <div className="answerPreviewClip">
    {parts.map((part, index) => <div className={part.color ? `answerSelectedText color-${part.color}` : "answerPlainExcerpt"} key={index}>
      <MarkdownMath>{part.markdown}</MarkdownMath>
    </div>)}
  </div>;
}
