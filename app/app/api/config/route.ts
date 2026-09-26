import { getStore } from "@/lib/store";
import { crawlerContact } from "@/lib/util";
import { providersFromEnv, searchUsage } from "@/lib/enrich/searchProviders";
import { gmapsScraperUrl } from "@/lib/sources/gmapsScraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells the UI which sources are ready, without exposing any key. */
export async function GET() {
  return Response.json({
    google: !!process.env.GOOGLE_PLACES_API_KEY,
    pageSpeedKey: !!process.env.PAGESPEED_API_KEY,
    apollo: !!process.env.APOLLO_API_KEY,
    store: getStore().kind,
    contact: !!crawlerContact(),
    brave: !!process.env.BRAVE_SEARCH_API_KEY,
    searchProviders: providersFromEnv().map((p) => p.label),
    searchUsage: searchUsage(), // per provider: searches today / this month and its free limit (no keys)
    gmapsScraper: !!gmapsScraperUrl(),
    meta: !!process.env.META_ACCESS_TOKEN && !!process.env.IG_BUSINESS_ACCOUNT_ID,
    fbPageSearch: /^(on|true|1|yes)$/i.test(process.env.FB_PAGE_SEARCH || "") && !!process.env.META_ACCESS_TOKEN,
  });
}
