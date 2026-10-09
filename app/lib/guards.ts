/** One stray network error in the background (mail, a website being checked) must not kill the
 *  server: that restarts it and every running search is marked "Stopped partway". Node only. */
export function installGuards() {
  const g = globalThis as { __guards?: boolean };
  if (g.__guards) return;
  g.__guards = true;
  process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
  process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
}
