import { useState } from "react";
import { ArrowUpRight, CheckCircle2, ChevronDown, History, Pin } from "lucide-react";
import type { Course, ImportantAnswerInput } from "../../types/tracker";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { annotationIsScreenshot, metadataText } from "../../components/annotations/annotationDisplay";
import { discussionPriorityLabel } from "../../lib/discussionPriority";
import type { StudyAnswer } from "./discussionStudyModel";
import { answerDisplayTitle, answerPreviewParts } from "./answerPreviewModel";
import { AnswerPreview } from "./AnswerPreview";

export function DiscussionAnswerCard({answer, course, history = false, onReview, onHistory, onToggleImportantAnswer}: {
  answer: StudyAnswer; course: Course; history?: boolean;
  onReview: (ids: string[], label: string) => void;
  onHistory: (messageId?: string, discussionId?: string) => void;
  onToggleImportantAnswer: (input: ImportantAnswerInput) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const section = answer.item.section;
  const questions = answer.item.questions.filter(q => q.status !== "archived");
  const sources = answer.item.rootQuestions ?? questions;
  const source = sources.find(q => metadataText(q, "contextImageUrl") || (annotationIsScreenshot(q) && metadataText(q, "annotatedPageImageUrl"))) ?? sources[0];
  const sourceImage = source ? metadataText(source, "contextImageUrl") || (annotationIsScreenshot(source) ? metadataText(source, "annotatedPageImageUrl") : "") : "";
  const title = answerDisplayTitle(section, course.resources.filter(r => answer.sourceIds.includes(r.id)).map(r => r.title), sources);
  const parts = section ? answerPreviewParts(section, course.annotations) : [{markdown: "Awaiting a tutor response."}];
  const label = questions[0]?.stableLabel || section?.label || "Note";
  const qa = () => onReview(questions.map(q => q.id), title || label);
  return <article className={`studyAnswer priority-${answer.priority}${answer.importantNote ? " isPinned" : ""}${expanded ? " isExpanded" : ""}`}>
    <div className="studyAnswerTop">
      <span className={`qaPriorityBadge priority-${answer.priority}`}>{discussionPriorityLabel(answer.priority)}</span>
      <span className="studyAnswerState">{answer.understood ? <><CheckCircle2 size={11}/> Understood</> : section ? "To review" : "Awaiting"}</span>
      {!history && <span className="studySourceTag" title={answer.groupTitle}>{answer.groupTitle}</span>}
      <span className="studyAnswerLocation" title={label}>{[source?.anchor?.pageNumber ? `p. ${source.anchor.pageNumber}` : "", history && section ? `#${section.messageSequenceNumber}` : ""].filter(Boolean).join(" · ")}</span>
      <div className="studyAnswerTools">
        {section && <button className="studyPinButton" type="button" aria-pressed={Boolean(answer.importantNote)}
          aria-label={`${answer.importantNote ? "Unpin" : "Pin"} ${answer.title}`} title={answer.importantNote ? "Unpin study note" : "Pin study note"}
          onClick={() => onToggleImportantAnswer({existingNote: answer.importantNote, messageId: section.messageId,
            sectionLabel: section.label, markdown: section.bodyMarkdown, title: title || answer.title, questionIds: questions.map(q => q.id)})}><Pin size={12}/></button>}
        {questions.length > 0 && <button type="button" onClick={qa} title="Open Q&A" aria-label={`Open Q&A · ${title || label}`}><ArrowUpRight size={13}/></button>}
        {section && <button type="button" onClick={() => onHistory(section.messageId, answer.item.sectionDiscussionId)} title="Full response & editing" aria-label={`Full response · ${title || label}`}><History size={12}/></button>}
        {section && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} title={expanded ? "Collapse answer" : "Read full answer"} aria-label={`${expanded ? "Collapse" : "Read full"} answer · ${title || label}`}><ChevronDown size={13}/></button>}
      </div>
    </div>
    {title && <h4 className="studyAnswerHeading"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} title={title}>{title}</button></h4>}
    {expanded ? <div className="studyAnswerBody"><MarkdownMath>{section?.bodyMarkdown || ""}</MarkdownMath></div> :
      <div className={`studyAnswerContent${sourceImage ? " hasImage" : ""}`}>
        {sourceImage && <button className="studySourceThumbnail" type="button" onClick={questions.length ? qa : () => setExpanded(true)} aria-label={`Open source · ${title || label}`} title="Open source in Q&A">
          <img src={sourceImage} loading="lazy" alt={`Question context · ${title || label}`}/>
        </button>}
        <AnswerPreview parts={parts}/>
      </div>}
  </article>;
}
