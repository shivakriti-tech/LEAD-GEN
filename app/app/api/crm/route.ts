import { getClientStore, getStore } from "@/lib/store";
import { crmBoard } from "@/lib/crm";
import { handoffStore } from "@/lib/handoff";
import { accountOf, balance, billingStore, lowBalance } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The board, every handoff, and each client's credits. */
export async function GET() {
  const handoffs = await handoffStore().read();
  const billing = await billingStore().read();
  const clients = (await getClientStore().listClients().catch(() => [])).map((c) => ({ id: c.id, name: c.name, email: c.email, balance: balance(billing, c.id), low: lowBalance(billing, c.id), creditsPerLead: accountOf(billing, c.id).creditsPerLead }));
  return Response.json({ leads: await crmBoard(getStore(), handoffs), handoffs: handoffs.slice(-500).reverse(), clients });
}
