import { queueStore, mutate } from "@/lib/mail/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Put failed emails back in the queue: { ids? } (omit to retry every failed one). Bounced addresses are left alone. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(b?.ids) ? new Set((b!.ids as unknown[]).filter((x): x is string => typeof x === "string")) : null;
  const requeued = await mutate(queueStore(), (d) => {
    let n = 0;
    const now = new Date().toISOString();
    for (const i of d.items) {
      if (i.status !== "failed" || (ids && !ids.has(i.id)) || i.reason?.startsWith("Bounced")) continue;
      Object.assign(i, { status: "queued", reason: undefined, notBefore: now }), n++;
    }
    return n;
  });
  return Response.json({ requeued });
}
