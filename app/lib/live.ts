import type { Lead, ProgressEvent, SearchRecord } from "./types";
import type { Store } from "./store";

/**
 * Searches this server is working on right now, with their log and progress, so a search opened
 * from Recent searches (or after closing the tab) can show what it's doing and be stopped.
 * Kept on globalThis so it survives hot reloads while developing.
 */
export interface LiveSearch {
  ctrl: AbortController;
  logs: Array<{ level: "info" | "warn" | "error"; message: string }>;
  stage?: { stage: string; done: number; total: number };
  /** The search's own lead objects: a status set while it runs goes straight onto them, so its saves keep it. */
  leads?: Lead[];
}

const g = globalThis as unknown as { __leadLive?: Map<string, LiveSearch> };
export const live: Map<string, LiveSearch> = (g.__leadLive ??= new Map());

/** Wraps a search's event stream: records its log and progress while it runs. */
export function track(ctrl: AbortController, emit: (e: ProgressEvent) => void): ((e: ProgressEvent) => void) & { end: () => void } {
  let entry: LiveSearch | undefined;
  let id: string | undefined;
  const fn = (e: ProgressEvent) => {
    if (e.type === "start") {
      id = e.searchId;
      entry = { ctrl, logs: [] };
      live.set(id, entry);
    } else if (entry && e.type === "log") {
      entry.logs.push({ level: e.level, message: e.message });
      if (entry.logs.length > 300) entry.logs.splice(0, entry.logs.length - 300);
    } else if (entry && e.type === "leads") entry.leads = e.leads;
    else if (entry && e.type === "stage") entry.stage = { stage: e.stage, done: e.done, total: e.total };
    else if (e.type === "done" && id) live.delete(id);
    emit(e);
  };
  /** Call when the search is over, however it ended. */
  return Object.assign(fn, { end: () => void (id && live.delete(id)) });
}

/**
 * A search saved as "running" that this server isn't working on was cut off (the app was stopped
 * or restarted). Mark it stopped so it doesn't look like it's still going.
 */
export async function settle(s: SearchRecord, store: Store): Promise<SearchRecord> {
  if (s.status !== "running" || live.has(s.id)) return s;
  const fixed: SearchRecord = { ...s, status: "stopped", error: s.error ?? "Stopped partway (the app was closed or restarted during the search)" };
  await store.saveSearch(fixed).catch(() => {});
  return fixed;
}
