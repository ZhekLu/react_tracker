import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, CheckCircle2, ChevronDown, Pin, Search } from "lucide-react";
import type { Course, Discussion, ImportantAnswerInput } from "../../types/tracker";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { discussionPriorityLabel, type DiscussionPriority } from "../../lib/discussionPriority";
import { buildDiscussionStudy, sortStudyAnswers, studyResourceGroups, type StudyAnswer } from "./discussionStudyModel";
import "./discussion-study.css";

type Props = {
  course: Course; discussion: Discussion; questionIds?: string[];
  onReview: (questionIds: string[], label: string) => void;
  onHistory: (messageId?: string, discussionId?: string) => void;
  onToggleImportantAnswer: (input: ImportantAnswerInput) => void;
};

function AnswerCard({answer, onReview, onHistory, onToggleImportantAnswer}: Pick<Props, "onReview" | "onHistory" | "onToggleImportantAnswer"> & {answer: StudyAnswer}) {
  const [expanded, setExpanded] = useState(false);
  const section = answer.item.section;
  const questions = answer.item.questions.filter(q => q.status !== "archived");
  return <article className={`studyAnswer priority-${answer.priority}${answer.importantNote ? " isPinned" : ""}`}>
    <div className="studyAnswerTop">
      <span className={`qaPriorityBadge priority-${answer.priority}`}>{discussionPriorityLabel(answer.priority)}</span>
      {answer.importantNote && <span className="studyPinnedLabel"><Pin size={11}/> Pinned</span>}
      <span className="studyAnswerState">{answer.understood ? <><CheckCircle2 size={12}/> Understood</> : section ? "Ready to review" : "Awaiting a response"}</span>
      {section && <button className="studyPinButton" type="button" aria-pressed={Boolean(answer.importantNote)}
        aria-label={`${answer.importantNote ? "Unpin" : "Pin"} ${answer.title}`}
        title={answer.importantNote ? "Remove from important notes" : "Save as an important study note"}
        onClick={() => onToggleImportantAnswer({existingNote: answer.importantNote, messageId: section.messageId,
          sectionLabel: section.label, markdown: section.bodyMarkdown, title: answer.title, questionIds: questions.map(q => q.id)})}><Pin size={15}/></button>}
    </div>
    <h4><button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{answer.title}<ChevronDown size={14}/></button></h4>
    {!expanded && <p className="studyAnswerPreview">{answer.preview}</p>}
    {expanded && <div className="studyAnswerBody"><MarkdownMath>{section?.bodyMarkdown || questions[0]?.body?.markdown || "Open Q&A to see the source capture."}</MarkdownMath></div>}
    <footer>
      <span title={answer.groupTitle}>{answer.importantNote ? answer.groupTitle : questions[0]?.stableLabel || section?.label || "Question"}{(answer.item.answers?.length ?? 0) > 1 ? ` · ${answer.item.answers!.length} responses` : ""}</span>
      {questions.length > 0 && <button type="button" onClick={() => onReview(questions.map(q => q.id), answer.title)}>Open Q&A <ArrowUpRight size={13}/></button>}
      {section && <button type="button" onClick={() => onHistory(section.messageId, answer.item.sectionDiscussionId)}>Full response</button>}
    </footer>
  </article>;
}

export function DiscussionStudyOverview({course, discussion, questionIds, ...actions}: Props) {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<DiscussionPriority | "all" | "pinned">("all");
  const [sourceId, setSourceId] = useState("");
  const [limit, setLimit] = useState(24);
  const answers = useMemo(() => buildDiscussionStudy(course, discussion, questionIds), [course, discussion, questionIds]);
  const groups = useMemo(() => studyResourceGroups(answers), [answers]);
  const matches = sortStudyAnswers(answers.filter(answer => (!sourceId || answer.groupId === sourceId) &&
    (priority === "all" || (priority === "pinned" ? Boolean(answer.importantNote) : answer.priority === priority)) &&
    [answer.title, answer.groupTitle, ...(answer.item.answers ?? []).map(a => a.section.bodyMarkdown), ...answer.item.questions.map(q => `${q.stableLabel} ${q.body?.markdown ?? ""}`)]
      .join(" ").toLowerCase().includes(query.toLowerCase())));
  const visible = matches.slice(0, limit);
  const pinned = visible.filter(answer => answer.importantNote);
  const visibleGroups = studyResourceGroups(visible.filter(answer => !answer.importantNote));
  const reviewable = answers.filter(answer => answer.item.questions.length > 0);
  const understood = reviewable.filter(answer => answer.understood).length;
  const ready = reviewable.filter(answer => answer.item.section && !answer.understood).length;
  return <section className="discussionStudy" aria-label="Study overview">
    <header className="studyWelcome">
      <div><p className="eyebrow">Make it stick</p><h3>{ready ? `${ready} ${ready === 1 ? "question" : "questions"} ready to understand` : understood ? "Look how much you’ve connected" : "Your next insight starts here"}</h3>
        <p>{understood} of {reviewable.length} question threads understood · {answers.filter(a => a.importantNote).length} pinned for later</p></div>
      <div className="studyProgress" role="progressbar" aria-label="Discussion questions understood" aria-valuenow={understood} aria-valuemin={0} aria-valuemax={Math.max(1,reviewable.length)}>
        <span style={{width: `${reviewable.length ? 100 * understood / reviewable.length : 0}%`}}/>
      </div>
    </header>
    {discussion.scopeType !== "resource" && groups.some(group => group.questionIds.length > 0) && <div className="studyResourceTiles" aria-label="Review by resource">
      {groups.filter(group => group.questionIds.length > 0).map(group => {
        const total = group.answers.filter(a => a.item.questions.length).length;
        const done = group.answers.filter(a => a.understood).length;
        return <button key={group.id} className={`studyResourceTile${done === total && total ? " complete" : ""}`} type="button"
          onClick={() => actions.onReview(group.questionIds, group.title)}>
          <span className="studyTileIcon"><BookOpen size={17}/>{done === total && total ? <CheckCircle2 size={15}/> : <ArrowUpRight size={15}/>}</span>
          <strong>{group.title}</strong><span>{done} / {total} threads understood</span>
          <span className="studyTileProgress" aria-hidden="true"><i style={{width: `${total ? done / total * 100 : 0}%`}}/></span>
          <small>Review this resource</small>
        </button>;
      })}
    </div>}
    <div className="studyFilters">
      <label className="studySearch"><Search size={16}/><input aria-label="Search this discussion" type="search" value={query} placeholder="Find an idea, question or answer…" onChange={event => {setQuery(event.target.value); setLimit(24);}}/></label>
      <select aria-label="Filter answers by resource" value={sourceId} onChange={event => {setSourceId(event.target.value); setLimit(24);}}><option value="">All resources</option>{groups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select>
    </div>
    <div className="studyPriorityFilters" aria-label="Filter answers by priority">
      {(["all", "pinned", "core", "high", "medium", "low", "unrated"] as const).map(value => <button key={value} type="button"
        className={`priority-${value}`} aria-pressed={priority === value} onClick={() => {setPriority(value); setLimit(24);}}>
        {value === "pinned" ? <><Pin size={12}/> Pinned</> : value === "all" ? "All answers" : discussionPriorityLabel(value)}
      </button>)}
    </div>
    <p className="studySortHint" role="status">{matches.length} threads & notes · pinned first, then priority · Q&A keeps its usual order</p>
    {pinned.length > 0 && <section className="studyPinnedShelf"><header><Pin size={16}/><h3>Your important notes</h3><span>Keep the ideas worth returning to</span></header><div className="studyAnswerList">{pinned.map(answer => <AnswerCard key={answer.id} answer={answer} {...actions}/>)}</div></section>}
    {visibleGroups.map(group => <section className="studyAnswerGroup" key={group.id}>
      <header><BookOpen size={15}/><h3>{group.title}</h3><span>{group.answers.length}</span></header>
      <div className="studyAnswerList">{group.answers.map(answer => <AnswerCard key={answer.id} answer={answer} {...actions}/>)}</div>
    </section>)}
    {!matches.length && <div className="studyEmpty"><BookOpen size={24}/><h3>{answers.length ? "No notes match these filters" : "A home for your next discoveries"}</h3>
      <p>{answers.length ? "Try another priority or a few fewer words." : "Paste a tutor response to start collecting answers here."}</p>
      {answers.length > 0 ? <button type="button" className="commandButton subtle" onClick={() => {setQuery("");setSourceId("");setPriority("all");}}>Clear filters</button> : <button type="button" className="commandButton subtle" onClick={() => actions.onHistory()}>Write a message</button>}
    </div>}
    {matches.length > visible.length && <button className="commandButton subtle" type="button" onClick={() => setLimit(limit + 24)}>Show 24 more</button>}
  </section>;
}
