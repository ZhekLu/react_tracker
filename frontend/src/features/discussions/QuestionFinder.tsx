import { useEffect, useMemo, useState } from "react";
import { Search, ArrowUpRight, BookOpen } from "lucide-react";
import type { Course } from "../../types/tracker";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { buildQuestionIndex, finderSnippet, finderStatusLabels, searchQuestions, type FinderEntry } from "./questionSearchModel";
import { trackUsage } from "../../lib/usageLog";
import { importantAnswerNote, studyPreview } from "./discussionStudyModel";
import { discussionPriority, discussionPriorityLabel, discussionPriorityRank } from "../../lib/discussionPriority";
import "./question-finder.css";

export function QuestionFinder({course, onOpen, onOpenSource, onPrepare}: {
  course: Course; onOpen: (entry: FinderEntry) => void; onOpenSource: (id: string) => void; onPrepare: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [sourceId, setSourceId] = useState("");
  const [expanded, setExpanded] = useState("");
  const [limit, setLimit] = useState(30);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const index = useMemo(() => buildQuestionIndex(course), [course]);
  const priorities = useMemo(() => new Map(index.map(entry => [entry.id, {
    priority: discussionPriority(entry.answers.map(a => a.section.bodyMarkdown).join("\n\n"), entry.questions),
    pinned: Boolean(importantAnswerNote(course.notes, entry.questions, entry.answers.map(a => a.section))),
  }])), [course.notes, index]);
  const results = useMemo(() => searchQuestions(index, query, status, sourceId)
    .filter(entry => priorityFilter === "all" || (priorityFilter === "pinned" ? priorities.get(entry.id)?.pinned : priorities.get(entry.id)?.priority === priorityFilter))
    .sort((a,b) => Number(priorities.get(b.id)!.pinned) - Number(priorities.get(a.id)!.pinned) || discussionPriorityRank(priorities.get(b.id)!.priority) - discussionPriorityRank(priorities.get(a.id)!.priority)),
    [index, query, status, sourceId, priorities, priorityFilter]);
  useEffect(() => {
    if (!query.trim()) return;
    const timer = window.setTimeout(() => trackUsage("question.search", {result_count: results.length}), 800);
    return () => window.clearTimeout(timer);
  }, [query, results.length, status, sourceId]);
  const sources = course.resources.filter(r => index.some(e => e.sourceIds.includes(r.id)));
  return <section className="questionFinder" aria-label="Find questions and answers">
    <header><div><p className="eyebrow">Across this course</p><h2>Find a question or its answer</h2><p>Search question IDs, your question, a phrase from the answer, or a source.</p></div></header>
    <div className="questionFinderFilters">
      <label className="questionSearch"><Search size={18}/><input aria-label="Search questions and answers" type="search" placeholder="Question ID, topic, or words you remember…" value={query} onChange={e => {setQuery(e.target.value); setLimit(30);}}/></label>
      <select aria-label="Question status" value={status} data-track="question.filter" onChange={e => {setStatus(e.target.value); setLimit(30);}}>
        <option value="active">All active</option><option value="all">Include archived</option>
        {Object.entries(finderStatusLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <select aria-label="Question source" value={sourceId} data-track="question.source" onChange={e => {setSourceId(e.target.value); setLimit(30);}}>
        <option value="">All sources</option>{sources.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
      </select>
      <select aria-label="Question importance" value={priorityFilter} onChange={e => {setPriorityFilter(e.target.value); setLimit(30);}}>
        <option value="all">All priorities</option><option value="pinned">Pinned notes</option>
        {(["core", "high", "medium", "low", "unrated"] as const).map(priority => <option key={priority} value={priority}>{discussionPriorityLabel(priority)}</option>)}
      </select>
    </div>
    <p className="questionResultCount" role="status">{results.length} {results.length === 1 ? "result" : "results"} · {index.filter(e => e.questions.length && e.status !== "archived").length} active questions in this course</p>
    {!results.length && <div className="questionFinderEmpty"><h3>No matching questions or answers</h3><p>Try fewer words, another source, or include archived questions.</p><button className="commandButton subtle" onClick={() => {setQuery(""); setStatus("all"); setSourceId(""); setPriorityFilter("all");}}>Clear filters and include archived</button></div>}
    <div className="questionResults">{results.slice(0,limit).map(entry => {
      const answer = entry.answers.find(a => query.trim() && a.section.bodyMarkdown.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? entry.answers.at(-1);
      const conversationSource = course.discussions.some(d => d.resourceId === entry.sourceIds[0]);
      const importance = priorities.get(entry.id)!;
      return <article key={entry.id} className={`questionResult priority-${importance.priority}${importance.pinned ? " isPinned" : ""}`}>
        <div className="questionPriorityMeta"><span className={`qaPriorityBadge priority-${importance.priority}`}>{discussionPriorityLabel(importance.priority)}</span>{importance.pinned && <span>Pinned study note</span>}</div>
        <div className="questionResultMeta"><strong>{entry.label}</strong><span className={`questionState ${entry.status}`}>{finderStatusLabels[entry.status]}</span><span>{entry.answers.length} {entry.answers.length === 1 ? "response" : "responses"}</span></div>
        <h3><button data-track="question.preview" aria-expanded={expanded === entry.id} onClick={() => setExpanded(expanded === entry.id ? "" : entry.id)}>{studyPreview(entry.text || entry.context, 180) || "Question captured from source"}</button></h3>
        <p className="questionResultContext">{entry.context}</p>
        {answer && <div className="questionAnswerPreview"><strong>Answer</strong><p>{finderSnippet(answer.section.bodyMarkdown, query)}</p></div>}
        {expanded === entry.id && <div className="questionExpanded"><MarkdownMath>{entry.text || "Open the source to see this capture."}</MarkdownMath></div>}
        <footer>{entry.answers.length ? <button className="commandButton" data-track="question.open_answer" onClick={() => onOpen(entry)}><ArrowUpRight size={14}/>{entry.questions.length ? "Open in Q&A" : "Open response"}</button> : entry.status === "no-response" && !conversationSource ? <button className="commandButton" data-track="question.prepare" title="Copy the pending question queue for this source" onClick={() => onPrepare(entry.sourceIds[0])}>Copy source’s next questions</button> : null}
          {entry.sourceIds[0] && <button className="commandButton subtle" data-track="question.open_source" onClick={() => onOpenSource(entry.sourceIds[0])}><BookOpen size={14}/>{conversationSource ? "Open conversation" : "Open source"}</button>}
        </footer>
      </article>;
    })}</div>
    {results.length > limit && <button className="commandButton subtle" onClick={() => setLimit(n => n + 30)}>Show 30 more</button>}
  </section>;
}
