import { getStore } from "@/lib/store";
import { homeData } from "@/lib/home";
import { localDate } from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Numbers for the Home screen. ?today=YYYY-MM-DD&tz=<getTimezoneOffset()> so days are your days. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const today = q.get("today");
  const tz = Number(q.get("tz"));
  try {
    return Response.json(
      await homeData(getStore(), {
        today: today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : localDate(),
        tz: Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : new Date().getTimezoneOffset(),
      }),
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
