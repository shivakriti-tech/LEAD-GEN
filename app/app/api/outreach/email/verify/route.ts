import { mailboxesFromEnv } from "@/lib/mail/mailboxes";
import { queueStore, mutate } from "@/lib/mail/queue";
import { verifyMailbox } from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign in to a mailbox's server without sending anything: { email }. A good sign-in un-pauses it. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const m = mailboxesFromEnv().mailboxes.find((x) => x.email === String(b?.email ?? "").toLowerCase());
  if (!m) return Response.json({ error: "No such mailbox in .env.local" }, { status: 404 });
  const r = await verifyMailbox(m);
  if (r.ok) await mutate(queueStore(), (d) => void (d.mailboxes[m.email] && delete d.mailboxes[m.email].error));
  return Response.json(r);
}
