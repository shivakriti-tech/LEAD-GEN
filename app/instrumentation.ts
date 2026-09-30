/** Runs once when the app starts: begins sending queued emails if a mailbox is set up. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startEmailWorker } = await import("./lib/mail/send");
  startEmailWorker();
}
