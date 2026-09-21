import { importPastedMarkdown } from "./discussionImport";
import { checkEditorInWorker } from "./checkEditorInWorker";

const API_BASE = import.meta.env.VITE_TRACKER_API_BASE ?? "/api";
export type DebugFixture = {title: string; kind: "paste" | "roundtrip"; input: string; expected: string};
export type InsertSummary = {id: string; created_at: string; source: string; status: "pending" | "incorrect" | "improvement"; feedback: string; checks: string[]; outcome: string};
export type InsertRecord = InsertSummary & {input: string; parsed: string; serialized: string; reopened: string; location: string; parser_version: string};
let debugFailure = "";
export function insertDebugFailure() { return debugFailure; }

// Serialization checks cannot detect a missing stylesheet. Inspect only display
// properties; this adds no document or DOM content to diagnostics.
export function mathDisplayChecks(root: ParentNode = document): string[] {
  const exposed = [...root.querySelectorAll<HTMLElement>(".katex > .katex-mathml")]
    .some((element) => getComputedStyle(element).position !== "absolute");
  return exposed ? ["formula accessibility layer is visible (math stylesheet missing)"] : [];
}

export async function debugRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/debug${path}`, {...init, headers: {"Content-Type": "application/json", ...init?.headers}});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === "string" ? error.detail : `Debug request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function recordInsert(input: string, parsed: string, source: string, outcome = "preview", courseId?: string) {
  // Explicit user insertion/save boundaries call this; pure parser calls never log.
  if (import.meta.env.MODE === "test" || !input.trim()) return;
  const params = new URLSearchParams(window.location.search);
  const context = {id: crypto.randomUUID(), source, course_id: courseId ?? params.get("course") ?? "",
    location: `${window.location.pathname}${window.location.search}`.slice(0, 500), input, parsed, outcome};
  void (async () => {
    const result = await checkEditorInWorker(parsed);
    result.checks.push(...mathDisplayChecks());
    await debugRequest("/inserts", {method: "POST", body: JSON.stringify({...context, ...result, parser_version: "tiptap-3.27.0/tracker-inline-runs-v3"})});
    debugFailure = "";
  })().catch(() => {
    debugFailure = "An insert could not be recorded. Check the local API, then try again; your note save is independent.";
    window.dispatchEvent(new Event("tracker:debug-error"));
  });
}

export function importWithDebug(value: string, options: {compact?: boolean} = {}, source = "Paste") {
  const parsed = importPastedMarkdown(value, options);
  recordInsert(value, parsed, source);
  return parsed;
}

export function recordSavedInsert(path: string, init: RequestInit | undefined, outcome: string) {
  if (typeof init?.body !== "string" || !["POST", "PATCH", "PUT"].includes(init.method ?? "")) return;
  if (!/^\/(?:notes|annotations|discussions|discussion-messages|tasks)\b/.test(path)) return;
  let body: Record<string, unknown>;
  try { body = JSON.parse(init.body); } catch { return; }
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "markdown" || key === "review_markdown") && typeof child === "string") {
        recordInsert(child, child, `Save ${path}`, outcome, typeof body.course_id === "string" ? body.course_id : undefined);
      } else if (typeof child === "object") visit(child);
    }
  }
  visit(body);
}
