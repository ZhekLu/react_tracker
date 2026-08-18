import { MessageSquareText } from "lucide-react";
import type { AnnotationAnswerReference } from "../../types/tracker";
import { MarkdownMath } from "../content/MarkdownMath";

type QuestionAnswerReferencesProps = {
  references?: AnnotationAnswerReference[];
};

export function QuestionAnswerReferences({
  references = [],
}: QuestionAnswerReferencesProps) {
  if (!references.length) return null;
  return (
    <div className="questionAnswerReferences">
      {references.map((reference) => (
        <section className="questionAnswerReference" key={reference.id}>
          <header>
            <span><MessageSquareText size={11} /> Tutor</span>
            <small title={reference.discussionTitle}>
              {reference.sectionLabel} · response {reference.messageSequenceNumber}
            </small>
          </header>
          <MarkdownMath>{reference.markdown}</MarkdownMath>
        </section>
      ))}
    </div>
  );
}
