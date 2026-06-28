import {
  BookMarked,
  CalendarDays,
  CheckCircle2,
  FileText,
  GraduationCap,
  Link2,
  MessageCircleQuestion,
  NotebookText,
  Search,
} from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { ProgressBar } from "../../components/ProgressBar";
import { ProgressRing } from "../../components/ui/ProgressRing";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import type { Course, Resource, ResourceKind } from "../../types/tracker";

type ResourcesViewProps = {
  course: Course;
  onResourceReadToggle: (resourceId: string) => void;
};

const kindIcon: Record<ResourceKind, ComponentType<{ size?: number }>> = {
  paper: GraduationCap,
  book: BookMarked,
  slides: FileText,
  exercise: NotebookText,
  guide: NotebookText,
  dataset: FileText,
  web: Link2,
  other: FileText,
};

function ResourceRow({
  accent,
  resource,
  onReadToggle,
}: {
  accent: string;
  resource: Resource;
  onReadToggle: (resourceId: string) => void;
}) {
  const reward = useCompletionReward();
  const isRead = resource.progress === 1;

  function toggleRead() {
    if (!isRead) reward.celebrate();
    onReadToggle(resource.id);
  }

  return (
    <article className={resource.hasQuestion ? "resourceRow attention" : "resourceRow"}>
      <ProgressRing accent={accent} label={resource.title} size="small" value={resource.progress} />
      <div className="resourceRowMain">
        <h3>{resource.title}</h3>
        {resource.sourcePath ? <p className="filePath" title={resource.sourcePath}>{resource.sourcePath}</p> : null}
      </div>
      <div className="resourceRowMeta">
        <span><CalendarDays size={13} /> {resource.dayIds.length}</span>
        {resource.hasQuestion ? <span className="attentionText"><MessageCircleQuestion size={13} /> Question</span> : null}
      </div>
      <div className="resourceRowProgress">
        <ProgressBar accent={accent} value={resource.progress} />
      </div>
      <button
        className={isRead ? "resourceDoneButton done" : "resourceDoneButton"}
        onClick={toggleRead}
        title={isRead ? "Mark unread" : "Mark read"}
        type="button"
      >
        <CheckCircle2 size={17} />
        <span>{isRead ? "Read" : "Mark read"}</span>
        <CompletionBurst token={reward.token} />
      </button>
    </article>
  );
}

export function ResourcesView({ course, onResourceReadToggle }: ResourcesViewProps) {
  const [query, setQuery] = useState("");
  const filteredResources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return course.resources;
    return course.resources.filter((resource) =>
      `${resource.title} ${resource.kind} ${resource.sourcePath ?? ""}`.toLowerCase().includes(normalizedQuery),
    );
  }, [course.resources, query]);
  const grouped = filteredResources.reduce((groups, resource) => {
    const resources = groups.get(resource.kind) ?? [];
    resources.push(resource);
    groups.set(resource.kind, resources);
    return groups;
  }, new Map<ResourceKind, typeof course.resources>());
  const completedCount = course.resources.filter((resource) => resource.progress === 1).length;

  return (
    <div className="resourceLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Library status</p>
          <h2>{completedCount}/{course.resources.length} resources completed</h2>
        </div>
        <label className="searchField">
          <Search size={16} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search resources"
            type="search"
            value={query}
          />
        </label>
      </header>
      {[...grouped.entries()].map(([kind, resources]) => {
        const Icon = kindIcon[kind];
        return (
          <section className="resourceGroup" key={kind}>
            <header className="sectionHeader">
              <div className="sectionTitle">
                <span className="sectionIcon"><Icon size={18} /></span>
                <div>
                  <h2>{kind}</h2>
                  <p>{resources.length} item{resources.length === 1 ? "" : "s"}</p>
                </div>
              </div>
            </header>
            <div className="resourceRows">
              {resources.map((resource) => (
                <ResourceRow
                  accent={course.accent}
                  key={resource.id}
                  onReadToggle={onResourceReadToggle}
                  resource={resource}
                />
              ))}
            </div>
          </section>
        );
      })}
      {!filteredResources.length ? <div className="emptyInline">No resources match “{query}”.</div> : null}
    </div>
  );
}
