import { localInboxStore } from "@/lib/agent/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The inbox: conversations waiting for you first, then the rest, newest first. */
export async function GET() {
  const d = await localInboxStore().read();
  const order = { handoff: 0, drafted: 1, sent: 2, closed: 3 } as const;
  const conversations = [...d.conversations].sort((a, b) => order[a.status] - order[b.status] || b.updatedAt.localeCompare(a.updatedAt));
  return Response.json({ conversations: conversations.slice(0, 200), waiting: conversations.filter((c) => c.status === "handoff" || c.status === "drafted").length, ai: !!process.env.GEMINI_API_KEY?.trim() && !/^(off|rules)$/i.test(process.env.AGENT_AI ?? ""), autoSend: /^safe$/i.test(process.env.AGENT_AUTO_SEND ?? "") });
}
