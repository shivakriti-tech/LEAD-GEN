import { categoryByKey } from "./categories";
import { mergePlaces } from "./dedupe";
import { auditWebsite } from "./enrich/crawl";
import { discoverWebsite, verifyCandidate, type SearchHit } from "./enrich/discover";
import { providersFromEnv, searchChain } from "./enrich/searchProviders";
import { pageSpeedMobile } from "./enrich/pagespeed";
import { scoreWebsiteDev } from "./score/websiteDev";
import { apolloEnrichDomain } from "./sources/apollo";
import { googleTextSearch } from "./sources/googlePlaces";
import { geocodeBBox, osmSearch, type BBox } from "./sources/osm";
import { facebookPageSearch, firstRealLink, instagramBusinessDiscovery, MetaError } from "./sources/meta";
import { socialSearch } from "./sources/social";
import { webLeadSearch } from "./sources/webSearch";
import { gmapsScrapeBatch, gmapsScraperUrl } from "./sources/gmapsScraper";
import { mergeBySocial, rememberSocial } from "./dedupe";
import { cached, cacheMode, DAY, type CacheStats } from "./cache";
import { classifyEmail, rankEmails } from "./enrich/email";
import { domainAcceptsMail } from "./enrich/mx";
import type { WebsiteAudit } from "./types";
import type { Store } from "./store";
import type { Lead, ProgressEvent, RawPlace, SearchParams, SearchRecord } from "./types";
import { domainOf, isSocialHost, mapLimit, normalizePhone, simplifyName, uid } from "./util";

export interface Deps {
  google: typeof googleTextSearch;
  osm: typeof osmSearch;
  geocode: typeof geocodeBBox;
  audit: typeof auditWebsite;
  discover: typeof discoverWebsite;
  social: typeof socialSearch;
  web: typeof webLeadSearch;
  gmaps: typeof gmapsScrapeBatch;
  igLookup: typeof instagramBusinessDiscovery;
  fbSearch: typeof facebookPageSearch;
  checkCandidate: typeof verifyCandidate;
  webSearch?: (q: string) => Promise<SearchHit[]>;
  /** Builds a per-search web search that can report when it switches provider. Wins over webSearch. */
  makeWebSearch?: (onSwitch: (msg: string) => void) => (q: string) => Promise<SearchHit[]>;
  pageSpeed: typeof pageSpeedMobile;
  apollo: typeof apolloEnrichDomain;
  /** Does this email domain accept mail? Leave out to skip the check (tests). */
  mx?: typeof domainAcceptsMail;
  cacheStats?: CacheStats;
  keys: { gmapsScraper?: string; google?: string; pageSpeed?: string; apollo?: string; brave?: string; metaToken?: string; igUserId?: string; fbPageSearch?: boolean };
  store: Store;
  now?: () => Date;
}

/** Runs one lead search end to end, reporting progress as it goes. */
export async function runSearch(params: SearchParams, deps: Deps, emit: (e: ProgressEvent) => void): Promise<{ search: SearchRecord; leads: Lead[] }> {
  const log = (message: string, level: "info" | "warn" | "error" = "info") => emit({ type: "log", level, message });
  const search: SearchRecord = {
    id: uid(),
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
    params,
    status: "running",
    counts: { found: 0, afterDedupe: 0, hot: 0, warm: 0, cold: 0 },
  };
  emit({ type: "start", searchId: search.id });
  await deps.store.saveSearch(search);

  try {
    const place = params.area ? `${params.area}, ${params.city}` : params.city;
    const rawSearch = deps.makeWebSearch ? deps.makeWebSearch((m) => log(m, "warn")) : deps.webSearch;
    // Businesses are checked many at a time; web searches still go out at most 3 at once.
    const webSearch = rawSearch ? limited(rawSearch, 3) : undefined;
    const cats = params.categories.map(categoryByKey).filter((c): c is NonNullable<typeof c> => !!c);
    if (!cats.length) throw new Error("Pick at least one business type.");

    const useGoogle = params.sources.google && !!deps.keys.google;
    if (params.sources.google && !deps.keys.google) log("Google Places is on but no API key is set. Skipping Google. Add GOOGLE_PLACES_API_KEY to .env.local.", "warn");
    let useOsm = params.sources.osm;
    let osmBox: BBox | undefined;
    if (useOsm) {
      try {
        const g = await deps.geocode(place, (m) => log(m, "warn"));
        osmBox = g.box;
      } catch (e) {
        useOsm = false;
        log(`OpenStreetMap skipped: ${msg(e)}`, "warn");
      }
    }
    const useGmaps = params.sources.gmaps && !!deps.keys.gmapsScraper;
    if (params.sources.gmaps && !deps.keys.gmapsScraper) log("Google Maps scraper is on but not available (not set up, or this is a live build where it's switched off). Skipping it.", "warn");
    const socialPossible = useGmaps || (params.sources.instagram || params.sources.facebook || params.sources.web) && (!!webSearch || (!!deps.keys.fbPageSearch && !!deps.keys.metaToken));
    if (!useGoogle && !useOsm && !socialPossible) throw new Error(params.sources.osm ? "OpenStreetMap couldn't find this place and there is no Google key. Check the city name, or add GOOGLE_PLACES_API_KEY." : "No lead source is available. Turn on OpenStreetMap or add a Google Places key.");

    // 1. search
    const raw: RawPlace[] = [];
    const fbApi = params.sources.facebook && deps.keys.fbPageSearch && !!deps.keys.metaToken;
    const useIg = params.sources.instagram && !!webSearch;
    const useFb = params.sources.facebook && (fbApi || !!webSearch);
    const useWeb = params.sources.web && !!webSearch;
    const jobs = cats.flatMap((c) => [
      ...(useGoogle ? [{ src: "google" as const, c }] : []),
      ...(useOsm ? [{ src: "osm" as const, c }] : []),
      ...(useIg ? [{ src: "instagram" as const, c }] : []),
      ...(useFb ? [{ src: "facebook" as const, c }] : []),
      ...(useWeb ? [{ src: "web" as const, c }] : []),
    ]);
    if (!useGoogle && !useOsm && !useIg && !useFb && !useWeb && !useGmaps) throw new Error("No lead source is available.");
    let done = 0, googleRequests = 0;
    const total = jobs.length + (useGmaps ? 1 : 0);
    emit({ type: "stage", stage: "search", done, total });

    const runJob = async (j: (typeof jobs)[number]) => {
      try {
        if (j.src === "google") {
          const r = await deps.google({ apiKey: deps.keys.google!, query: `${j.c.google} in ${place}`, category: j.c.label, city: params.city, max: params.perCategory });
          googleRequests += r.requests;
          raw.push(...r.places);
          log(`Google Maps: ${r.places.length} × ${j.c.label} in ${place}`);
        } else if (j.src === "osm") {
          const r = await deps.osm({ place, box: osmBox, filters: j.c.osm, category: j.c.label, city: params.city, max: params.perCategory });
          raw.push(...r);
          log(`OpenStreetMap: ${r.length} × ${j.c.label} in ${place}`);
        } else if (j.src === "web") {
          const r = await deps.web({ term: j.c.google, place, city: params.city, area: params.area, category: j.c.label, max: Math.min(params.perCategory, 10) }, { search: webSearch! });
          raw.push(...r.places);
          const why = [...new Set(r.rejected.map((x) => x.why))].map((w) => `${r.rejected.filter((x) => x.why === w).length} ${w}`).join(", ");
          log(`Search engines: ${r.places.length} × ${j.c.label} with their own website in ${place}${why ? ` (skipped: ${why})` : ""}`);
        } else if (j.src === "facebook" && fbApi) {
          const pages = await deps.fbSearch({ token: deps.keys.metaToken!, query: `${j.c.google} ${place}`, max: params.perCategory });
          for (const p of pages)
            raw.push({ source: "facebook", sourceId: p.id, name: p.name, category: j.c.label, city: params.city, address: [p.street, p.city].filter(Boolean).join(", ") || undefined, lat: p.lat, lng: p.lng, phone: p.phone, website: p.website || p.link });
          log(`Facebook Pages: ${pages.length} × ${j.c.label} in ${place}`);
        } else {
          const r = await deps.social({ platform: j.src, businessTerm: j.c.google, place, category: j.c.label, city: params.city, max: Math.min(params.perCategory, 10), search: webSearch! });
          raw.push(...r);
          log(`${j.src === "instagram" ? "Instagram" : "Facebook"} (web search): ${r.length} × ${j.c.label} profiles in ${place}`);
        }
      } catch (e) {
        log(`${SOURCE_LABEL[j.src]} failed for ${j.c.label}: ${msg(e)}`, "warn");
      }
      emit({ type: "stage", stage: "search", done: ++done, total });
    };

    // All sources at once, each at a pace its server accepts (public OpenStreetMap servers allow ~2 at a time).
    const group = (srcs: string[]) => jobs.filter((j) => srcs.includes(j.src));
    await Promise.all([
      mapLimit(group(["google"]), 3, runJob),
      mapLimit(group(["osm"]), 2, runJob),
      mapLimit(group(["web", "instagram", "facebook"]), 3, runJob),
      // Google Maps scraper (local testing only): one business type at a time, minutes each.
      useGmaps
        ? (async () => {
            log(`Google Maps scraper (testing only): searching ${cats.length} business type${cats.length > 1 ? "s" : ""}. About 2–4 minutes each.`);
            const results = await deps.gmaps({
              baseUrl: deps.keys.gmapsScraper!,
              city: params.city,
              max: params.perCategory,
              requests: cats.map((c) => ({ category: c.label, keyword: `${c.google} in ${place}` })),
              onProgress: (m) => log(m),
            });
            for (const r of results) {
              raw.push(...r.places);
              if (r.error) log(`Google Maps scraper failed for ${r.category}: ${r.error}`, "warn");
              else log(`Google Maps scraper: ${r.places.length} × ${r.category} in ${place}`);
            }
            emit({ type: "stage", stage: "search", done: ++done, total });
          })()
        : Promise.resolve(),
    ]);
    if (googleRequests) log(`Used ${googleRequests} Google Places request${googleRequests > 1 ? "s" : ""} (1,000 free per month).`);
    search.counts.found = raw.length;

    // 2. merge + drop closed
    let leads = mergePlaces(raw);
    const closed = leads.filter((l) => l.businessStatus === "CLOSED_PERMANENTLY").length;
    leads = leads.filter((l) => l.businessStatus !== "CLOSED_PERMANENTLY");
    search.counts.afterDedupe = leads.length;
    log(`${raw.length} results → ${leads.length} unique businesses${closed ? ` (${closed} permanently closed removed)` : ""}.`);
    emit({ type: "stage", stage: "dedupe", done: 1, total: 1 });

    // 2b. chains: same name at several places in this search, or a brand tag on the map
    const byName = new Map<string, Lead[]>();
    for (const l of leads) {
      const k = simplifyName(l.name);
      if (k) byName.set(k, [...(byName.get(k) ?? []), l]);
    }
    for (const group of byName.values()) {
      for (const l of group) {
        if (group.length >= 2) l.chain = { outlets: group.length, reason: `${group.length} outlets with this name in this search` };
        else {
          const reason = chainReason(l);
          if (reason) l.chain = { outlets: 1, reason };
        }
      }
    }
    const chains = leads.filter((l) => l.chain).length;
    if (chains) log(`${chains} look like chain or franchise outlets. They're kept but scored low: head office decides their website.`);

    // 3. Show every business now, then check each one and update it as soon as it's done.
    for (const l of leads) {
      l.websiteCheck = { via: l.website && !isSocialHost(domainOf(l.website)) ? "source" : "none_found", tried: [l.sources.map((x) => SOURCE_LABEL[x]).join(" + ")] };
      Object.assign(l, scoreWebsiteDev(l, deps.now?.()));
      l.pending = true;
    }
    emit({ type: "leads", leads });
    const progress = saver(() => deps.store.saveLeads(search.id, leads));
    progress.now();

    const needSite = params.verifyWebsites ? leads.filter((l) => !l.chain && (!l.website || isSocialHost(domainOf(l.website)))).length : 0;
    const siteSearch = params.verifyWebsites && params.webSearch ? webSearch : undefined;
    if (needSite) log(`Checking ${leads.length} businesses. ${needSite} have no website listed: looking for one (likely web addresses${siteSearch ? ", web search and their phone number" : ""}).`);
    const state = { searchBroken: false };
    let checked = 0;
    emit({ type: "stage", stage: "enrich", done: 0, total: leads.length });
    // businesses with a phone first: they're the ones you can call
    const order = [...leads].sort((a, b) => Number(!!b.phone) - Number(!!a.phone));
    await mapLimit(order, 8, async (l) => {
      try {
        await qualifyLead(l, { area: params.area, verify: params.verifyWebsites, search: siteSearch, state }, deps);
      } catch (e) {
        l.websiteCheck?.tried.push(`check failed: ${msg(e)}`);
      }
      Object.assign(l, scoreWebsiteDev(l, deps.now?.()));
      l.pending = false;
      emit({ type: "lead", lead: l });
      emit({ type: "stage", stage: "enrich", done: ++checked, total: leads.length });
      progress.soon();
    });
    await progress.flush();
    const found = leads.filter((l) => l.websiteCheck?.via === "domain_guess" || l.websiteCheck?.via === "web_search").length;
    if (needSite) log(`Found and verified ${found} website${found === 1 ? "" : "s"} the map data didn't list.${state.searchBroken ? " Web search stopped partway (every search option failed). Set up SearXNG (free, see README) or a free Tavily key." : ""}`);
    const before = leads.length;
    leads = mergeBySocial(leads);
    if (leads.length < before) log(`${before - leads.length} Instagram/Facebook results were the same businesses as map results. Merged.`);

    // 3c. Instagram profiles via Meta's official API
    const withIg = leads.filter((l) => l.social?.instagram);
    if (withIg.length && deps.keys.metaToken && deps.keys.igUserId) {
      const cap = withIg.slice(0, 150); // stay well inside Meta's hourly limit
      log(`Reading ${cap.length} Instagram profile${cap.length > 1 ? "s" : ""} through Meta's official API.`);
      let n = 0, stop = "";
      emit({ type: "stage", stage: "social", done: 0, total: cap.length });
      await mapLimit(cap, 3, async (l) => {
        const ig = l.social!.instagram!;
        if (!stop) {
          try {
            const p = await deps.igLookup({ token: deps.keys.metaToken!, igUserId: deps.keys.igUserId!, handle: ig.handle });
            if (!p) ig.checked = "not_business";
            else {
              Object.assign(ig, { name: p.name, bio: p.bio, website: p.website, followers: p.followers, posts: p.posts, lastPostAt: p.lastPostAt, checked: "api" as const });
              if (l.sources.length === 1 && l.sources[0] === "instagram" && p.name) l.name = p.name;
              for (const m of (p.bio ?? "").match(/(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}/g) ?? []) {
                const ph = normalizePhone(m);
                if (ph && !l.phones.includes(ph)) l.phones.push(ph);
              }
              l.phone ??= l.phones[0];
              // Their own bio links a website? Check it's really theirs, then use it.
              const link = firstRealLink(p.website, p.bio);
              const noWorkingSite = !l.audit || l.audit.status !== "ok";
              if (link && noWorkingSite) {
                const v = await deps.checkCandidate(link, l, params.area);
                l.websiteCheck?.tried.push(`website in Instagram bio: ${link} (${v.ok ? "verified" : v.evidence})`);
                if (v.ok) {
                  l.website = v.finalUrl ?? link;
                  l.websiteCheck = { ...l.websiteCheck!, via: "instagram_bio", evidence: v.evidence };
                  l.audit = await deps.audit(l.website);
                }
              } else if (!link && noWorkingSite) l.websiteCheck?.tried.push("Instagram profile has no website link");
            }
          } catch (e) {
            if (e instanceof MetaError && (e.kind === "auth" || e.kind === "limit")) stop = e.message;
            else log(`Instagram @${ig.handle}: ${msg(e)}`, "warn");
          }
        }
        emit({ type: "stage", stage: "social", done: ++n, total: cap.length });
      });
      if (stop) log(`Instagram check stopped: ${stop}`, "warn");
    } else if (withIg.length && (params.sources.instagram || withIg.length)) {
      if (!deps.keys.metaToken || !deps.keys.igUserId) log(`${withIg.length} businesses have an Instagram profile. Add META_ACCESS_TOKEN and IG_BUSINESS_ACCOUNT_ID to read their followers, last post and bio website.`);
    }

    const withSite = leads.filter((l) => l.audit?.status === "ok");
    if (params.pageSpeed && withSite.length) {
      log(`Checking mobile speed for ${withSite.length} websites. This is the slow part (10–30s each).`);
      let sp = 0;
      let ok = 0;
      const errs = new Map<string, number>();
      await mapLimit(withSite, 3, async (l) => {
        try {
          l.audit!.pageSpeed = await deps.pageSpeed(l.audit!.finalUrl || l.website!, deps.keys.pageSpeed);
          ok++;
        } catch (e) {
          const m = msg(e);
          errs.set(m, (errs.get(m) ?? 0) + 1);
        }
        emit({ type: "stage", stage: "speed", done: ++sp, total: withSite.length });
      });
      log(`Mobile speed checked for ${ok} of ${withSite.length} websites${deps.keys.pageSpeed ? " (using your PageSpeed key)" : " (no key: Google allows only a few checks without one)"}.`, ok ? "info" : "warn");
      for (const [m, n] of errs) log(`${n} speed check${n > 1 ? "s" : ""} failed: ${m}`, "warn");
    }
    if (params.sources.apollo && deps.keys.apollo) {
      const targets = leads.filter((l) => l.website && !isSocialHost(domainOf(l.website)));
      await mapLimit(targets, 3, async (l) => {
        try {
          const o = await deps.apollo(deps.keys.apollo!, domainOf(l.website)!);
          if (o) {
            l.company = { employees: o.employees, linkedin: o.linkedin, foundedYear: o.foundedYear };
            const p = normalizePhone(o.phone);
            if (p && !l.phones.includes(p)) l.phones.push(p);
            if (!l.sources.includes("apollo")) l.sources.push("apollo");
          }
        } catch (e) {
          log(`Apollo: ${msg(e)}`, "warn");
        }
      });
    } else if (params.sources.apollo) log("Apollo is on but no key is set. Skipping.", "warn");

    // 4. score
    for (const l of leads) Object.assign(l, scoreWebsiteDev(l, deps.now?.()));
    leads.sort((a, b) => b.score - a.score);
    search.counts.hot = leads.filter((l) => l.tier === "hot").length;
    search.counts.warm = leads.filter((l) => l.tier === "warm").length;
    search.counts.cold = leads.filter((l) => l.tier === "cold").length;
    emit({ type: "stage", stage: "score", done: 1, total: 1 });

    if (deps.cacheStats && deps.cacheStats.hits) log(`Reused ${deps.cacheStats.hits} saved check${deps.cacheStats.hits > 1 ? "s" : ""} from earlier searches (kept up to 7 days; LEAD_CACHE=off to turn off).`);

    // 5. save
    search.status = "done";
    await deps.store.saveSearch(search);
    await deps.store.saveLeads(search.id, leads);
    emit({ type: "stage", stage: "save", done: 1, total: 1 });
    log(`Done: ${search.counts.hot} hot, ${search.counts.warm} warm, ${search.counts.cold} cold.`);
    return { search, leads };
  } catch (e) {
    search.status = "failed";
    search.error = msg(e);
    await deps.store.saveSearch(search).catch(() => {});
    log(search.error, "error");
    return { search, leads: [] };
  }
}

const SOURCE_LABEL: Record<string, string> = {
  google: "Google Maps listing",
  osm: "OpenStreetMap listing",
  apollo: "Apollo",
  instagram: "Instagram profile",
  facebook: "Facebook Page",
  web: "Search engine result",
  gmaps: "Google Maps (scraper)",
};

/** Big brands we shouldn't pitch a local website to. A starting list; grows with real runs. */
/** A single business that is still a chain outlet: a brand tag on the map, or a well-known chain name. */
export function chainReason(l: Pick<Lead, "name" | "brand">): string | undefined {
  if (l.brand) return `listed on the map as part of the "${l.brand}" brand`;
  if (KNOWN_CHAINS.test(l.name)) return "a well-known chain";
  return undefined;
}

const KNOWN_CHAINS = new RegExp(
  "\\b(" +
    [
      "pizza hut", "domino'?s", "mc ?donald'?s", "kfc", "subway", "starbucks", "burger king", "barbeque nation", "haldiram'?s",
      "cafe coffee day", "ccd", "tea post", "chai point", "chaayos", "theobroma", "the chocolate room", "baskin robbins", "keventers",
      "wow! ?momo", "la pino'?z", "biryani by kilo", "behrouz", "faasos", "taco bell", "dunkin", "costa coffee", "third wave coffee",
      "apollo (clinic|pharmacy|hospitals?)", "dr\\.? lal pathlabs", "thyrocare", "metropolis", "clove dental", "sabka dentist", "kaya (skin )?clinic",
      "vlcc", "lakm[eé] salon", "naturals", "jawed habib", "green trends", "enrich salon", "toni ?& ?guy", "looks salon",
      "anytime fitness", "gold'?s gym", "cult\\.?fit", "snap fitness", "talwalkars",
      "oyo", "treebo", "fabhotel", "hampton by hilton", "hilton", "marriott", "courtyard", "hyatt", "radisson", "novotel", "ibis", "lemon tree", "taj ", "vivanta", "fortune ",
      "aakash", "allen career", "fiitjee", "byju'?s", "physics ?wallah", "kumon",
      "tanishq", "reliance (trends|digital|smart)", "d-?mart", "big bazaar", "more supermarket", "lenskart", "titan", "bata",
      "pind balluchi", "nilkamal", "durian", "interio", "pepperfry", "welcomhotel", "fortune park", "max fashion", "pantaloons", "westside", "zudio", "shoppers stop", "v-?mart", "fabindia", "manyavar", "raymond", "home ?centre",
    ].join("|") +
    ")\\b",
  "i",
);

type Emit = (e: ProgressEvent) => void;
const logTo = (emit: Emit) => (message: string, level: "info" | "warn" | "error" = "info") => emit({ type: "log", level, message });

/**
 * Everything we learn about one business: before believing "no website", look for one (likely web
 * addresses, web search, its phone number); then load the site for emails, phones, owner; check emails.
 * Chains are skipped for the search (head office decides their website). Used by the search and the benchmark.
 */
export async function qualifyLead(
  l: Lead,
  opts: { area?: string; verify: boolean; search?: (q: string) => Promise<SearchHit[]>; state?: { searchBroken: boolean } },
  deps: Pick<Deps, "discover" | "audit" | "mx">,
): Promise<void> {
  const state = opts.state ?? { searchBroken: false };
  l.websiteCheck ??= { via: l.website && !isSocialHost(domainOf(l.website)) ? "source" : "none_found", tried: [l.sources.map((x) => SOURCE_LABEL[x]).join(" + ")] };
  if (opts.verify && !l.chain && (!l.website || isSocialHost(domainOf(l.website)))) {
    const r = await deps.discover(l, opts.area, { search: state.searchBroken ? undefined : opts.search });
    l.websiteCheck.tried.push(...r.tried);
    if (r.tried.some((t) => /No web search available|captcha/i.test(t))) state.searchBroken = true;
    if (r.website) {
      l.website = r.website;
      l.websiteCheck.via = r.via!;
      l.websiteCheck.evidence = r.evidence;
      if (r.chainHint) l.chain = { outlets: 1, reason: r.chainHint };
    } else if (r.social && !l.website) {
      rememberSocial(l, r.social);
      l.website = r.social;
      l.websiteCheck.via = "web_search";
      l.websiteCheck.evidence = "social page found by web search (its title carries the business name)";
    }
  }
  l.audit = await deps.audit(l.website);
  for (const e of l.audit.emails) if (!l.emails.includes(e)) l.emails.push(e);
  for (const p of l.audit.phones) if (!l.phones.includes(p)) l.phones.push(p);
  if (l.audit.whatsapp && !l.phones.includes(l.audit.whatsapp)) l.phones.push(l.audit.whatsapp);
  if (l.audit.ownerName && !l.owner) l.owner = { name: l.audit.ownerName, via: "website" };
  l.phone ??= l.phones[0];
  for (const u of Object.values(l.audit.socials ?? {})) rememberSocial(l, u);
  await checkEmails([l], deps.mx);
}

/** At most `n` calls in flight; the rest wait their turn. */
export function limited<A extends unknown[], R>(fn: (...a: A) => Promise<R>, n: number): (...a: A) => Promise<R> {
  let active = 0;
  const queue: Array<() => void> = [];
  return async (...a: A) => {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn(...a);
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

/** Saves partial results every few seconds (one save at a time), so a closed tab or a reload still finds them. */
function saver(save: () => Promise<void>, everyMs = 4000) {
  let inFlight: Promise<void> | null = null, last = 0, again = false;
  const run = () => {
    inFlight = save().catch(() => {}).finally(() => {
      inFlight = null;
      last = Date.now();
      if (again) { again = false; run(); }
    });
  };
  return {
    now: () => (inFlight ? (again = true) : run()),
    soon: () => { if (!inFlight && Date.now() - last >= everyMs) run(); },
    flush: async () => { while (inFlight) await inFlight; },
  };
}

/** Rank each lead's emails (owner's own first) and, when `mx` is given, drop domains that can't receive mail from first place. */
export async function checkEmails(leads: Lead[], mx?: typeof domainAcceptsMail): Promise<void> {
  const domains = [...new Set(leads.flatMap((l) => l.emails.map((e) => e.split("@")[1]?.toLowerCase()).filter(Boolean) as string[]))];
  const ok = new Map<string, boolean | undefined>();
  if (mx) await mapLimit(domains, 10, async (d) => void ok.set(d, await mx(d)));
  for (const l of leads) {
    if (!l.emails.length) continue;
    const site = domainOf(l.audit?.finalUrl ?? l.website);
    l.emailInfo = rankEmails(l.emails.map((email) => ({ email, kind: classifyEmail(email, site), deliverable: ok.get(email.split("@")[1]?.toLowerCase()) })));
    const best = l.emailInfo[0];
    l.email = best.deliverable === false ? undefined : best.email;
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Checks worth remembering between searches (see lib/cache.ts). Website checks that failed are kept
 * only a day, since sites come back; web searches and verified finds a week.
 */
function withCache(stats: CacheStats) {
  const mode = cacheMode();
  if (mode === "off") return null;
  const search = (fn: (q: string) => Promise<SearchHit[]>) => cached("websearch", fn, (q: string) => q.trim().toLowerCase(), (hits) => (hits.length ? 7 * DAY : 0), stats);
  if (mode === "search") return { search, audit: undefined, discover: undefined };
  const leadKey = (l: Lead, area?: string) => [simplifyName(l.name), l.phone ?? "", l.city ?? "", area ?? "", l.address ?? ""].join("|").toLowerCase();
  return {
    audit: cached("audit", auditWebsite, (w?: string) => (w ?? "").trim().toLowerCase(), (a: WebsiteAudit) => (a.status === "ok" || a.status === "social_only" ? 7 * DAY : a.status === "down" ? DAY : 0), stats),
    // discovery depends on whether web search was allowed, so that's part of the key
    discover: ((l, area, d) =>
      cached("discover", (_l: Lead) => discoverWebsite(l, area, d), () => `${leadKey(l, area)}|${d?.search ? "search" : "guess"}`, (r) => (r.website ? 7 * DAY : r.tried.some((t) => /failed|captcha|No web search/i.test(t)) ? 0 : 3 * DAY), stats)(l)) as typeof discoverWebsite,
    search,
  };
}

export function defaultDeps(store: Store): Deps {
  const cacheStats: CacheStats = { hits: 0, misses: 0 };
  const c = withCache(cacheStats);
  return {
    makeWebSearch: (onSwitch) => {
      const s = searchChain(providersFromEnv(), onSwitch);
      return c ? c.search(s) : s;
    },
    google: googleTextSearch,
    osm: osmSearch,
    geocode: geocodeBBox,
    discover: c?.discover ?? discoverWebsite,
    social: socialSearch,
    web: webLeadSearch,
    gmaps: gmapsScrapeBatch,
    igLookup: instagramBusinessDiscovery,
    fbSearch: facebookPageSearch,
    checkCandidate: verifyCandidate,
    audit: c?.audit ?? auditWebsite,
    pageSpeed: pageSpeedMobile,
    apollo: apolloEnrichDomain,
    mx: domainAcceptsMail,
    cacheStats,
    keys: {
      google: process.env.GOOGLE_PLACES_API_KEY || undefined,
      pageSpeed: process.env.PAGESPEED_API_KEY || undefined,
      apollo: process.env.APOLLO_API_KEY || undefined,
      brave: process.env.BRAVE_SEARCH_API_KEY || undefined,
      gmapsScraper: gmapsScraperUrl(),
      metaToken: process.env.META_ACCESS_TOKEN || undefined,
      igUserId: process.env.IG_BUSINESS_ACCOUNT_ID || undefined,
      fbPageSearch: /^(on|true|1|yes)$/i.test(process.env.FB_PAGE_SEARCH || ""),
    },
    store,
  };
}
