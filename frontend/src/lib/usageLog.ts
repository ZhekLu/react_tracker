import { useEffect } from "react";
import type { TrackerView } from "../types/tracker";
import { debugRequest } from "./insertDebug";

const actions = ["view.open", "view.active", "control.button", "control.change", "control.expand", "control.edit", "question.search", "question.filter", "question.source", "question.preview", "question.open_answer", "question.prepare", "question.open_source", "discussion.finder", "discussion.conversations", "discussion.open", "discussion.create", "discussion.import", "discussion.qa", "discussion.copy", "discussion.delete", "task.copy", "task.import", "task.next", "task.qa", "qa.next", "qa.previous", "qa.filter", "qa.group", "qa.close", "qa.understood", "api.read", "api.write"] as const;
type Action = typeof actions[number];
type Metrics = {duration_ms?: number; result_count?: number; outcome?: "ok" | "error"};
export type UsageSettings = {recording: boolean; until: string; retention_days: number};
type UsageEvent = Metrics & {id: string; session_id: string; course_id: string; at: string; view: TrackerView; action: Action};
let context: {courseId: string; view: TrackerView} | null = null;
let settings: UsageSettings | null = null;
let session = "";
let queue: UsageEvent[] = [];
let flushing = false;
let generation = 0;
let failure = "";
export function usageFailure() { return failure; }
export function applyUsageSettings(value: UsageSettings) {
  settings = value;
  if (!value.recording) {queue = []; generation++;}
}
export function trackUsage(action: Action, metrics: Metrics = {}) {
  if (import.meta.env.MODE === "test" || !context || !settings?.recording || Date.now() >= Date.parse(settings.until)) return;
  if (!/^[0-9a-f-]{36}$/i.test(context.courseId)) return;
  session ||= crypto.randomUUID();
  queue.push({...metrics, id: crypto.randomUUID(), session_id: session, course_id: context.courseId, view: context.view, action, at: new Date().toISOString()});
  if (queue.length > 200) queue = queue.slice(-200);
}
async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, 50);
  const sentGeneration = generation;
  try {
    const state = await debugRequest<UsageSettings>("/usage/events", {method:"POST", body:JSON.stringify({events:batch}), keepalive:true});
    if (generation === sentGeneration) applyUsageSettings(state);
    failure = "";
  } catch {
    if (generation === sentGeneration && settings?.recording) queue = [...batch, ...queue].slice(-200);
    failure = "Usage logging is temporarily unavailable. Tracker actions still work.";
  } finally {flushing = false;}
}
export function useUsageLog(courseId: string, view: TrackerView) {
  useEffect(() => {
    context = {courseId, view};
    trackUsage("view.open");
  }, [courseId, view]);
  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    let disposed = false;
    async function refresh() {
      try {const state = await debugRequest<UsageSettings>("/usage/settings"); if (!disposed) {const initial = settings === null; applyUsageSettings(state); if (initial) trackUsage("view.open");}}
      catch {failure = "Usage logging is unavailable. Tracker actions still work.";}
    }
    void refresh();
    let lastInput = Date.now();
    let lastTick = Date.now();
    const touch = () => {lastInput = Date.now();};
    const click = (event: Event) => {
      touch();
      const element = event.target instanceof Element ? event.target.closest("button, a, summary, [role=button]") : null;
      if (!element) return;
      const marked = element.getAttribute("data-track");
      trackUsage(actions.includes(marked as Action) ? marked as Action : element.tagName === "SUMMARY" ? "control.expand" : "control.button");
    };
    const change = (event: Event) => {
      touch();
      const marked = event.target instanceof Element ? event.target.getAttribute("data-track") : null;
      trackUsage(actions.includes(marked as Action) ? marked as Action : "control.change");
    };
    // One edit-entry event, never keys, input values, text, URLs or clipboard content.
    const focus = (event: Event) => {if (event.target instanceof Element && event.target.matches('textarea, [contenteditable=true]')) trackUsage("control.edit");};
    const tick = window.setInterval(() => {
      const now = Date.now();
      if (!document.hidden && document.hasFocus() && now - lastInput < 30_000) trackUsage("view.active", {duration_ms: Math.max(0, Math.min(now - lastTick, 10_000))});
      lastTick = now;
      void flush();
    }, 10_000);
    const poll = window.setInterval(() => void refresh(), 60_000);
    const visibility = () => {lastTick = Date.now(); if (document.hidden) void flush();};
    const pagehide = () => {void flush();};
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("keydown", touch, true);
    document.addEventListener("pointermove", touch, {passive:true});
    document.addEventListener("scroll", touch, {passive:true, capture:true});
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    return () => {
      disposed = true; clearInterval(tick); clearInterval(poll);
      document.removeEventListener("click", click, true); document.removeEventListener("change", change, true);
      document.removeEventListener("focusin", focus, true); document.removeEventListener("keydown", touch, true);
      document.removeEventListener("pointermove", touch); document.removeEventListener("scroll", touch, true);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", pagehide);
      void flush();
    };
  }, []);
}
export async function measuredFetch(url: string, init?: RequestInit) {
  const start = performance.now();
  const action = !init?.method || init.method === "GET" ? "api.read" : "api.write";
  try {
    const response = await fetch(url, init);
    trackUsage(action, {duration_ms: Math.min(300_000, Math.round(performance.now() - start)), outcome: response.ok ? "ok" : "error"});
    return response;
  } catch (error) {
    trackUsage(action, {duration_ms: Math.min(300_000, Math.round(performance.now() - start)), outcome:"error"});
    throw error;
  }
}
