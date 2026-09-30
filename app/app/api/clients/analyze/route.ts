import { analyzeClientSite } from "@/lib/brainAnalyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Read a client's website and return a draft Business Brain to review. Nothing is saved. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { website?: unknown; name?: unknown } | null;
  const website = typeof b?.website === "string" ? b.website.trim() : "";
  if (!website || website.length > 300 || !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(website)) return Response.json({ error: "Enter the client's website address, like shreelogistics.in" }, { status: 400 });
  try {
    const r = await analyzeClientSite({ website, name: typeof b?.name === "string" ? b.name.slice(0, 120) : undefined });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: `Couldn't read ${website}: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
