// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceReader } from "./reader/ResourceReader";
import { DiscussionQaReview } from "./discussions/DiscussionQaReview";
import type { Annotation, Course, Discussion, Resource } from "../types/tracker";

vi.mock("../components/content/MarkdownMath", () => ({ MarkdownMath: ({children}: {children: string}) => <div>{children}</div> }));
vi.mock("../components/editor/DiscussionMarkdownSurface", () => ({ DiscussionMarkdownSurface: ({markdown}: {markdown: string}) => <div>{markdown}</div> }));
vi.mock("../api/trackerApi", () => ({
  fetchPdfReaderMetadata: async () => ({ pageCount: 3, pages: [1,2,3].map(number => ({number, title: `Slide ${number}`})) }),
  fetchResourceContent: vi.fn(),
  pdfReaderPageUrl: (_: string, page: number) => `/page/${page}`,
  annotationImageUrl: vi.fn(),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
function progress(label: string) {
  return Number(document.querySelector(`[role="progressbar"][aria-label="${label}"]`)?.getAttribute("aria-valuenow"));
}
async function click(name: string) {
  const button = [...document.querySelectorAll("button")].find(el => el.textContent?.trim() === name || el.getAttribute("aria-label") === name)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}

it("moves a fresh lecture pass despite 100% saved progress and counts repeat visits once", async () => {
  const close = vi.fn();
  const resource = { id: "lecture", title: "Lecture", progress: 1, localFiles: [], version: { localPath: "lecture.pdf" } } as unknown as Resource;
  await act(async () => root.render(<ResourceReader accent="#7856c0" resource={resource} onClose={close}
    onCreateAnnotation={vi.fn()} onCreatePageAnnotation={vi.fn()} onOpenExternal={vi.fn()} />));
  expect(progress("Reading pass 1")).toBe(0);
  async function loaded() {
    await act(async () => host.querySelector(".pdfSlideStage img")!.dispatchEvent(new Event("load")));
    await act(async () => vi.advanceTimersByTime(710));
  }
  await loaded(); expect(progress("Reading pass 1")).toBe(33);
  await click("Next slide"); await loaded(); expect(progress("Reading pass 1")).toBe(67);
  await click("Previous slide"); await loaded(); expect(progress("Reading pass 1")).toBe(67);
  await click("New pass"); expect(progress("Reading pass 2")).toBe(0);
  await act(async () => vi.advanceTimersByTime(710));
  expect(progress("Reading pass 2")).toBe(33);
  await click("Close reader"); expect(close).toHaveBeenCalledWith(100);
});

it("separates a rereading pass from saved reviews and confirmed understanding", async () => {
  const question = {id: "q", stableLabel: "Q-001", resourceId: "r", kind: "question", status: "open", notes: [],
    origin: "manual", priority: "normal", revision: 1, postponed: false, createdAt: "2026-09-17", updatedAt: "2026-09-17"} as Annotation;
  const discussion = {id: "d", resourceId: "r", sourceResourceIds: ["r"], title: "Lecture answers", questionIds: ["q"],
    questionLabels: [{label: "Q-001", annotationIds: ["q"]}],
    qaReviews: [{annotationId: "q", messageId: "m", messageRevision: 1}],
    messages: [{id: "m", role: "assistant", sequenceNumber: 1, revision: 1, createdAt: "2026-09-17",
      annotationLinks: [{annotationId: "q", relation: "answers"}], body: {markdown: "## Q-001\n\nAn explanation.", revision: 1}}],
  } as unknown as Discussion;
  const course = {resources: [], days: [], notes: [], discussions: [discussion], annotations: [question]} as unknown as Course;
  const props: ComponentProps<typeof DiscussionQaReview> = {course, discussion, initialFilter: "open",
    onAnnotationChange: vi.fn(), onClose: vi.fn(), onDeleteAnswer: vi.fn(), onQuestionLink: vi.fn(), onQaViewed: vi.fn(),
    onMapExerciseSolution: vi.fn(), onToggleImportantAnswer: vi.fn(), onUpdateMessage: vi.fn()};
  await act(async () => root.render(<DiscussionQaReview {...props} />));
  expect(progress("Reading pass 1")).toBe(0);
  expect(progress("Understanding this pass")).toBe(0);
  await act(async () => vi.advanceTimersByTime(710));
  expect(progress("Reading pass 1")).toBe(100);
  await click("Mark understood");
  expect(props.onQuestionLink).toHaveBeenCalledWith("m", "q", "answers");
  // No success credit until the saved workspace confirms the transition.
  expect(progress("Understanding this pass")).toBe(0);
  await act(async () => root.render(<DiscussionQaReview {...props} course={{...course, annotations: [{...question, status: "answered"}]}} />));
  expect(progress("Understanding this pass")).toBe(100);
  expect(progress("Reading pass 1")).toBe(100);
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="QA review filter"]')!;
    select.value = "all"; select.dispatchEvent(new Event("change", {bubbles: true}));
  });
  await click("New pass"); expect(progress("Reading pass 2")).toBe(0);
  expect(progress("Understood overall")).toBe(100);
});
