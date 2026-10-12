import { mailboxesFromEnv, MAX_PER_DAY, istParts } from "@/lib/mail/mailboxes";
import { capToday, mutate, queueStore } from "@/lib/mail/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many emails a mailbox sends a day: { email, perDay, warmup? }. Saved with the queue, so it outlasts restarts. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { email?: unknown; perDay?: unknown; warmup?: unknown } | null;
  const m = mailboxesFromEnv().mailboxes.find((x) => x.email === String(b?.email ?? "").toLowerCase());
  if (!m) return Response.json({ error: "No such mailbox" }, { status: 404 });
  const n = Math.round(Number(b?.perDay));
  if (!Number.isFinite(n) || n < 1 || n > MAX_PER_DAY) return Response.json({ error: `Emails a day must be between 1 and ${MAX_PER_DAY}.` }, { status: 400 });
  const today = istParts(new Date()).date;
  const st = await mutate(queueStore(), (d) => {
    const s = (d.mailboxes[m.email] ??= { startedOn: m.start ?? today, sent: {} });
    s.perDay = n;
    if (typeof b?.warmup === "boolean") s.warmup = b.warmup;
    return s;
  });
  return Response.json({ ok: true, perDay: n, warmup: st.warmup !== false, capToday: capToday(m, st, today) });
}
