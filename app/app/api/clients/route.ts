import { randomUUID } from "node:crypto";
import { getClientStore } from "@/lib/store";
import { parseBrain, type ClientBrain } from "@/lib/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every client's Business Brain. */
export async function GET() {
  try {
    return Response.json({ clients: await getClientStore().listClients() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

/** Save a new client (usually a reviewed draft from /api/clients/analyze). */
export async function POST(req: Request) {
  const r = parseBrain(await req.json().catch(() => null));
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  const now = new Date().toISOString();
  const client: ClientBrain = { ...r.brain, id: randomUUID(), createdAt: now, updatedAt: now };
  await getClientStore().saveClient(client);
  return Response.json({ client });
}
