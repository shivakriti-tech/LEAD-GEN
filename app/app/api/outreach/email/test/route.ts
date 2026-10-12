import { mailboxesFromEnv } from "@/lib/mail/mailboxes";
import { queueStore, renderEmail } from "@/lib/mail/queue";
import { savedLeads, smtpSend } from "@/lib/mail/send";
import { unsubscribeHeaders } from "@/lib/mail/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send yourself a copy of a real email from the queue (the newest one), through a mailbox: { email, to }.
 * It goes out exactly as a lead gets it, so you see how it looks and whether it lands in Inbox,
 * Promotions or Spam. It isn't counted against the mailbox's daily limit.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { email?: unknown; to?: unknown } | null;
  const m = mailboxesFromEnv().mailboxes.find((x) => x.email === String(b?.email ?? "").toLowerCase());
  if (!m) return Response.json({ error: "No such mailbox" }, { status: 404 });
  const to = String(b?.to ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return Response.json({ error: "Enter the address to send the test to." }, { status: 400 });
  const items = [...(await queueStore().read()).items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const item of items) {
    const lead = await savedLeads.get(item.searchId, item.leadId).catch(() => undefined);
    if (!lead) continue;
    const e = renderEmail(item, lead, m);
    try {
      await smtpSend(m, { from: e.from, to, subject: e.subject, text: e.text, html: e.html, headers: await unsubscribeHeaders(to, m.replyTo ?? m.email) });
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    console.log(`[email] test sent to ${to} from ${m.email} (the email for ${item.leadName})`);
    return Response.json({ ok: true, subject: e.subject, leadName: item.leadName });
  }
  return Response.json({ error: "Queue an email to a lead first: the test sends you that email." }, { status: 400 });
}
