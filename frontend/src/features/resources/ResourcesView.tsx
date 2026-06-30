import {
  BookMarked,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardCopy,
  Copy,
  FileText,
  Files,
  FileScan,
  FolderOpen,
  GraduationCap,
  Link2,
  MessageSquareText,
  MessageCircleQuestion,
  NotebookText,
  Search,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { EntityNoteEditor } from "../../components/notes/EntityNoteEditor";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import type {
  Course,
  EntityNoteSaveInput,
  Resource,
  ResourceKind,
  ResourceStatus,
} from "../../types/tracker";

type ResourcesViewProps = {
  course: Course;
  onCopyInventory: () => void;
  onCopyResourceQuestions: (resource: Resource) => void;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onCollectPdfAnnotations: (resourceId: string) => void;
  onFlagQuestion: (resourceId: string, label: string) => void;
  onOpenDiscussion: (resourceId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenResourceFile: (resourceId: string, fileIndex: number) => void;
  onResourceStatusChange: (resourceId: string, status: ResourceStatus) => void;
};

type ResourceFilter = "all" | "open" | "questions" | "read";

function iconForKind(kind: ResourceKind, size: number): ReactNode {
  if (kind === "paper") return <GraduationCap size={size} />;
  if (kind === "book") return <BookMarked size={size} />;
  if (kind === "exercise" || kind === "guide") return <NotebookText size={size} />;
  if (kind === "web") return <Link2 size={size} />;
  return <FileText size={size} />;
}

function isRead(resource: Resource): boolean {
  return resource.status === "read" || resource.status === "review";
}

function resourceProgress(resource: Resource): number {
  return isRead(resource) ? 1 : resource.progress;
}

function displayGroup(resource: Resource): string {
  if (resource.kind === "paper") return "Papers";
  if (resource.kind === "book") return "Books";
  if (resource.kind === "discussion") return "AI Discussions";
  if (resource.kind === "exam") return resource.category || "Exam Papers";
  if (resource.category?.trim()) return resource.category.replaceAll("_", " ");
  return resource.kind.replaceAll("_", " ");
}

function groupAnchor(groupName: string): string {
  return `resource-group-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const groupPriority = [
  "Papers",
  "Books",
  "Lecture Slides",
  "Exercise Sets",
  "AI Study Guides & Notes",
  "AI Discussions",
];

function ResourceRow({
  accent,
  dayNumberById,
  resource,
  onNoteSave,
  onCollectPdfAnnotations,
  onCopyResourceQuestions,
  onFlagQuestion,
  onOpenDiscussion,
  onOpenResource,
  onOpenResourceFile,
  onStatusChange,
}: {
  accent: string;
  dayNumberById: Map<string, number>;
  resource: Resource;
  onNoteSave: (input: EntityNoteSaveInput) => void;
  onCollectPdfAnnotations: (resourceId: string) => void;
  onCopyResourceQuestions: (resource: Resource) => void;
  onFlagQuestion: (resourceId: string, label: string) => void;
  onOpenDiscussion: (resourceId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenResourceFile: (resourceId: string, fileIndex: number) => void;
  onStatusChange: (resourceId: string, status: ResourceStatus) => void;
}) {
  const reward = useCompletionReward();
  const completed = isRead(resource);
  const sourcePath = resource.version?.localPath ?? resource.canonicalUrl ?? undefined;

  function toggleRead() {
    if (!completed) reward.celebrate();
    onStatusChange(resource.id, completed ? "unread" : "read");
  }

  return (
    <article
      className={`resourceRow ${resource.openQuestionCount ? "attention" : ""} ${completed ? "completed" : ""}`}
    >
      <span className="resourceKindIcon">
        {iconForKind(resource.kind, 17)}
      </span>
      <div className="resourceRowMain">
        <h3>{resource.title}</h3>
        <div className="resourceIdentity">
          <span>{resource.kind.replaceAll("_", " ")}</span>
          {resource.authors.length ? <span>{resource.authors.join(", ")}</span> : null}
          {resource.publicationYear ? <span>{resource.publicationYear}</span> : null}
          {sourcePath ? <span className="fileName" title={sourcePath}>{resource.version?.fileName ?? sourcePath}</span> : null}
        </div>
        {resource.localFiles.length > 1 ? (
          <div className="resourceFiles">
            {resource.localFiles.map((file) => (
              <button
                key={file.index}
                onClick={() => onOpenResourceFile(resource.id, file.index)}
                title={file.localPath}
                type="button"
              >
                <Files size={12} />
                {file.isPrimary ? "Main" : file.fileName}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="resourceRowMeta">
        {resource.dayIds.length ? (
          <span className="resourceDays">
            <CalendarDays size={13} />
            {resource.dayIds.slice(0, 5).map((dayId) => (
              <span className="dayToken" key={dayId}>D{dayNumberById.get(dayId) ?? "?"}</span>
            ))}
            {resource.dayIds.length > 5 ? <span>+{resource.dayIds.length - 5}</span> : null}
          </span>
        ) : <span className="mutedMeta">Registry</span>}
        {resource.openQuestionCount ? (
          <span className="attentionText"><MessageCircleQuestion size={13} /> {resource.openQuestionCount}</span>
        ) : null}
        {resource.notes.length ? <span><NotebookText size={13} /> {resource.notes.length}</span> : null}
      </div>
      <div className="resourceStatusCell">
        <StatusBadge status={resource.status} />
        <label className="workflowSelect compact">
          <span className="srOnly">Status for {resource.title}</span>
          <select
            aria-label={`Status for ${resource.title}`}
            onChange={(event) =>
              onStatusChange(resource.id, event.target.value as ResourceStatus)
            }
            value={resource.status}
          >
            <option value="unread">Unread</option>
            <option value="skimmed">Skimmed</option>
            <option value="reading">Reading</option>
            <option value="read">Read</option>
            <option value="review">Review</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <ProgressBar accent={accent} value={resourceProgress(resource)} />
      </div>
      <div className="resourceRowActions">
        {resource.canonicalUrl ? (
          <a
            className="resourceIconButton"
            href={resource.canonicalUrl}
            rel="noreferrer"
            target="_blank"
            title="Open paper information page"
          >
            <Link2 size={16} />
          </a>
        ) : null}
        <button
          className="resourceIconButton"
          disabled={!sourcePath}
          onClick={() => onOpenResource(resource.id)}
          title={sourcePath ? "Open resource" : "No source path is mapped"}
          type="button"
        >
          <FolderOpen size={16} />
        </button>
        <button
          className="resourceIconButton"
          onClick={() => onOpenDiscussion(resource.id)}
          title="Open linked discussion"
          type="button"
        >
          <MessageSquareText size={16} />
        </button>
        <button
          className="resourceIconButton"
          onClick={() => onFlagQuestion(resource.id, resource.title)}
          title="Add a question about this resource"
          type="button"
        >
          <MessageCircleQuestion size={16} />
        </button>
        {resource.openQuestionCount ? (
          <button
            className="resourceIconButton"
            onClick={() => onCopyResourceQuestions(resource)}
            title="Copy open questions for this resource"
            type="button"
          >
            <Copy size={15} />
          </button>
        ) : null}
        {resource.version?.localPath?.toLowerCase().endsWith(".pdf") ? (
          <button
            className="resourceIconButton"
            onClick={() => onCollectPdfAnnotations(resource.id)}
            title="Collect typed comments and highlights from this PDF"
            type="button"
          >
            <FileScan size={16} />
          </button>
        ) : null}
        <button
          className={completed ? "resourceDoneButton done" : "resourceDoneButton"}
          onClick={toggleRead}
          title={completed ? "Mark unread" : "Mark read"}
          type="button"
        >
          {completed ? <CheckCircle2 size={17} /> : <Circle size={17} />}
          <span>{completed ? "Read" : "Mark read"}</span>
          <CompletionBurst token={reward.token} />
        </button>
      </div>
      <div className="resourceInlineNote">
        {resource.description?.markdown ? (
          <details className="resourceDescription">
            <summary>Paper card and reading guidance</summary>
            <MarkdownMath>{resource.description.markdown}</MarkdownMath>
          </details>
        ) : null}
        <EntityNoteEditor
          key={`${resource.notes[0]?.id ?? resource.id}:${resource.notes[0]?.revision ?? 0}`}
          label="Resource notes"
          note={resource.notes[0]}
          onSave={(html) =>
            onNoteSave({
              entityId: resource.id,
              entityType: "resource",
              html,
              kind: "resource",
              note: resource.notes[0],
            })
          }
          placeholder={`Questions, highlights, or summary for ${resource.title}`}
        />
      </div>
    </article>
  );
}

export function ResourcesView({
  course,
  onCopyInventory,
  onCollectPdfAnnotations,
  onCopyResourceQuestions,
  onFlagQuestion,
  onNoteSave,
  onOpenDiscussion,
  onOpenResource,
  onOpenResourceFile,
  onResourceStatusChange,
}: ResourcesViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const libraryResources = useMemo(
    () =>
      course.resources.filter(
        (resource) => !["discussion", "exam_question"].includes(resource.kind),
      ),
    [course.resources],
  );
  const filteredResources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return libraryResources.filter((resource) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "read" && isRead(resource)) ||
        (filter === "open" && !isRead(resource)) ||
        (filter === "questions" && resource.openQuestionCount > 0);
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return `${resource.title} ${resource.kind} ${resource.category ?? ""} ${resource.authors.join(" ")} ${resource.version?.localPath ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, libraryResources, query]);
  const grouped = filteredResources.reduce((groups, resource) => {
    const groupKey = displayGroup(resource);
    const resources = groups.get(groupKey) ?? [];
    resources.push(resource);
    groups.set(groupKey, resources);
    return groups;
  }, new Map<string, Resource[]>());
  const groupedEntries = [...grouped.entries()].sort(([left], [right]) => {
    const leftIndex = groupPriority.indexOf(left);
    const rightIndex = groupPriority.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      return (leftIndex >= 0 ? leftIndex : 999) - (rightIndex >= 0 ? rightIndex : 999);
    }
    return left.localeCompare(right);
  });
  const dayNumberById = new Map(course.days.map((day) => [day.id, day.number]));
  const completedCount = libraryResources.filter(isRead).length;
  const readingCount = libraryResources.filter((resource) =>
    ["reading", "skimmed"].includes(resource.status),
  ).length;
  const openQuestionCount = libraryResources.reduce(
    (total, resource) => total + resource.openQuestionCount,
    0,
  );

  return (
    <div className="resourceLayout">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Library status</p>
          <h2>{completedCount}/{libraryResources.length} resources completed</h2>
        </div>
        <div className="viewToolbarActions">
          <label className="searchField">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search resources"
              type="search"
              value={query}
            />
          </label>
          <button className="commandButton subtle" onClick={onCopyInventory} type="button">
            <ClipboardCopy size={15} />
            <span>Copy inventory</span>
          </button>
        </div>
      </header>

      <section className="resourceSummaryStrip" aria-label="Resource summary">
        <div><strong>{libraryResources.length - completedCount}</strong><span>remaining</span></div>
        <div><strong>{readingCount}</strong><span>in progress</span></div>
        <div className={openQuestionCount ? "attention" : ""}><strong>{openQuestionCount}</strong><span>questions</span></div>
        <div><strong>{grouped.size}</strong><span>visible groups</span></div>
      </section>

      <div className="filterBar" aria-label="Resource filters">
        {(["all", "open", "questions", "read"] as const).map((item) => (
          <button
            className={filter === item ? "filterButton active" : "filterButton"}
            key={item}
            onClick={() => setFilter(item)}
            type="button"
          >
            {item === "all" ? "All" : item === "open" ? "To read" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {!query && filter === "all" ? (
        <nav className="resourceMap" aria-label="Resource groups">
          {groupedEntries.map(([groupName, resources]) => {
            const readCount = resources.filter(isRead).length;
            const ratio = resources.length ? readCount / resources.length : 0;
            return (
              <a
                href={`#${groupAnchor(groupName)}`}
                key={groupName}
                style={{ "--group-progress": `${Math.round(ratio * 100)}%` } as CSSProperties}
              >
                <span>{groupName}</span>
                <strong>{readCount}/{resources.length}</strong>
                <i><i /></i>
              </a>
            );
          })}
        </nav>
      ) : null}

      {groupedEntries.map(([kind, resources]) => {
        const groupReadCount = resources.filter(isRead).length;
        return (
          <section className="resourceGroup" id={groupAnchor(kind)} key={kind}>
            <header className="sectionHeader resourceGroupHeader">
              <div className="sectionTitle">
                <span className="sectionIcon">{iconForKind(resources[0]?.kind ?? "other", 18)}</span>
                <div>
                  <h2>{kind}</h2>
                  <p>{groupReadCount}/{resources.length} read</p>
                </div>
              </div>
              <div className="groupProgress">
                <ProgressBar
                  accent={course.accent}
                  value={resources.length ? groupReadCount / resources.length : 0}
                />
              </div>
            </header>
            <div className="resourceRows">
              {resources.map((resource) => (
                <ResourceRow
                  accent={course.accent}
                  dayNumberById={dayNumberById}
                  key={resource.id}
                  onCollectPdfAnnotations={onCollectPdfAnnotations}
                  onCopyResourceQuestions={onCopyResourceQuestions}
                  onFlagQuestion={onFlagQuestion}
                  onNoteSave={onNoteSave}
                  onOpenDiscussion={onOpenDiscussion}
                  onOpenResource={onOpenResource}
                  onOpenResourceFile={onOpenResourceFile}
                  onStatusChange={onResourceStatusChange}
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
