import type { Lead, LogisticsService, Signal, Tier } from "../types";

/**
 * Score for a logistics client: how likely this business ships goods regularly, and which of the
 * client's services it would use. Higher = more (and more regular) freight to win.
 */

/** How a service reads in a sentence ("Likely needs sea freight and customs clearance"). */
export const SERVICE_LABEL: Record<LogisticsService, string> = {
  customs: "customs clearance",
  documentation: "export-import documentation",
  dgft: "DGFT licences and export benefits",
  icegate: "ICEGATE filing",
  sea: "sea freight",
  freight: "road transport",
  imports: "import handling",
  forwarding: "export handling",
  courier: "courier and parcels",
  warehousing: "warehousing",
};
/** Short names for the service buttons. */
export const SERVICE_CHIP: Record<LogisticsService, string> = {
  customs: "Customs clearance",
  documentation: "Documentation",
  dgft: "DGFT",
  icegate: "ICEGATE",
  sea: "Sea / ocean freight",
  freight: "By road",
  imports: "Import",
  forwarding: "Export",
  courier: "Courier & parcels",
  warehousing: "Warehousing",
};
/** Every service, in the order needs are listed (most specific first). */
export const ALL_SERVICES: LogisticsService[] = ["sea", "customs", "documentation", "icegate", "dgft", "forwarding", "imports", "freight", "courier", "warehousing"];
/** What a customs & freight agent typically offers: ticked on a new search. */
export const DEFAULT_SERVICES: LogisticsService[] = ["customs", "documentation", "dgft", "icegate", "sea", "freight", "imports", "forwarding"];
/** The service buttons, in the order a customs & freight agent lists them. */
export const SERVICE_ORDER: LogisticsService[] = [...DEFAULT_SERVICES, "courier", "warehousing"];
/** Export/import services: an exporter or importer is a strong lead when the client offers any of these. */
const EXIM: LogisticsService[] = ["customs", "documentation", "dgft", "icegate", "sea", "forwarding", "imports"];

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
  const exim = EXIM.some((x) => offers.has(x));
  if (exports) {
    add("exports", t.countries?.length ? `Exports (${t.countries.slice(0, 3).join(", ")}${t.countries.length > 3 ? "…" : ""})` : "Exports goods", exim ? 25 : 10);
    for (const x of ["sea", "customs", "documentation", "icegate", "dgft", "forwarding"] as const) need(x);
  }
  if (imports) {
    add("imports", "Imports goods", exim ? 15 : 5);
    for (const x of ["sea", "customs", "documentation", "icegate", "imports"] as const) need(x);
  }
  if (t.iec) {
    add("iec", "Has an import-export code (IEC)", offers.has("dgft") ? 10 : 5);
    need("dgft");
    need("documentation");
  }
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
  const list = ALL_SERVICES.filter((x) => needs.has(x));
  return { signals: s, score, tier, whyNow: whyNow(lead, s, list, t.countries), pitchFor: { kind: "logistics", needs: list } };
}

const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function whyNow(lead: Lead, s: Signal[], needs: LogisticsService[], countries?: string[]): string {
  const has = (k: string) => s.find((x) => x.key === k);
  if (has("competitor")) return "Looks like a transport or courier company itself: a competitor, not a customer.";
  const who = has("exports") && !has("makes_goods") ? "Exporter" : has("imports") && !has("makes_goods") && !has("moves_stock") ? "Importer" : has("makes_goods") || has("moves_stock") || has("ships_parcels") ? lead.category : "Business";
  const where = has("industrial") ? ` in ${has("industrial")!.label.replace(/^In an industrial area \((.*)\)$/, "$1")}` : lead.city ? ` in ${lead.city}` : "";
  const reach = [has("exports") && (countries?.length ? `exports to ${join(countries.slice(0, 3))}` : "exports"), has("imports") && who !== "Importer" && "imports", has("pan_india") && "supplies across India", has("sells_online") && "sells online"].filter(Boolean) as string[];
  const needText = needs.length ? ` Likely needs ${join([...needs.slice(0, 4).map((n) => SERVICE_LABEL[n]), ...(needs.length > 4 ? ["more"] : [])])}.` : "";
  return `${who}${where}${reach.length ? ` that ${join(reach)}` : ""}.${needText}`;
}
