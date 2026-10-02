import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import type { ComponentProps } from "react";
import type { Discussion } from "../../types/tracker";
import { DiscussionAnswerCard } from "./DiscussionAnswerCard";
import { buildDiscussionHistory } from "./discussionHistoryModel";
import { studyResourceGroups } from "./discussionStudyModel";
import { answerPreviewParts } from "./answerPreviewModel";

type Props = Omit<ComponentProps<typeof DiscussionAnswerCard>, "answer" | "history"> & {discussion: Discussion; highlightsOnly: boolean};
export function DiscussionResponseHistory({course, discussion, highlightsOnly, ...actions}: Props) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(40);
  const answers = useMemo(() => buildDiscussionHistory(course, discussion), [course, discussion]);
  const matches = answers.filter(a => [a.title, a.groupTitle, a.item.section?.bodyMarkdown].join(" ").toLowerCase().includes(query.toLowerCase()) &&
    (!highlightsOnly || answerPreviewParts(a.item.section!, course.annotations).some(part => part.color)));
  const groups = studyResourceGroups(matches.slice(0, limit));
  return <section className="discussionHistoryIndex studyCompact" aria-label="Response history by resource">
    <label className="studySearch"><Search size={14}/><input type="search" aria-label="Search response history" placeholder="Find an answer…" value={query} onChange={e => {setQuery(e.target.value); setLimit(40);}}/></label>
    {groups.map(group => <section className="studyAnswerGroup" key={group.id}>
      <header><BookOpen size={13}/><h3>{group.title}</h3><span>{group.answers.length}</span></header>
      <div className="studyAnswerList">{group.answers.map(answer => <DiscussionAnswerCard key={answer.id} answer={answer} course={course} history {...actions}/>)}</div>
    </section>)}
    {!matches.length && <p className="emptyInline">{query ? "No answers match this search." : highlightsOnly ? "No highlighted answers yet." : "Tutor responses will appear here."}</p>}
    {matches.length > limit && <button className="commandButton subtle" type="button" onClick={() => setLimit(limit + 40)}>Show more answers</button>}
  </section>;
}
