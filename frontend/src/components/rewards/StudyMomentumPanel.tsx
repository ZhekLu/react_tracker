import { Check, Map, Sparkles } from "lucide-react";
import type { Course } from "../../types/tracker";
import { dayDisplayTopic, formatTrackedTime } from "../../features/roadmap/dayPresentation";
import { dayAchievements } from "../../lib/studyActivity";

type StudyMomentumPanelProps = {
  course: Course;
  trackedSecondsByDay: Record<string, number>;
  activeDayId: string;
  onOpenDay: (id: string) => void;
};

export function StudyMomentumPanel({course, trackedSecondsByDay, activeDayId, onOpenDay}: StudyMomentumPanelProps) {
  const activity = course.days.map(day => dayAchievements(day, trackedSecondsByDay[day.id]));
  const explored = activity.filter(item => item.started).length;
  const seconds = activity.reduce((sum, item) => sum + item.trackedSeconds, 0);
  const selected = activity.find(item => item.day.id === activeDayId);
  return <section className="studyMomentumPanel" aria-label="Course journey">
    <header><span><Map size={14}/> Course journey</span><small>{explored}/{activity.length} explored</small></header>
    <div className="journeyInvestment"><strong>{formatTrackedTime(seconds) || "Your first step"}</strong><span>{seconds ? "invested in learning" : "Every step counts"}</span></div>
    <div className="studyActivityGrid" aria-label="Progress by course day">
      {activity.map(({day, level, done, coreDone, coreTotal, todoDone, trackedSeconds, complete}) => {
        const detail = `Day ${day.number}: ${dayDisplayTopic(day)}. ${done} tasks completed; ${coreDone} of ${coreTotal} core; ${todoDone} to-dos completed; ${formatTrackedTime(trackedSeconds) || "no tracked time"}.`;
        return <button type="button" key={day.id} className={`activityLevel-${level}${complete ? " coreComplete" : ""}`}
          aria-label={detail} aria-current={day.id === activeDayId ? "step" : undefined}
          title={detail} onClick={() => onOpenDay(day.id)}><span>{day.number}</span>{complete && <Check size={8}/>}</button>;
      })}
    </div>
    <div className="journeyLegend"><span><i/> Not started</span><span><i/> Started</span><span><Check size={11}/> Core done</span></div>
    {selected && <button className="journeySelected" type="button" onClick={() => onOpenDay(selected.day.id)}>
      <Sparkles size={14}/><span><strong>Day {selected.day.number} · {selected.done} tasks done</strong>
      <small>{selected.complete ? "Core work complete" : selected.coreTotal ? `${selected.coreDone}/${selected.coreTotal} core tasks` : "An open space in your plan"}
        {selected.todoDone > 0 ? ` · ${selected.todoDone} to-dos done` : ""}</small></span>
    </button>}
    <p className="journeyCaption">Course days · click a tile to jump in</p>
  </section>;
}
