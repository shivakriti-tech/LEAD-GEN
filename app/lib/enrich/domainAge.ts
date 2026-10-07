import { fetchWithTimeout } from "../util";

/**
 * When a website's domain was registered, from public RDAP records (the modern WHOIS; free, no key).
 * A domain registered in the last year usually means a new business, or one that just went online.
 */

/** Second-level suffixes where the registrable name is three labels: shivsteel.co.in, not co.in. */
const TWO_PART = /\.(co|net|org|gen|firm|ind|ac|edu|res|gov|nic|mil)\.(in)$|\.(co|org|ac|gov|ltd|plc|net|me)\.(uk)$|\.(com|net|org|edu|gov)\.(au|sg|my|ae|sa|bd|np|lk|pk)$/i;

export function registrableDomain(host?: string): string | undefined {
  if (!host) return undefined;
  const h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return undefined;
  const parts = h.split(".");
  return parts.slice(TWO_PART.test(h) ? -3 : -2).join(".");
}

/** Registration date (YYYY-MM-DD), or undefined when the registry doesn't say or doesn't answer. */
export async function domainRegisteredOn(host: string, f = fetchWithTimeout): Promise<string | undefined> {
  const d = registrableDomain(host);
  if (!d) return undefined;
  try {
    const res = await f(`https://rdap.org/domain/${encodeURIComponent(d)}`, { headers: { Accept: "application/rdap+json, application/json" } }, 8_000);
    if (!res.ok) return undefined;
    const j = (await res.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }> };
    const reg = j.events?.find((e) => /^registration$/i.test(e.eventAction ?? ""))?.eventDate;
    return reg && /^\d{4}-\d{2}-\d{2}/.test(reg) ? reg.slice(0, 10) : undefined;
  } catch {
    return undefined;
  }
}
