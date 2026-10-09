import { getStore } from "@/lib/store";
import { settle } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = getStore();
    return Response.json({ searches: await Promise.all((await store.listSearches()).map((s) => settle(s, store))) });
  } catch (e) {
    console.error("[searches] couldn't list searches", e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
