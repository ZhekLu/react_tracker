// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskAdministration } from "./TaskAdministration";
import { adminDayContext, type AdminCommand, type AdminOverview } from "../../lib/taskAdmin";
import type { Course } from "../../types/tracker";

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), guide: vi.fn() }));
vi.mock("../../api/trackerApi", () => ({fetchTaskAdministration: api.load, changeAdminTask: api.save, fetchPatchingGuide: api.guide}));
vi.mock("../../components/content/MarkdownMath", () => ({MarkdownMath: ({children}: {children: string}) => <article>{children}</article>}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let overview: AdminOverview;
let close: ReturnType<typeof vi.fn>;
let changed: ReturnType<typeof vi.fn>;
const course = {id: "c", days: [{id: "d", number: 11, title: "Policy gradients"}],
  resources: [{id: "book", title: "The book", kind: "book"}, {id: "lecture", title: "The lecture", kind: "slides"}]} as unknown as Course;

beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  vi.clearAllMocks();
  overview = {plan_id: "plan", history: [], tasks: [{ id: "t", title: "Duplicate reading", revision: 1,
    status: "skipped", day_id: "d", day_number: 11, day_title: "Policy gradients", section_id: "s", section_title: "Cancelled",
    resource_ids: ["book"], estimated_minutes: 20, is_optional: false, deleted_at: null, removed_at: null,
    protected_fields: [], note_count: 1, running_timer: false }]};
  api.load.mockImplementation(async () => structuredClone(overview));
  api.guide.mockResolvedValue({markdown: "# Complete guide\nUse delete=true."});
  api.save.mockImplementation(async (_id: string, command: AdminCommand) => {
    const task = overview.tasks[0];
    const {action, ...fields} = command;
    if (action === "edit") Object.assign(task, fields);
    if (action === "delete") {task.deleted_at = "now"; task.removed_at = "now";}
    if (action === "restore") {task.deleted_at = null; task.removed_at = null;}
    task.revision++;
    return {task, backup_path: "/backup.db", event_id: command.request_id};
  });
  close = vi.fn(); changed = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText: vi.fn().mockResolvedValue(undefined)}});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
async function render() { await act(async () => root.render(<TaskAdministration course={course} initialDayId="d" onClose={close} onChanged={changed}/>)); }
function button(name: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === name || el.getAttribute("aria-label") === name)!; }
async function click(name: string) {expect(button(name)).toBeTruthy(); await act(async () => button(name).click());}
async function input(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  const prototype = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", {bubbles: true})); });
}

it("previews a rename and submits only changed fields with the current revision", async () => {
  await render(); await input("Task title", "Clear title");
  expect(api.save).not.toHaveBeenCalled();
  await click("Review changes");
  expect(document.querySelector('[aria-label="Review task change"]')?.textContent).toContain("Duplicate reading");
  await click("Save changes");
  expect(api.save).toHaveBeenCalledWith("t", {action: "edit", request_id: expect.any(String), revision: 1, title: "Clear title"});
  expect(changed).toHaveBeenCalledOnce();
});

it("requires a deletion preview, retains failures, and retries the same request ID", async () => {
  api.save.mockRejectedValueOnce(new Error("Network interrupted"));
  await render(); await click("Delete task…");
  expect(api.save).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Notes, tutor reviews, shared resources and time records are kept");
  await click("Delete task");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Network interrupted");
  const first = api.save.mock.calls[0][1];
  await click("Delete task");
  expect(api.save.mock.calls[1][1]).toEqual(first);
  expect(document.body.textContent).toContain("No matching tasks");
  await input("Task visibility", "deleted");
  await click("Restore task…"); await click("Restore task");
  expect(overview.tasks[0].deleted_at).toBeNull();
});

it("guards unsaved drafts on exit and retains them when the user keeps editing", async () => {
  await render(); await input("Task title", "Still drafting"); await click("Exit task administration");
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
  await click("Keep editing");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Task title"]')?.value).toBe("Still drafting");
  await click("Exit task administration"); await click("Discard changes");
  expect(close).toHaveBeenCalledOnce(); expect(api.save).not.toHaveBeenCalled();
});

it("discards a draft even when navigation selects the same task again", async () => {
  await render(); await input("Task title", "Discard this"); await input("Find tasks", "Duplicate");
  await click("Discard changes");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Find tasks"]')?.value).toBe("Duplicate");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Task title"]')?.value).toBe("Duplicate reading");
});

it("attaches resources, clears minutes, and previews cancellation", async () => {
  overview.tasks[0].status = "todo";
  await render();
  const resource = [...document.querySelectorAll("label")].find(el => el.textContent?.includes("The lecture"))!.querySelector<HTMLInputElement>("input")!;
  await act(async () => resource.click());
  await input("Estimated minutes", ""); await click("Cancel task");
  await click("Review changes"); await click("Save changes");
  expect(api.save.mock.calls[0][1]).toMatchObject({status: "skipped", resource_ids: ["book", "lecture"], estimated_minutes: null});
});

it("blocks deletion/cancellation while a timer is running", async () => {
  overview.tasks[0].running_timer = true; overview.tasks[0].status = "in_progress";
  await render(); expect(button("Delete task…").disabled).toBe(true); expect(button("Cancel task").disabled).toBe(true);
});

it("keeps failed saves visible and disables exit while saving", async () => {
  let resolve!: (value: unknown) => void;
  api.save.mockImplementation(() => new Promise(done => {resolve = done;}));
  await render(); await click("Delete task…");
  await act(async () => {button("Delete task").click();});
  expect(button("Exit task administration").disabled).toBe(true);
  expect(button("Saving…").disabled).toBe(true);
  await act(async () => resolve({}));
  expect(button("Exit task administration").disabled).toBe(false);
});

it("does not resubmit a saved mutation when refreshing fails", async () => {
  changed.mockRejectedValueOnce(new Error("Refresh unavailable"));
  await render(); await input("Task title", "Saved title"); await click("Review changes"); await click("Save changes");
  expect(document.body.textContent).toContain("Saved successfully, but refreshing failed");
  await click("Refresh saved change"); expect(api.save).toHaveBeenCalledOnce();
});

it("copies the single guide and current metadata without study content", async () => {
  await render(); await click("Copy day context");
  const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
  expect(copied).toContain('"plan_id": "plan"'); expect(copied).toContain('"id": "t"');
  expect(copied).not.toContain("note_count");
  await click("Patch guide"); await click("Copy guide");
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("# Complete guide\nUse delete=true.");
});

it("never includes removed tasks in tutor context", () => {
  overview.tasks[0].deleted_at = "now";
  expect(JSON.parse(adminDayContext(overview, "d", course.resources)).tasks).toEqual([]);
});

it("copies the selected day identity even when it has no remaining tasks", async () => {
  overview.tasks[0].deleted_at = "now";
  await render(); await click("Copy day context");
  const context = JSON.parse(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]);
  expect(context.day).toEqual({id: "d", number: 11, title: "Policy gradients"});
  expect(context.tasks).toEqual([]);
});
