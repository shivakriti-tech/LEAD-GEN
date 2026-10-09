import { inboxStore, sendEmailReply, updateInbox } from "@/lib/agent/inbox";
import { runAgent } from "@/lib/agent/agent";
import { replyDeps } from "@/lib/mail/send";
import { checkContent } from "@/lib/mail/guard";
import { readWaLog, sendWhatsApp, updateWaLog, waConfig, withinWindow } from "@/lib/whatsapp";
import { savedLeads } from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Act on a conversation: send your (edited) reply, close it, or ask the agent for a new draft.
 * Body: { action: "send" | "close" | "redraft", text? }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string };
  const store = inboxStore();
  const conv = (await store.read()).conversations.find((c) => c.id === id);
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const text = String(body.text ?? "").trim().slice(0, 4000);

  if (body.action === "close") {
    await updateInbox(store, (d) => {
      const c = d.conversations.find((x) => x.id === id);
      if (c) Object.assign(c, { status: "closed", updatedAt: new Date().toISOString() });
    });
    return Response.json({ ok: true });
  }

  if (body.action === "redraft") {
    const deps = replyDeps();
    const lead = conv.searchId && conv.leadId ? await savedLeads.get(conv.searchId, conv.leadId) : undefined;
    const brain = await deps.brainFor(conv.clientId);
    const r = await runAgent({ lead: lead ?? { name: conv.leadName ?? conv.address, category: "", whyNow: "" }, brain, sender: conv.sender ?? {}, subject: conv.subject ?? "", thread: conv.messages });
    await updateInbox(store, (d) => {
      const c = d.conversations.find((x) => x.id === id);
      if (c) Object.assign(c, { agent: r, draft: r.reply, updatedAt: new Date().toISOString() });
    });
    return Response.json({ ok: true, agent: r });
  }

  if (body.action === "send") {
    if (conv.channel === "email") {
      const r = await sendEmailReply(replyDeps(), id, text, "you");
      return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: 400 });
    }
    const c = waConfig();
    if (!c) return Response.json({ error: "WhatsApp API isn't set up: copy the text and send it from your phone" }, { status: 400 });
    if (!text) return Response.json({ error: "Write a reply first" }, { status: 400 });
    const spam = checkContent("WhatsApp", text).block[0];
    if (spam) return Response.json({ error: `Spam check: ${spam}` }, { status: 400 });
    if (!withinWindow(await readWaLog(), conv.address)) return Response.json({ error: "More than 24 hours since their last message: WhatsApp allows only an approved template now (Outreach → WhatsApp)" }, { status: 400 });
    try {
      const { id: waId } = await sendWhatsApp(c, conv.address, { kind: "text", text });
      const at = new Date().toISOString();
      await updateWaLog((l) => void l.entries.push({ id: waId, at, dir: "out", number: conv.address, text, leadName: conv.leadName, searchId: conv.searchId, leadId: conv.leadId }));
      await updateInbox(store, (d) => {
        const x = d.conversations.find((y) => y.id === id);
        if (x) Object.assign(x, { status: "sent", draft: undefined, updatedAt: at, messages: [...x.messages, { dir: "out", text, at, id: waId, by: "you" }] });
      });
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
