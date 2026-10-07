import { getStore } from "@/lib/store";
import { live } from "@/lib/live";
import { enqueue, queueStore, mutate } from "@/lib/mail/queue";
import { startEmailWorker } from "@/lib/mail/send";
import type { Lang, Sender, Tone } from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

/** Add leads of one search to the email queue: { searchId, leadIds, lang, tone, sender, followUps, texts? }. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const searchId = str(b?.searchId, 60);
  const ids = Array.isArray(b?.leadIds) ? (b!.leadIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  if (!searchId || !ids.length) return Response.json({ error: "Send { searchId, leadIds }" }, { status: 400 });
  const hit = await getStore().getSearch(searchId);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  const leadsNow = live.get(searchId)?.leads ?? hit.leads;
  const want = new Set(ids);
  const s = (b?.sender ?? {}) as Record<string, unknown>;
  const sender: Sender = { name: str(s.name, 80), work: str(s.work, 80), city: str(s.city, 80), link: str(s.link, 300), company: str(s.company, 120), usp: str(s.usp, 200), priceLine: str(s.priceLine, 120), address: str(s.address, 300) };
  const texts = b?.texts && typeof b.texts === "object" ? Object.fromEntries(Object.entries(b.texts as Record<string, unknown>).filter(([k, v]) => want.has(k) && typeof v === "string").map(([k, v]) => [k, (v as string).slice(0, 5000)])) : undefined;
  const r = await mutate(queueStore(), (d) =>
    enqueue(d, {
      searchId,
      leads: leadsNow.filter((l) => want.has(l.id) && !l.pending),
      lang: b?.lang === "hi" ? "hi" : ("en" as Lang),
      tone: (["friendly", "short"].includes(b?.tone as string) ? b!.tone : "friendly") as Exclude<Tone, "follow">,
      sender,
      clientId: str(b?.clientId, 60) ?? hit.search.params.clientId,
      followUps: b?.followUps !== false,
      texts,
    }),
  );
  startEmailWorker();
  return Response.json(r);
}
