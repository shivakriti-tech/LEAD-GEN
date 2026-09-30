import { getClientStore } from "@/lib/store";
import { parseBrain, type ClientBrain } from "@/lib/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const client = await getClientStore().getClient((await ctx.params).id);
  return client ? Response.json({ client }) : Response.json({ error: "Client not found" }, { status: 404 });
}

/** Replace a client's brain with the edited version. */
export async function PUT(req: Request, ctx: Ctx) {
  const store = getClientStore();
  const prev = await store.getClient((await ctx.params).id);
  if (!prev) return Response.json({ error: "Client not found" }, { status: 404 });
  const r = parseBrain(await req.json().catch(() => null));
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  const client: ClientBrain = { ...r.brain, id: prev.id, createdAt: prev.createdAt, updatedAt: new Date().toISOString() };
  await store.saveClient(client);
  return Response.json({ client });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const ok = await getClientStore().deleteClient((await ctx.params).id);
  return ok ? Response.json({ ok }) : Response.json({ error: "Client not found" }, { status: 404 });
}
