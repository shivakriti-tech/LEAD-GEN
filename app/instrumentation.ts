/** Runs once when the app starts: begins sending queued emails if a mailbox is set up. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // One stray network error in the background (mail, a website being checked) must not kill the
  // server: that restarts it and every running search is marked "Stopped partway".
  const g = globalThis as { __guards?: boolean };
  if (!g.__guards) {
    g.__guards = true;
    process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
    process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
  }
  const { startEmailWorker } = await import("./lib/mail/send");
  startEmailWorker();
}
