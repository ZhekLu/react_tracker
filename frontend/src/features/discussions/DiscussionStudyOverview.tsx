import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, CheckCircle2, Pin, Search } from "lucide-react";
import type { Course, Discussion, ImportantAnswerInput } from "../../types/tracker";
import { discussionPriorityLabel, type DiscussionPriority } from "../../lib/discussionPriority";
import { buildDiscussionStudy, sortStudyAnswers, studyResourceGroups } from "./discussionStudyModel";
import { DiscussionAnswerCard } from "./DiscussionAnswerCard";
import "./discussion-study.css";

type Props = {
  course: Course; discussion: Discussion; questionIds?: string[];
  onReview: (questionIds: string[], label: string) => void;
  onHistory: (messageId?: string, discussionId?: string) => void;
  onToggleImportantAnswer: (input: ImportantAnswerInput) => void;
};

export function DiscussionStudyOverview({course, discussion, questionIds, ...actions}: Props) {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<DiscussionPriority | "all" | "pinned">("all");
  const [sourceId, setSourceId] = useState("");
  const [limit, setLimit] = useState(24);
  const [reading, setReading] = useState(true);
  const answers = useMemo(() => buildDiscussionStudy(course, discussion, questionIds), [course, discussion, questionIds]);
  const groups = useMemo(() => studyResourceGroups(answers), [answers]);
  const matches = sortStudyAnswers(answers.filter(answer => (!sourceId || answer.groupId === sourceId) &&
    (priority === "all" || (priority === "pinned" ? Boolean(answer.importantNote) : answer.priority === priority)) &&
    [answer.title, answer.groupTitle, ...(answer.item.answers ?? []).map(a => a.section.bodyMarkdown), ...answer.item.questions.map(q => `${q.stableLabel} ${q.body?.markdown ?? ""}`)]
      .join(" ").toLowerCase().includes(query.toLowerCase())));
  const visible = matches.slice(0, limit);
  const pinned = visible.filter(answer => answer.importantNote);
  const unpinned = visible.filter(answer => !answer.importantNote);
  const reviewable = answers.filter(answer => answer.item.questions.length > 0);
  const understood = reviewable.filter(answer => answer.understood).length;
  const ready = reviewable.filter(answer => answer.item.section && !answer.understood).length;
  return <section className={`discussionStudy ${reading ? "studyReading" : "studyCompact"}`} aria-label="Study overview">
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
      <div className="studyDisplaySwitch" role="group" aria-label="Discussion answer display">
        <button aria-pressed={reading} onClick={() => setReading(true)} type="button">Reading</button>
        <button aria-pressed={!reading} onClick={() => setReading(false)} type="button">Compact</button>
      </div>
    </div>
    <div className="studyPriorityFilters" aria-label="Filter answers by priority">
      {(["all", "pinned", "core", "high", "medium", "low", "unrated"] as const).map(value => <button key={value} type="button"
        className={`priority-${value}`} aria-pressed={priority === value} onClick={() => {setPriority(value); setLimit(24);}}>
        {value === "pinned" ? <><Pin size={12}/> Pinned</> : value === "all" ? "All answers" : discussionPriorityLabel(value)}
      </button>)}
    </div>
    <p className="studySortHint" role="status">{matches.length} threads & notes · pinned first, then priority · Q&A keeps its usual order</p>
    {pinned.length > 0 && <section className="studyPinnedShelf"><header><Pin size={16}/><h3>Your important notes</h3><span>Keep the ideas worth returning to</span></header><div className="studyAnswerList">{pinned.map(answer => <DiscussionAnswerCard key={answer.id} answer={answer} course={course} {...actions}/>)}</div></section>}
    <div className="studyAnswerList">{unpinned.map(answer => <DiscussionAnswerCard key={answer.id} answer={answer} course={course} {...actions}/>)}</div>
    {!matches.length && <div className="studyEmpty"><BookOpen size={24}/><h3>{answers.length ? "No notes match these filters" : "A home for your next discoveries"}</h3>
      <p>{answers.length ? "Try another priority or a few fewer words." : "Paste a tutor response to start collecting answers here."}</p>
      {answers.length > 0 ? <button type="button" className="commandButton subtle" onClick={() => {setQuery("");setSourceId("");setPriority("all");}}>Clear filters</button> : <button type="button" className="commandButton subtle" onClick={() => actions.onHistory()}>Write a message</button>}
    </div>}
    {matches.length > visible.length && <button className="commandButton subtle" type="button" onClick={() => setLimit(limit + 24)}>Show 24 more</button>}
  </section>;
}
