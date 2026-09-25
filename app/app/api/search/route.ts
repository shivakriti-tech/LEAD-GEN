import { defaultDeps, runSearch } from "@/lib/pipeline";
import { getStore } from "@/lib/store";
import type { ProgressEvent, SearchParams } from "@/lib/types";
import { CATEGORIES } from "@/lib/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST a search; the response streams progress as newline-delimited JSON. */
export async function POST(req: Request) {
  let body: Partial<SearchParams> & { apolloKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send the search as JSON." }, { status: 400 });
  }
  const valid = new Set(CATEGORIES.map((c) => c.key));
  const params: SearchParams = {
    sells: "website_development",
    categories: (body.categories ?? []).filter((c) => valid.has(c)).slice(0, 8),
    city: String(body.city ?? "").trim().slice(0, 80),
    area: body.area ? String(body.area).trim().slice(0, 80) : undefined,
    perCategory: Math.min(60, Math.max(5, Number(body.perCategory) || 20)),
    sources: {
      google: !!body.sources?.google,
      osm: body.sources?.osm !== false,
      apollo: !!body.sources?.apollo,
      instagram: !!body.sources?.instagram,
      facebook: !!body.sources?.facebook,
      web: !!body.sources?.web,
      gmaps: !!body.sources?.gmaps,
    },
    pageSpeed: !!body.pageSpeed,
    verifyWebsites: body.verifyWebsites !== false,
    webSearch: body.webSearch !== false,
  };
  if (!params.city) return Response.json({ error: "Enter a city." }, { status: 400 });
  if (!params.categories.length) return Response.json({ error: "Pick at least one business type." }, { status: 400 });

  const deps = defaultDeps(getStore());
  // The client's own Apollo key, used for this search only and never saved.
  if (body.apolloKey) deps.keys.apollo = String(body.apolloKey).trim();

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ProgressEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const result = await runSearch(params, deps, emit);
      emit({ type: "done", search: result.search, leads: result.leads });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
