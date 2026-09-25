import { fetchWithTimeout } from "../util";

/**
 * Apollo organization enrichment, only with the client's own key.
 * We never store Apollo data for reuse across clients.
 */
export interface ApolloOrg {
  employees?: number;
  linkedin?: string;
  foundedYear?: number;
  phone?: string;
}

export async function apolloEnrichDomain(apiKey: string, domain: string): Promise<ApolloOrg | null> {
  const res = await fetchWithTimeout(
    `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
    { headers: { "x-api-key": apiKey, "Cache-Control": "no-cache", accept: "application/json" } },
    12_000,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Apollo ${res.status}`);
  const json = (await res.json()) as {
    organization?: { estimated_num_employees?: number; linkedin_url?: string; founded_year?: number; phone?: string; primary_phone?: { number?: string } };
  };
  const o = json.organization;
  if (!o) return null;
  return {
    employees: o.estimated_num_employees ?? undefined,
    linkedin: o.linkedin_url ?? undefined,
    foundedYear: o.founded_year ?? undefined,
    phone: o.primary_phone?.number || o.phone || undefined,
  };
}
