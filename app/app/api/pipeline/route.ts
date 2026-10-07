import { getStore } from "@/lib/store";
import { pipeline } from "@/lib/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Follow-ups due today (or overdue) across all searches, and how many leads you contacted this week. */
export async function GET(req: Request) {
  const today = new URL(req.url).searchParams.get("today"); // the browser's local date
  try {
    return Response.json(await pipeline(getStore(), today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : undefined));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
