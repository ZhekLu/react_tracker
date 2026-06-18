import { BookMarked, FileText, GraduationCap, Link2, NotebookText } from "lucide-react";
import type { ComponentType } from "react";
import { ProgressBar } from "../../components/ProgressBar";
import type { Course, ResourceKind } from "../../types/tracker";

type ResourcesViewProps = {
  course: Course;
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

export function ResourcesView({ course }: ResourcesViewProps) {
  const grouped = course.resources.reduce((groups, resource) => {
    const resources = groups.get(resource.kind) ?? [];
    resources.push(resource);
    groups.set(resource.kind, resources);
    return groups;
  }, new Map<ResourceKind, typeof course.resources>());

  return (
    <div className="resourceLayout">
      {[...grouped.entries()].map(([kind, resources]) => {
        const Icon = kindIcon[kind];
        return (
          <section className="resourceGroup" key={kind}>
            <header className="sectionHeader">
              <div>
                <p className="eyebrow">{resources.length} item{resources.length === 1 ? "" : "s"}</p>
                <h2>{kind}</h2>
              </div>
              <Icon size={22} />
            </header>
            <div className="resourceGrid">
              {resources.map((resource) => (
                <article className={resource.hasQuestion ? "resourceCard attention" : "resourceCard"} key={resource.id}>
                  <div>
                    <h3>{resource.title}</h3>
                    {resource.sourcePath ? <p className="filePath">{resource.sourcePath}</p> : null}
                  </div>
                  <ProgressBar value={resource.progress} label={`${resource.title} progress`} />
                  <div className="tagRow">
                    <span className="tag">{resource.dayIds.length} day{resource.dayIds.length === 1 ? "" : "s"}</span>
                    {resource.hasQuestion ? <span className="tag amber">questions</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
