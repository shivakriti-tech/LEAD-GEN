import { defaultDeps, resumeCount, runSearch } from "./pipeline";
import { getStore } from "./store";
import { live, resuming, track } from "./live";

/** Searches cut off by a restart are continued if they started within this long ago. */
const MAX_AGE_MS = 12 * 3600_000;
/** After this many restarts in a row a search is left stopped: it is probably what is crashing the server. */
const MAX_RESUMES = 2;

/**
 * Called when the server starts. Finds searches that were running when the server was stopped or
 * restarted (a deploy, an out-of-memory kill) and continues them, one at a time: the businesses
 * already checked are kept, and only the rest are checked.
 */
export async function resumeInterrupted(): Promise<number> {
  if (/^(off|0|false|no)$/i.test(process.env.RESUME_SEARCHES || "")) return 0;
  const store = getStore();
  let todo;
  try {
    todo = (await store.listSearches()).filter((s) => {
      const cut = s.status === "running" || (s.status === "stopped" && /^(Stopped partway|Resumed after a restart)/.test(s.error ?? ""));
      return cut && !live.has(s.id) && Date.now() - Date.parse(s.createdAt) < MAX_AGE_MS && (resumeCount(s.error) ?? 0) < MAX_RESUMES;
    });
  } catch (e) {
    console.error("[resume] couldn't list searches", e);
    return 0;
  }
  for (const s of todo) resuming.add(s.id);
  if (todo.length) console.log(`[resume] continuing ${todo.length} search${todo.length > 1 ? "es" : ""} cut off by the restart`);
  void (async () => {
    for (const s of todo) {
      try {
        const hit = await store.getSearch(s.id);
        if (!hit) continue;
        const deps = defaultDeps(store);
        const ctrl = new AbortController();
        const emit = track(ctrl, () => {});
        resuming.delete(s.id); // from here the live map says it's running (set by the "start" event)
        try {
          const r = await runSearch(hit.search.params, deps, emit, ctrl.signal, { search: hit.search, leads: hit.leads });
          console.log(`[resume] ${s.id} finished: ${r.search.status}, ${r.leads.length} leads`);
        } finally {
          emit.end();
        }
      } catch (e) {
        console.error(`[resume] ${s.id} failed`, e);
      } finally {
        resuming.delete(s.id);
      }
    }
  })();
  return todo.length;
}
