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

const kindIcon: Partial<Record<ResourceKind, ComponentType<{ size?: number }>>> = {
  paper: GraduationCap,
  book: BookMarked,
  slides: FileText,
  exercise: NotebookText,
  guide: NotebookText,
  dataset: FileText,
  web: Link2,
  other: FileText,
};

function iconForKind(kind: ResourceKind): ComponentType<{ size?: number }> {
  return kindIcon[kind] ?? FileText;
}

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
  const isRead = resource.status === "read" || resource.status === "review";
  const sourcePath = resource.version?.localPath ?? resource.canonicalUrl ?? undefined;

  function toggleRead() {
    if (!isRead) reward.celebrate();
    onReadToggle(resource.id);
  }

  return (
    <article className={resource.openQuestionCount ? "resourceRow attention" : "resourceRow"}>
      <ProgressRing accent={accent} label={resource.title} size="small" value={resource.progress} />
      <div className="resourceRowMain">
        <h3>{resource.title}</h3>
        {sourcePath ? <p className="filePath" title={sourcePath}>{sourcePath}</p> : null}
      </div>
      <div className="resourceRowMeta">
        <span><CalendarDays size={13} /> {resource.dayIds.length}</span>
        {resource.openQuestionCount ? (
          <span className="attentionText"><MessageCircleQuestion size={13} /> {resource.openQuestionCount}</span>
        ) : null}
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
      `${resource.title} ${resource.kind} ${resource.version?.localPath ?? ""}`.toLowerCase().includes(normalizedQuery),
    );
  }, [course.resources, query]);
  const grouped = filteredResources.reduce((groups, resource) => {
    const groupKey = resource.category ?? resource.kind;
    const resources = groups.get(groupKey) ?? [];
    resources.push(resource);
    groups.set(groupKey, resources);
    return groups;
  }, new Map<string, typeof course.resources>());
  const completedCount = course.resources.filter((resource) => resource.status === "read" || resource.status === "review").length;

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
        const Icon = iconForKind(resources[0]?.kind ?? "other");
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
