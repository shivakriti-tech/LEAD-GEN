import type { Lead, LogisticsService, Signal, Tier } from "../types";

/**
 * Score for a logistics client: how likely this business ships goods regularly, and which of the
 * client's services it would use. Higher = more (and more regular) freight to win.
 */

export const SERVICE_LABEL: Record<LogisticsService, string> = {
  customs: "customs clearance",
  freight: "truck freight",
  courier: "courier and parcels",
  forwarding: "export forwarding",
  warehousing: "warehousing",
};
export const ALL_SERVICES: LogisticsService[] = ["customs", "freight", "courier", "forwarding", "warehousing"];

const FACTORY = /manufactur|textile|garment|chemical|plastic|pharma|engineering|fabricat|food processing|agro|furniture maker|factory/i;
const TRADE = /wholesal|distributor|stockist|trader|dealer/i;
/** Transporters, couriers and forwarders: competitors of the client, not leads. */
const LOGISTICS_CO = /\b(logistic|logistics|transport|transports|transporter|courier|cargo|freight|movers|packers|shipping|roadways|roadlines|carriers?|forwarder|forwarding|clearing agent|express parcel)\b/i;
const INDUSTRIAL = /\b(GIDC|MIDC|RIICO|SIDCO|KIADB|industrial (estate|area|park|zone|hub)|\bSEZ\b|udyog nagar|phase[- ]?(I{1,3}|\d)\b|plot no)/i;

export function scoreLogistics(lead: Lead, services: LogisticsService[] = ALL_SERVICES, now = new Date()): { signals: Signal[]; score: number; tier: Tier; whyNow: string; pitchFor: NonNullable<Lead["pitchFor"]> } {
  const offers = new Set(services.length ? services : ALL_SERVICES);
  const t = lead.audit?.trade ?? {};
  const s: Signal[] = [];
  const add = (key: string, label: string, points: number) => s.push({ key, label, points });
  const needs = new Set<LogisticsService>();
  const need = (x: LogisticsService) => offers.has(x) && needs.add(x);
  const cat = lead.category;

  if (LOGISTICS_CO.test(`${lead.name} ${lead.about ?? ""}`)) add("competitor", "A logistics company itself (a competitor, not a customer)", -70);

  const factory = FACTORY.test(cat) || !!t.manufactures;
  const trader = TRADE.test(cat);
  if (factory) {
    add("makes_goods", FACTORY.test(cat) ? `${cat}: goods go out every week` : "Manufactures goods", 25);
    need("freight");
  } else if (/exporter|importer/i.test(cat)) {
    add("trades_goods", `${cat}: sends out consignments every month`, 15);
  } else if (trader) {
    add("moves_stock", `${cat}: moves stock to shops and buyers`, 25);
    need("freight");
    need("warehousing");
  }
  const exports = /exporter/i.test(cat) || !!t.exports;
  const imports = /importer/i.test(cat) || !!t.imports;
  if (exports) {
    const helps = offers.has("forwarding") || offers.has("customs");
    add("exports", t.countries?.length ? `Exports (${t.countries.slice(0, 3).join(", ")}${t.countries.length > 3 ? "…" : ""})` : "Exports goods", helps ? 25 : 10);
    need("forwarding");
    need("customs");
  }
  if (imports) {
    add("imports", "Imports goods", offers.has("customs") ? 15 : 5);
    need("customs");
  }
  if (t.iec) add("iec", "Has an import-export code (IEC)", 5);
  if ((t.countries?.length ?? 0) >= 3) add("many_countries", `Ships to ${t.countries!.length}+ countries`, 10);
  if (t.panIndia) {
    add("pan_india", "Supplies across India", offers.has("freight") || offers.has("courier") ? 15 : 5);
    need("freight");
  }
  const estate = (lead.address ?? "").split(",").map((x) => x.trim()).find((x) => INDUSTRIAL.test(x));
  if (estate) add("industrial", `In an industrial area (${estate.replace(/^(plot|shed|unit)\s*(no\.?)?\s*[\w/-]+\s*/i, "").trim() || estate})`, 15);
  const online = /online seller|ecommerce/i.test(cat);
  if (online) {
    add("ships_parcels", "Online seller: parcels go out to customers every day", offers.has("courier") ? 30 : 10);
    need("courier");
  } else if (t.sellsOnline || lead.orderLinks?.length) {
    add("sells_online", "Also sells online: daily parcels", offers.has("courier") ? 20 : 5);
    need("courier");
  }
  if (t.b2b?.length) add("b2b", `Lists on ${t.b2b.join(", ")}: an active B2B seller`, 10);
  if (t.dealers) {
    add("dealers", "Has a dealer / distributor network", 10);
    need("warehousing");
    need("freight");
  }
  const since = lead.audit?.foundedYear ?? lead.company?.foundedYear;
  if (since && now.getFullYear() - since >= 5) add("established", `Running since ${since}`, 5);
  if ((lead.reviews ?? 0) >= 20) add("busy", `${lead.reviews} Google reviews`, 5);
  if (lead.company?.employees && lead.company.employees >= 20) add("size", `About ${lead.company.employees} employees`, 10);
  if (lead.chain) add("chain", "Big brand or chain: often has a logistics contract already", -10);
  if (lead.phone || lead.phones.length || lead.audit?.whatsapp) add("has_phone", "Has a phone number", 5);
  if (lead.email || lead.emails.length || lead.audit?.emails.length) add("has_email", "Has an email", 5);
  const owner = lead.owner?.name ?? lead.audit?.ownerName;
  if (owner) add("owner_known", `Owner: ${owner}`, 5);
  if (!needs.size && !s.some((x) => x.key === "competitor")) need(offers.has("freight") ? "freight" : [...offers][0]);

  const score = Math.max(0, Math.min(100, s.reduce((a, x) => a + x.points, 0)));
  const tier: Tier = score >= 60 ? "hot" : score >= 30 ? "warm" : "cold";
  const list = [...needs];
  return { signals: s, score, tier, whyNow: whyNow(lead, s, list, t.countries), pitchFor: { kind: "logistics", needs: list } };
}

const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function whyNow(lead: Lead, s: Signal[], needs: LogisticsService[], countries?: string[]): string {
  const has = (k: string) => s.find((x) => x.key === k);
  if (has("competitor")) return "Looks like a transport or courier company itself: a competitor, not a customer.";
  const who = has("exports") && !has("makes_goods") ? "Exporter" : has("makes_goods") || has("moves_stock") || has("ships_parcels") ? lead.category : "Business";
  const where = has("industrial") ? ` in ${has("industrial")!.label.replace(/^In an industrial area \((.*)\)$/, "$1")}` : lead.city ? ` in ${lead.city}` : "";
  const reach = [has("exports") && (countries?.length ? `exports to ${join(countries.slice(0, 3))}` : "exports"), has("imports") && "imports", has("pan_india") && "supplies across India", has("sells_online") && "sells online"].filter(Boolean) as string[];
  const needText = needs.length ? ` Likely needs ${join(needs.map((n) => SERVICE_LABEL[n]))}.` : "";
  return `${who}${where}${reach.length ? ` that ${join(reach)}` : ""}.${needText}`;
}
