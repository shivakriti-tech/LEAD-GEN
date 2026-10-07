import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import { live } from "@/lib/live";
import { savedLeads } from "@/lib/mail/send";
import { makeTasks, plan, readLinkedIn, updateLinkedIn, type TaskStatus } from "@/lib/linkedin";
import { localDate, type Sender } from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const today = (req: Request) => {
  const t = new URL(req.url).searchParams.get("today");
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : localDate();
};
const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

/** The team and the tasks (open ones, and the last 200 finished). */
export async function GET(req: Request) {
  const d = await updateLinkedIn((x) => (plan(x, today(req)), x));
  const open = d.tasks.filter((t) => t.status === "todo");
  const done = d.tasks.filter((t) => t.status !== "todo").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 200);
  return Response.json({ team: d.team, tasks: [...open.sort((a, b) => a.due.localeCompare(b.due)), ...done] });
}

/** Make tasks for leads of a search: { searchId, leadIds, sender }. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const searchId = str(b?.searchId, 60);
  const ids = new Set(Array.isArray(b?.leadIds) ? (b!.leadIds as unknown[]).filter((x): x is string => typeof x === "string") : []);
  if (!searchId || !ids.size) return Response.json({ error: "Send { searchId, leadIds }" }, { status: 400 });
  const hit = await getStore().getSearch(searchId);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  const s = (b?.sender ?? {}) as Record<string, unknown>;
  const sender: Sender = { name: str(s.name, 80), company: str(s.company, 120) };
  const leads = (live.get(searchId)?.leads ?? hit.leads).filter((l) => ids.has(l.id) && !l.pending);
  return Response.json(await updateLinkedIn((d) => makeTasks(d, { searchId, leads, sender }, today(req))));
}

/** Finish a task: { id, status: "done" | "skipped" | "replied" | "todo" }. */
export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const status = b?.status as TaskStatus;
  if (typeof b?.id !== "string" || !["done", "skipped", "replied", "todo"].includes(status)) return Response.json({ error: "Send { id, status }" }, { status: 400 });
  const t = await updateLinkedIn((d) => {
    const x = d.tasks.find((y) => y.id === b.id);
    if (x) Object.assign(x, { status, doneAt: status === "todo" ? undefined : new Date().toISOString() });
    plan(d, today(req));
    return x;
  });
  if (!t) return Response.json({ error: "Task not found" }, { status: 404 });
  if (status === "done") await savedLeads.patch(t.searchId, t.leadId, { touch: { channel: "linkedin", to: t.url } });
  if (status === "replied") await savedLeads.patch(t.searchId, t.leadId, { replied: true });
  return Response.json({ task: t });
}

/** Save the team: { team: [{ id?, name, perDay }] }. Open tasks are shared out again. */
export async function PUT(req: Request) {
  const b = (await req.json().catch(() => null)) as { team?: unknown } | null;
  if (!Array.isArray(b?.team)) return Response.json({ error: "Send { team: [...] }" }, { status: 400 });
  const team = (b!.team as Array<Record<string, unknown>>)
    .map((m) => ({ id: str(m.id, 60) ?? randomUUID(), name: str(m.name, 60) ?? "", perDay: Math.min(40, Math.max(0, Math.round(Number(m.perDay) || 15))) }))
    .filter((m) => m.name)
    .slice(0, 20);
  const d = await updateLinkedIn((x) => ((x.team = team), plan(x, today(req)), x));
  return Response.json({ team: d.team });
}
