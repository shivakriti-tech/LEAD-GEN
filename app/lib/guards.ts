/** One stray network error in the background (mail, a website being checked) must not kill the
 *  server: that restarts it and every running search is marked "Stopped partway". Node only. */
export function installGuards() {
  const g = globalThis as { __guards?: boolean };
  if (g.__guards) return;
  g.__guards = true;
  process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
  process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
}

/** Logs memory use every 30s so a restart with no error (the host killing the app for using too much memory) can be spotted in the logs. */
export function logMemory() {
  const g = globalThis as { __memlog?: boolean };
  if (g.__memlog) return;
  g.__memlog = true;
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(`[mem] rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB`);
  }, 30_000).unref();
}
