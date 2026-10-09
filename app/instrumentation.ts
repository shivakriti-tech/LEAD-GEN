/** Runs once when the app starts: begins sending queued emails if a mailbox is set up. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const guards = await import("./lib/guards");
  guards.installGuards();
  guards.logMemory();
  const { startEmailWorker } = await import("./lib/mail/send");
  startEmailWorker();
  // let the server start answering first, then continue searches the last restart cut off
  setTimeout(() => void import("./lib/resume").then((m) => m.resumeInterrupted()).catch((e) => console.error("[resume]", e)), 5000).unref();
}
