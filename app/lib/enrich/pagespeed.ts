import { fetchWithTimeout } from "../util";

/**
 * Google PageSpeed Insights, mobile. Free; a key raises the rate limit.
 * Throws with Google's own error message so the app can show why it failed
 * (bad key, key restricted to another API, quota, site unreachable…).
 */
export async function pageSpeedMobile(url: string, apiKey?: string): Promise<{ score: number; lcp?: string }> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (apiKey) q.set("key", apiKey);
  const res = await fetchWithTimeout(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {}, 90_000);
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const m: string = json?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`PageSpeed ${res.status}: ${explainPageSpeedError(res.status, m)}`);
  }
  const s = json?.lighthouseResult?.categories?.performance?.score;
  if (typeof s !== "number") throw new Error("PageSpeed returned no score for this site");
  return { score: Math.round(s * 100), lcp: json.lighthouseResult?.audits?.["largest-contentful-paint"]?.displayValue };
}

export function explainPageSpeedError(status: number, m: string): string {
  if (/API_KEY_SERVICE_BLOCKED|are blocked|not been used|disabled/i.test(m))
    return "your key isn't allowed to use the PageSpeed Insights API. In Google Cloud, enable \"PageSpeed Insights API\" and, if the key is restricted, add that API to its allowed list.";
  if (/API key not valid|API_KEY_INVALID/i.test(m)) return "the PAGESPEED_API_KEY in .env.local isn't valid.";
  if (status === 429 || /quota/i.test(m)) return "daily quota used up. Try again tomorrow or add a key.";
  return m;
}
