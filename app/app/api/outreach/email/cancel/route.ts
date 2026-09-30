import { localQueueStore, mutate } from "@/lib/mail/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Take emails out of the queue: { ids } (queued ones only; sent ones can't be unsent). */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = new Set(Array.isArray(b?.ids) ? (b!.ids as unknown[]).filter((x): x is string => typeof x === "string") : []);
  if (!ids.size) return Response.json({ error: "Send { ids }" }, { status: 400 });
  const cancelled = await mutate(localQueueStore(), (d) => {
    let n = 0;
    for (const i of d.items) if (ids.has(i.id) && i.status === "queued") Object.assign(i, { status: "cancelled", reason: "Cancelled by you" }), n++;
    return n;
  });
  return Response.json({ cancelled });
}
