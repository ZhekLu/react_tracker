// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseProgressExport } from "./CourseProgressExport";

const api = vi.hoisted(() => ({load: vi.fn()}));
vi.mock("../../api/trackerApi", () => ({fetchCourseProgressExport: api.load}));
const report = {filename: "COURSE-progress-20261121.md", markdown: "# Course progress\n\n1 open, 2 answered\n", exported_at: "2026-11-21T12:30:00Z"};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  vi.clearAllMocks();
  api.load.mockResolvedValue(report);
  Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText: vi.fn().mockResolvedValue(undefined)}});
  Object.defineProperty(URL, "createObjectURL", {configurable: true, value: vi.fn().mockReturnValue("blob:progress")});
  Object.defineProperty(URL, "revokeObjectURL", {configurable: true, value: vi.fn()});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.restoreAllMocks();
});
async function render(courseId = "course") { await act(async () => root.render(<CourseProgressExport courseId={courseId}/>)); }
function button(name: string) { return [...host.querySelectorAll("button")].find(el => el.textContent?.trim() === name)!; }
async function click(name: string) { await act(async () => button(name).click()); }

it("copies the displayed snapshot and refreshes it only on request", async () => {
  await render();
  expect(api.load).toHaveBeenCalledWith("course");
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  await click("Copy report");
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(report.markdown);
  expect(host.textContent).toContain("Course progress copied.");
  api.load.mockResolvedValue({...report, markdown: "# Updated progress\n"});
  await click("Refresh report");
  await click("Copy report");
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("# Updated progress\n");
  expect(api.load).toHaveBeenCalledTimes(2);
});

it("downloads the same Markdown with the server filename and releases the blob URL", async () => {
  vi.useFakeTimers();
  let downloaded = {href: "", filename: ""};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloaded = {href: this.href, filename: this.download};
  });
  await render(); await click("Download Markdown");
  expect(downloaded).toEqual({href: "blob:progress", filename: report.filename});
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
  expect(blob.type).toBe("text/markdown;charset=utf-8");
  expect(blob.size).toBe(new TextEncoder().encode(report.markdown).length);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:progress");
  expect(host.querySelector("a")).toBeNull();
});

it("selects the report for manual copying if clipboard access is denied", async () => {
  await render();
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("Denied"));
  await click("Copy report");
  const source = host.querySelector("textarea")!;
  expect(document.activeElement).toBe(source);
  expect(source.selectionStart).toBe(0);
  expect(source.selectionEnd).toBe(report.markdown.length);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("copy it manually or download");
});

it("keeps failed loading visible and allows a retry", async () => {
  api.load.mockRejectedValueOnce(new Error("Export unavailable"));
  await render();
  expect(button("Copy report").disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Export unavailable");
  await click("Refresh report");
  expect(button("Copy report").disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("discards a stale response after switching courses", async () => {
  let resolve!: (value: typeof report) => void;
  api.load.mockImplementation((id: string) => id === "first" ? new Promise(done => {resolve = done;})
    : Promise.resolve({...report, markdown: "# Second course\n"}));
  await render("first");
  expect(button("Download Markdown").disabled).toBe(true);
  await render("second");
  await act(async () => resolve(report));
  expect(host.querySelector("textarea")?.value).toBe("# Second course\n");
  await click("Copy report");
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("# Second course\n");
});
