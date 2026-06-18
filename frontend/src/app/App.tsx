import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ExamsView } from "../features/exams/ExamsView";
import { ResourcesView } from "../features/resources/ResourcesView";
import { RoadmapView } from "../features/roadmap/RoadmapView";
import { sampleCourses } from "../mocks/sampleData";
import type { TrackerView } from "../types/tracker";

export function App() {
  const [courseId, setCourseId] = useState(sampleCourses[0]?.id ?? "");
  const [view, setView] = useState<TrackerView>("roadmap");

  const course = useMemo(
    () => sampleCourses.find((item) => item.id === courseId) ?? sampleCourses[0],
    [courseId],
  );

  return (
    <AppShell course={course} courses={sampleCourses} view={view} onCourseChange={setCourseId} onViewChange={setView}>
      {view === "roadmap" ? <RoadmapView course={course} /> : null}
      {view === "resources" ? <ResourcesView course={course} /> : null}
      {view === "exams" ? <ExamsView course={course} /> : null}
    </AppShell>
  );
}
