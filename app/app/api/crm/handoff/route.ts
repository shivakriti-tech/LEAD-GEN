import { getClientStore } from "@/lib/store";
import { createHandoff, handoffMessage, handoffStore } from "@/lib/handoff";
import { billingStore } from "@/lib/billing";
import { savedLeads, smtpSend } from "@/lib/mail/send";
import { mailboxesFromEnv } from "@/lib/mail/mailboxes";
import { emailHtml } from "@/lib/mail/html";
import { localInboxStore } from "@/lib/agent/inbox";
import { handoffLink } from "@/lib/handoffLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hand a lead to a client. Body: { searchId, leadId, clientId, note?, email?: boolean }.
 * With email: true (and a mailbox and the client's email set), the lead goes to them by email now;
 * otherwise copy the text and send it on WhatsApp.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { searchId?: string; leadId?: string; clientId?: string; note?: string; email?: boolean };
  if (!b.searchId || !b.leadId || !b.clientId) return Response.json({ error: "Pick a lead and a client" }, { status: 400 });
  const lead = await savedLeads.get(b.searchId, b.leadId);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  const client = await getClientStore().getClient(b.clientId);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });
  // what they said, from the inbox, so the client sees the conversation
  const conv = (await localInboxStore().read()).conversations.find((c) => c.searchId === b.searchId && c.leadId === b.leadId);
  const summary = [lead.whyNow, conv?.agent?.summary && `They said: ${conv.agent.summary}`].filter(Boolean).join(" ");
  const r = await createHandoff({ handoffs: handoffStore(), billing: billingStore(), patchLead: savedLeads.patch }, { searchId: b.searchId, lead, client, note: b.note, summary, conversation: conv?.messages.map(({ dir, text, at }) => ({ dir, text, at })) });
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  const link = await handoffLink(r.handoff.id);
  const msg = handoffMessage(r.handoff, link);
  let emailed: string | undefined;
  let emailError: string | undefined;
  if (b.email) {
    const mbox = mailboxesFromEnv().mailboxes[0];
    if (!mbox) emailError = "No mailbox set up: copy the text instead";
    else if (!client.email) emailError = "The client has no email in their profile: copy the text instead";
    else
      try {
        await smtpSend(mbox, { from: mbox.name ? `"${mbox.name.replace(/"/g, "")}" <${mbox.email}>` : mbox.email, to: client.email, subject: msg.subject, text: msg.text, html: emailHtml(msg.text) });
        emailed = client.email;
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
  }
  return Response.json({ ok: true, handoff: r.handoff, link, message: msg, emailed, emailError });
}
