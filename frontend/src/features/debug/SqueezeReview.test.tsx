// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqueezeReview } from "./SqueezeReview";
import { debugRequest } from "../../lib/insertDebug";
import { createSqueezeDraft } from "../../lib/squeezeMarkdown";

vi.mock("../../lib/insertDebug", () => ({debugRequest: vi.fn()}));
vi.mock("../../components/editor/DiscussionMarkdownSurface", () => ({DiscussionMarkdownSurface: ({markdown}: {markdown: string}) => <div data-preview>{markdown}</div>}));
let server: {id: string; title: string; source: string; raw_length: number; raw: string; revision: number; state: ReturnType<typeof createSqueezeDraft>};
let failSave = false;
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key)});
  vi.useFakeTimers(); failSave = false;
  const raw = "First.\n\n$$\nx=2\n$$\n\nLast.";
  server = {id: "example", title: "Tutor", source: "Paste", raw_length: raw.length, raw, revision: 1, state: createSqueezeDraft(raw)};
  vi.mocked(debugRequest).mockImplementation(async (path, init) => {
    if (init?.method === "PUT") {
      if (failSave) throw new Error("API offline");
      const command = JSON.parse(String(init.body));
      server = {...server, revision: server.revision + 1, state: command.state};
      return {...server};
    }
    return path.includes("?") ? [server] : {...server};
  });
});
afterEach(() => {vi.useRealTimers(); vi.clearAllMocks();});

describe("squeeze keyboard review", () => {
  it("records W/S and A/D, saves decisions, undoes, and leaves typing to the text editor", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SqueezeReview courseId="course"/>));
    const panel = host.querySelector<HTMLElement>('[aria-label="Squeeze keyboard review"]')!;
    async function key(value: string, ctrlKey = false, target: HTMLElement = panel) {
      await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", {key: value, ctrlKey, bubbles: true, cancelable: true})));
    }
    async function click(text: string) {await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click());}
    await key("ArrowDown");
    expect(host.querySelector("h2")?.textContent).toContain("Fragment 2");
    await key("s");
    expect(host.querySelector("[data-preview]")?.textContent).toContain("First.\n\n$x=2$ Last.");
    await key("d");
    expect(host.querySelector("[data-preview]")?.textContent).toContain("$$\nx=2\n$$");
    await key("a"); await key("w");
    expect(host.querySelector("[data-preview]")?.textContent).toContain("First. $x=2$");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(server.state.actions.map(action => action.command)).toEqual(["separate", "block", "inline", "join"]);
    expect(host.textContent).toContain("All decisions saved");
    await key("z", true);
    await click("Edit fragment");
    const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="Edit selected fragment"]')!;
    await key("w", false, editor);
    await click("Cancel edit");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(server.state.actions.at(-1)?.command).toBe("undo");
    expect(server.state.actions).toHaveLength(5);
    await act(async () => root.unmount()); host.remove();
  });
  it("recovers pending decisions across unmount after a save fails", async () => {
    const host = document.createElement("div"); document.body.append(host);
    let root = createRoot(host);
    await act(async () => root.render(<SqueezeReview courseId="course"/>));
    const panel = host.querySelector<HTMLElement>('[aria-label="Squeeze keyboard review"]')!;
    failSave = true;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
    });
    await act(async () => panel.dispatchEvent(new KeyboardEvent("keydown", {key: "s", bubbles: true})));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("API offline");
    expect(JSON.parse(localStorage.getItem("tracker:squeeze:example")!).draft.actions[0].command).toBe("separate");
    await act(async () => root.unmount()); root = createRoot(host);
    failSave = false;
    await act(async () => root.render(<SqueezeReview courseId="course"/>));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(server.state.actions[0].command).toBe("separate");
    expect(localStorage.getItem("tracker:squeeze:example")).toBeNull();
    await act(async () => root.unmount()); host.remove();
  });
});
