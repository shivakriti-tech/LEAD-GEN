import { savedLeads } from "@/lib/mail/send";
import { listTemplates, readWaLog, sendWhatsApp, updateWaLog, waConfig, waNumber, waPlan, type WaSend } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is the WhatsApp API set up, its approved templates, and recent messages. No keys are returned. */
export async function GET() {
  const c = waConfig();
  if (!c) return Response.json({ configured: false });
  const log = await readWaLog();
  let templates: Awaited<ReturnType<typeof listTemplates>> = [], templateError: string | undefined;
  try {
    templates = (await listTemplates(c)).filter((t) => t.status === "APPROVED");
  } catch (e) {
    templateError = e instanceof Error ? e.message : String(e);
  }
  return Response.json({ configured: true, webhook: { verifyToken: !!c.verifyToken, appSecret: !!c.appSecret }, templates, templateError, entries: log.entries.slice(-200).reverse() });
}

/** Send to one lead that opted in or replied: { searchId, leadId, template: {name, language, params} } or { ..., text }. */
export async function POST(req: Request) {
  const c = waConfig();
  if (!c) return Response.json({ error: "WhatsApp API isn't set up (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { searchId?: string; leadId?: string; text?: unknown; template?: { name?: unknown; language?: unknown; params?: unknown } } | null;
  if (!b?.searchId || !b.leadId) return Response.json({ error: "Send { searchId, leadId, template | text }" }, { status: 400 });
  const lead = await savedLeads.get(b.searchId, b.leadId);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  const log = await readWaLog();
  const plan = waPlan(lead, log);
  if (!plan.ok) return Response.json({ error: plan.why }, { status: 409 });
  let msg: WaSend;
  if (typeof b.text === "string" && b.text.trim()) {
    if (!plan.freeText) return Response.json({ error: "More than 24 hours since their last message: pick an approved template" }, { status: 409 });
    msg = { kind: "text", text: b.text.trim().slice(0, 4000) };
  } else if (b.template && typeof b.template.name === "string") {
    msg = { kind: "template", name: b.template.name, language: typeof b.template.language === "string" ? b.template.language : "en", params: Array.isArray(b.template.params) ? b.template.params.map((p) => String(p).slice(0, 500)) : [] };
  } else return Response.json({ error: "Send a template or a text" }, { status: 400 });
  try {
    const { id } = await sendWhatsApp(c, plan.number!, msg);
    await updateWaLog((l) => void l.entries.push({ id, at: new Date().toISOString(), dir: "out", number: waNumber(plan.number!), leadName: lead.name, searchId: b.searchId, leadId: lead.id, text: msg.kind === "text" ? msg.text : undefined, template: msg.kind === "template" ? msg.name : undefined, status: "sent" }));
    await savedLeads.patch(b.searchId, lead.id, { touch: { channel: "whatsapp", messageId: id, to: plan.number } });
    return Response.json({ ok: true, id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
