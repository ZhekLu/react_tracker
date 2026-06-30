import {
  CheckCircle2,
  Circle,
  CircleHelp,
  ClipboardCopy,
  Search,
  SkipForward,
  Target,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ProgressBar } from "../../components/ProgressBar";
import type { Course, Skill } from "../../types/tracker";

type SkillsViewProps = {
  course: Course;
  onOpenDay: (dayId: string) => void;
  onCopy: (text: string, label: string) => void;
};

type SkillTone = "covered" | "question" | "later" | "open";

function skillTone(course: Course, skill: Skill): SkillTone {
  const linkedDays = skill.dayIds
    .map((dayId) => course.days.find((day) => day.id === dayId))
    .filter((day): day is Course["days"][number] => Boolean(day));
  if (linkedDays.some((day) => day.openQuestionCount > 0)) return "question";
  if (
    linkedDays.some((day) =>
      day.sections.some((section) =>
        section.tasks.some((task) => task.status === "later"),
      ),
    )
  ) {
    return "later";
  }
  return skill.covered ? "covered" : "open";
}

function coverageReport(course: Course): string {
  const dayById = new Map(course.days.map((day) => [day.id, day]));
  const lines = [
    `# ${course.title} - Skill Coverage`,
    "",
    `Covered: ${course.skills.filter((skill) => skill.covered).length}/${course.skills.length}`,
    "",
  ];
  for (const skill of course.skills) {
    const linkedDays = skill.dayIds
      .map((dayId) => dayById.get(dayId))
      .filter((day): day is Course["days"][number] => Boolean(day));
    const tone = skillTone(course, skill);
    lines.push(
      `- ${skill.name} [${tone}]`,
      `  Days: ${linkedDays.length ? linkedDays.map((day) => `D${day.number}`).join(", ") : "none"}`,
      `  Completed: ${skill.completedDayCount}/${linkedDays.length}`,
    );
  }
  const gaps = course.skills.filter((skill) => skill.dayIds.length === 0);
  if (gaps.length) {
    lines.push("", "## Coverage gaps");
    lines.push(...gaps.map((skill) => `- ${skill.name}`));
  }
  return lines.join("\n");
}

export function SkillsView({ course, onOpenDay, onCopy }: SkillsViewProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const dayById = useMemo(
    () => new Map(course.days.map((day) => [day.id, day])),
    [course.days],
  );
  const categories = useMemo(
    () =>
      [...new Set(course.skills.map((skill) => skill.category).filter(Boolean))]
        .map(String)
        .sort(),
    [course.skills],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSkills = course.skills.filter((skill) => {
    if (category !== "all" && skill.category !== category) return false;
    return (
      !normalizedQuery ||
      `${skill.name} ${skill.category ?? ""} ${skill.description?.plainText ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  });
  const coveredCount = course.skills.filter((skill) => skill.covered).length;
  const questionCount = course.skills.filter(
    (skill) => skillTone(course, skill) === "question",
  ).length;
  const laterCount = course.skills.filter(
    (skill) => skillTone(course, skill) === "later",
  ).length;
  const gapCount = course.skills.filter((skill) => skill.dayIds.length === 0).length;

  return (
    <div className="skillsLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Objective coverage</p>
          <h2>{coveredCount}/{course.skills.length} skills covered</h2>
        </div>
        <div className="viewToolbarActions">
          <label className="searchField">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills"
              type="search"
              value={query}
            />
          </label>
          <button
            className="commandButton subtle"
            onClick={() => onCopy(coverageReport(course), "Skill coverage copied")}
            type="button"
          >
            <ClipboardCopy size={15} />
            <span>Copy report</span>
          </button>
        </div>
      </header>

      <section className="skillSummaryStrip" aria-label="Skill coverage summary">
        <div><CheckCircle2 size={17} /><strong>{coveredCount}</strong><span>covered</span></div>
        <div className={questionCount ? "attention" : ""}><CircleHelp size={17} /><strong>{questionCount}</strong><span>with questions</span></div>
        <div><SkipForward size={17} /><strong>{laterCount}</strong><span>with later work</span></div>
        <div className={gapCount ? "attention" : ""}><Target size={17} /><strong>{gapCount}</strong><span>coverage gaps</span></div>
      </section>

      {categories.length > 1 ? (
        <div className="filterBar" aria-label="Skill category filters">
          <button
            className={category === "all" ? "filterButton active" : "filterButton"}
            onClick={() => setCategory("all")}
            type="button"
          >
            All
          </button>
          {categories.map((item) => (
            <button
              className={category === item ? "filterButton active" : "filterButton"}
              key={item}
              onClick={() => setCategory(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      <section className="skillGrid">
        {visibleSkills.map((skill) => {
          const linkedDays = skill.dayIds
            .map((dayId) => dayById.get(dayId))
            .filter((day): day is Course["days"][number] => Boolean(day));
          const tone = skillTone(course, skill);
          const ratio = linkedDays.length
            ? skill.completedDayCount / linkedDays.length
            : 0;
          return (
            <article className={`skillCard tone-${tone}`} key={skill.id}>
              <header>
                <span className="skillStateIcon">
                  {tone === "covered" ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </span>
                <div>
                  <h3>{skill.name}</h3>
                  <p>{skill.category ?? "Plan objective"}</p>
                </div>
                <span className={`skillToneLabel tone-${tone}`}>{tone}</span>
              </header>
              {skill.description?.plainText ? <p>{skill.description.plainText}</p> : null}
              <ProgressBar
                accent={course.accent}
                label={`${skill.name} coverage`}
                showValue
                value={ratio}
              />
              <div className="skillDays">
                {linkedDays.map((day) => (
                  <button
                    className={
                      day.openQuestionCount
                        ? "skillDay question"
                        : day.progress.ratio >= 1
                        ? "skillDay covered"
                        : day.progress.later
                        ? "skillDay later"
                        : "skillDay"
                    }
                    key={day.id}
                    onClick={() => onOpenDay(day.id)}
                    title={`Open Day ${day.number}: ${day.topic || day.title}`}
                    type="button"
                  >
                    D{day.number}
                  </button>
                ))}
                {!linkedDays.length ? <span className="coverageGap">No linked day</span> : null}
              </div>
            </article>
          );
        })}
      </section>
      {!visibleSkills.length ? <div className="emptyInline">No skills match this view.</div> : null}
    </div>
  );
}
