import { countryKey, currentCountry, withCountry } from "./marketContext";
import { categoryByKey } from "./categories";
import { mergePlaces } from "./dedupe";
import { auditWebsite } from "./enrich/crawl";
import { discoverWebsite, verifyCandidate, type SearchHit } from "./enrich/discover";
import { exactSearchChain, providersFromEnv, searchChain } from "./enrich/searchProviders";
import { pageSpeedMobile } from "./enrich/pagespeed";
import { scoreWebsiteDev } from "./score/websiteDev";
import { scoreLogistics } from "./score/logistics";
import { apolloEnrichDomain } from "./sources/apollo";
import { googleTextSearch } from "./sources/googlePlaces";
import { geocodeBBox, osmSearch, type BBox } from "./sources/osm";
import { facebookPageSearch, firstRealLink, instagramBusinessDiscovery, MetaError } from "./sources/meta";
import { socialSearch } from "./sources/social";
import { webLeadSearch } from "./sources/webSearch";
import { gmapsScrapeBatch, gmapsScraperUrl } from "./sources/gmapsScraper";
import { mergeBySocial, rememberSocial } from "./dedupe";
import { cached, cacheMode, DAY, type CacheStats } from "./cache";
import { forDirectory, localDirectory, RECHECK_AFTER, whatChanged, type Directory, type DirectoryEntry } from "./directory";
import { classifyEmail, isDisposable, looksLikeEmail, rankEmails, usable } from "./enrich/email";
import { domainRegisteredOn, registrableDomain } from "./enrich/domainAge";
import { cappedVerifier, verifierFromEnv, type EmailVerifier, type MailboxCheck, type VerifyStats } from "./enrich/verifyEmail";
import { domainAcceptsMail } from "./enrich/mx";
import type { WebsiteAudit } from "./types";
import type { Store } from "./store";
import type { Lead, ProgressEvent, RawPlace, SearchParams, SearchRecord } from "./types";
import { domainOf, isSocialHost, mapLimit, normalizePhone, simplifyName, uid, phonesInText } from "./util";

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
  /** Search for phone numbers: only providers that match exact numbers. Undefined when none is set up. */
  makeNumberSearch?: (onSwitch: (msg: string) => void) => ((q: string) => Promise<SearchHit[]>) | undefined;
  pageSpeed: typeof pageSpeedMobile;
  apollo: typeof apolloEnrichDomain;
  /** Does this email domain accept mail? Leave out to skip the check (tests). */
  mx?: typeof domainAcceptsMail;
  /** Mailbox-level email check through a service (EMAIL_VERIFY_KEY); at most `emailVerifyCap` a search (default 50). */
  emailVerify?: EmailVerifier;
  emailVerifyCap?: number;
  /** When a website's domain was registered (public RDAP records); a young domain hints at a new business. */
  domainAge?: (host: string) => Promise<string | null | undefined>;
  cacheStats?: CacheStats;
  /** Saved businesses from earlier searches and the prefill. Leave out to always search live. */
  directory?: Directory;
  /** Pause (ms) between showing saved businesses that don't need a recheck, so results arrive at a readable pace. */
  revealMs?: number;
  /** While sources are still searching, show what's been found at most this often (ms). */
  previewMs?: number;
  keys: { gmapsScraper?: string; google?: string; pageSpeed?: string; apollo?: string; brave?: string; metaToken?: string; igUserId?: string; fbPageSearch?: boolean; phoneSearch?: "auto" | "on" | "off" };
  store: Store;
  now?: () => Date;
}

/** Runs one lead search end to end, reporting progress as it goes. */
/**
 * A late Google Maps scraper result for a business already in the list: fill in what it adds.
 * Returns true when it brought a website the business didn't have, so it needs checking again.
 */
function absorbLate(l: Lead, g: Lead): boolean {
  for (const s of g.sources) if (!l.sources.includes(s)) l.sources.push(s);
  l.rating ??= g.rating;
  l.reviews ??= g.reviews;
  l.owner ??= g.owner;
  l.mapsUrl ??= g.mapsUrl;
  l.orderLinks ??= g.orderLinks;
  l.photos ??= g.photos;
  l.openHours ??= g.openHours;
  l.about ??= g.about;
  for (const p of g.phones) if (!l.phones.includes(p)) l.phones.push(p);
  l.phone ??= g.phone;
  for (const e of g.emails) if (!l.emails.includes(e)) l.emails.push(e);
  const newSite = !!g.website && !isSocialHost(domainOf(g.website)) && (!l.website || isSocialHost(domainOf(l.website))) && l.audit?.status !== "ok";
  if (newSite) {
    l.website = g.website;
    l.websiteCheck = { via: "source", tried: [...(l.websiteCheck?.tried ?? []), "website from Google Maps"] };
    l.pending = true;
  }
  return newSite;
}

export function runSearch(params: SearchParams, deps: Deps, emit: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<{ search: SearchRecord; leads: Lead[] }> {
  // every lookup in this search (map, Google, search engines, phones) uses the search's country
  return withCountry(params.country, () => runSearchIn(params, deps, emit, signal));
}

async function runSearchIn(params: SearchParams, deps: Deps, emit: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<{ search: SearchRecord; leads: Lead[] }> {
  const stopped = () => !!signal?.aborted;
  const log = (message: string, level: "info" | "warn" | "error" = "info") => emit({ type: "log", level, message });
  const search: SearchRecord = {
    id: uid(),
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
    params,
    status: "running",
    counts: { found: 0, afterDedupe: 0, hot: 0, warm: 0, cold: 0 },
  };
  emit({ type: "start", searchId: search.id });
  /** Websites: how badly they need a new site. Logistics: how much freight they'd bring the client. */
  const score = (l: Lead) => {
    if (params.sells !== "logistics") return scoreWebsiteDev(l, deps.now?.());
    const r = scoreLogistics(l, params.client?.services, deps.now?.());
    return { ...r, pitchFor: { ...r.pitchFor, client: params.client?.name || undefined } };
  };
  await deps.store.saveSearch(search);

  try {
    const place = params.area ? `${params.area}, ${params.city}` : params.city;
    const rawSearch = deps.makeWebSearch ? deps.makeWebSearch((m) => log(m, "warn")) : deps.webSearch;
    // Businesses are checked many at a time; web searches still go out at most 3 at once.
    const webSearch = rawSearch ? limited(rawSearch, 3) : undefined;
    // Phone numbers: only to providers that match exact numbers ("auto"), to any provider ("on"), or never.
    const phoneMode = deps.keys.phoneSearch ?? "auto";
    const rawNumber = phoneMode === "off" ? undefined : deps.makeNumberSearch?.((m) => log(m, "warn")) ?? (phoneMode === "on" ? rawSearch : undefined);
    const numberSearch = rawNumber ? limited(rawNumber, 3) : undefined;
    const cats = params.categories.map(categoryByKey).filter((c): c is NonNullable<typeof c> => !!c);
    if (!cats.length) throw new Error("Pick at least one business type.");

    // 0. saved businesses for this area and these types (from earlier searches or the prefill)
    const saved = new Map<string, DirectoryEntry>();
    if (deps.directory && !params.fresh)
      for (const c of cats) {
        const e = await deps.directory.get(params.city, params.area, c.key).catch(() => undefined);
        if (e) saved.set(c.key, e);
      }
    const liveCats = cats.filter((c) => !saved.has(c.key));
    if (saved.size) {
      const oldest = Math.min(...[...saved.values()].map((e) => Date.parse(e.savedAt)));
      const days = Math.floor(((deps.now?.() ?? new Date()).getTime() - oldest) / DAY);
      log(`Found saved data for ${[...saved.keys()].map((k) => categoryByKey(k)?.label ?? k).join(", ")} in ${place} (checked ${days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}). Rechecking it and looking for new businesses.`);
    }

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
    if (!useGoogle && !useOsm && !socialPossible && saved.size < cats.length) throw new Error(params.sources.osm ? "OpenStreetMap couldn't find this place and there is no Google key. Check the city name, or add GOOGLE_PLACES_API_KEY." : "No lead source is available. Turn on OpenStreetMap or add a Google Places key.");

    // 1. search
    const raw: RawPlace[] = [];
    /** Ways two results can be the same business: place id, map id, phone, own website, name in the city. */
    const keysOf = (l: Lead) => [l.placeId && `g:${l.placeId}`, l.osmId && `o:${l.osmId}`, ...[l.phone, ...l.phones].filter(Boolean).map((p) => `p:${p!.replace(/\D/g, "").slice(-10)}`), l.website && !isSocialHost(domainOf(l.website)) && `w:${domainOf(l.website)}`, `n:${simplifyName(l.name)}|${(l.city ?? "").toLowerCase()}`].filter(Boolean) as string[];
    /** Give `to` the ids (and any status you set) of the same businesses in `from`, so the list on screen stays put. */
    const carry = (from: Lead[], to: Lead[]) => {
      const byKey = new Map<string, Lead>();
      for (const l of from) for (const k of keysOf(l)) byKey.set(k, l);
      const used = new Set<string>();
      for (const l of to) {
        const m = keysOf(l).map((k) => byKey.get(k)).find((x) => x && !used.has(x.id));
        if (!m) continue;
        used.add(m.id);
        l.id = m.id;
        if (m.followUp) l.followUp = m.followUp;
      }
    };
    // While the sources are still searching, show what's been found so far (not yet checked).
    let previewLeads: Lead[] = [];
    let lastPreview = 0, previewedAt = 0;
    const preview = () => {
      const every = deps.previewMs ?? 4000;
      if (stopped() || raw.length === previewedAt || Date.now() - lastPreview < every) return;
      lastPreview = Date.now();
      previewedAt = raw.length;
      const next = mergePlaces(raw).filter((l) => l.businessStatus !== "CLOSED_PERMANENTLY");
      for (const l of next) {
        l.websiteCheck = { via: l.website && !isSocialHost(domainOf(l.website)) ? "source" : "none_found", tried: [l.sources.map((x) => SOURCE_LABEL[x]).join(" + ")] };
        Object.assign(l, score(l));
        l.pending = true;
      }
      carry(previewLeads, next);
      previewLeads = next;
      emit({ type: "leads", leads: next });
    };
    const fbApi = params.sources.facebook && deps.keys.fbPageSearch && !!deps.keys.metaToken;
    const useIg = params.sources.instagram && !!webSearch;
    const useFb = params.sources.facebook && (fbApi || !!webSearch);
    const useWeb = params.sources.web && !!webSearch;
    const jobs = [
      ...liveCats.flatMap((c) => [
        ...(useGoogle ? [{ src: "google" as const, c }] : []),
        ...(useOsm && c.osm.length ? [{ src: "osm" as const, c }] : []),
        ...(useIg ? [{ src: "instagram" as const, c }] : []),
        ...(useFb ? [{ src: "facebook" as const, c }] : []),
        ...(useWeb ? [{ src: "web" as const, c }] : []),
      ]),
      // types with saved data: a free map search to catch businesses that opened since, plus any of
      // this search's sources that weren't used to build the saved data
      ...cats.filter((c) => saved.has(c.key)).flatMap((c) => {
        const had = saved.get(c.key)!.sources ?? ["osm"];
        return [
          ...(useGoogle && !had.includes("google") ? [{ src: "google" as const, c }] : []),
          ...(useOsm && c.osm.length ? [{ src: "osm" as const, c }] : []),
          ...(useIg && !had.includes("instagram") ? [{ src: "instagram" as const, c }] : []),
          ...(useFb && !had.includes("facebook") ? [{ src: "facebook" as const, c }] : []),
          ...(useWeb && !had.includes("web") ? [{ src: "web" as const, c }] : []),
        ];
      }),
    ];
    const usedSources = [useGoogle && "google", useOsm && "osm", useIg && "instagram", useFb && "facebook", useWeb && "web"].filter(Boolean) as string[];
    if (!useGoogle && !useOsm && !useIg && !useFb && !useWeb && !useGmaps && saved.size < cats.length) throw new Error("No lead source is available.");
    let done = 0, googleRequests = 0;
    const failedJobs = new Set<string>(); // "source:category" that errored, so the directory doesn't claim them
    const total = jobs.length + (useGmaps ? 1 : 0);
    emit({ type: "stage", stage: "search", done, total });

    const runJob = async (j: (typeof jobs)[number]) => {
      if (stopped()) return;
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
        failedJobs.add(`${j.src}:${j.c.key}`);
        log(`${SOURCE_LABEL[j.src]} failed for ${j.c.label}: ${msg(e)}`, "warn");
      }
      emit({ type: "stage", stage: "search", done: ++done, total });
      preview();
    };

    // Google Maps scraper (local testing only): one business type at a time, minutes each. It runs
    // alongside everything else; if it's still going when the others finish, their businesses are
    // checked meanwhile and its own are added when it's done.
    const gmapsRaw: RawPlace[] = [];
    let gmapsDone = !(useGmaps && liveCats.length);
    const gmapsP: Promise<void> = gmapsDone
      ? Promise.resolve()
      : (async () => {
          log(`Google Maps scraper (testing only): searching ${liveCats.length} business type${liveCats.length > 1 ? "s" : ""}, one after another (about 1–3 minutes each).`);
          try {
            const results = await deps.gmaps({
              baseUrl: deps.keys.gmapsScraper!,
              city: params.city,
              max: params.perCategory,
              requests: liveCats.map((c) => ({ category: c.label, keyword: `${c.google} in ${place}` })),
              onProgress: (m) => !stopped() && log(m),
            });
            for (const r of results) {
              gmapsRaw.push(...r.places);
              if (r.error) log(`Google Maps scraper failed for ${r.category}: ${r.error}`, "warn");
              else log(`Google Maps scraper: ${r.places.length} × ${r.category} in ${place}`);
            }
          } catch (e) {
            log(`Google Maps scraper failed: ${msg(e)}`, "warn");
          }
          gmapsDone = true;
          emit({ type: "stage", stage: "search", done: ++done, total });
        })();
    /** Resolves when the scraper is done, or at once when the search is stopped. */
    const untilScraperDone = () => Promise.race([gmapsP, new Promise<void>((r) => (signal?.aborted ? r() : signal?.addEventListener("abort", () => r(), { once: true })))]);

    // All sources at once, each at a pace its server accepts (public OpenStreetMap servers allow ~2 at a time).
    const group = (srcs: string[]) => jobs.filter((j) => srcs.includes(j.src));
    await Promise.all([
      mapLimit(group(["google"]), 3, runJob),
      mapLimit(group(["osm"]), 2, runJob),
      mapLimit(group(["web", "instagram", "facebook"]), 3, runJob),
      // Google Maps scraper (local testing only): one business type at a time, minutes each.
    ]);
    let lateScraper = false;
    if (!gmapsDone && !raw.length && !saved.size) {
      log("Waiting for the Google Maps scraper: it's the only source still searching.");
      await untilScraperDone();
    }
    if (gmapsDone) raw.push(...gmapsRaw.splice(0));
    else if (!stopped()) {
      lateScraper = true;
      log(`Checking the ${raw.length} results found so far. The Google Maps scraper keeps going: its businesses are added as soon as it finishes.`);
    }
    if (googleRequests) log(`Used ${googleRequests} Google Places request${googleRequests > 1 ? "s" : ""} (1,000 free per month).`);
    search.counts.found = raw.length;

    // 2. merge + drop closed
    let leads = mergePlaces(raw);
    if (saved.size) {
      // saved businesses first; a live result that's one of them is dropped, the rest are new since last time
      const known = new Set<string>();
      const fromDir: Lead[] = [];
      for (const e of saved.values())
        for (const s of e.leads) {
          const ks = keysOf(s);
          if (ks.some((k) => known.has(k))) continue; // same business saved under two types
          ks.forEach((k) => known.add(k));
          fromDir.push({ ...s, saved: true, followUp: undefined, pitchFor: undefined, changes: undefined });
        }
      const fresh = leads.filter((l) => !keysOf(l).some((k) => known.has(k)));
      if (fresh.length && raw.length) log(`${fresh.length} new business${fresh.length === 1 ? "" : "es"} since the saved data.`);
      leads = [...fromDir, ...fresh];
    }
    const closed = leads.filter((l) => l.businessStatus === "CLOSED_PERMANENTLY").length;
    leads = leads.filter((l) => l.businessStatus !== "CLOSED_PERMANENTLY");
    if (previewLeads.length) carry(previewLeads, leads);
    search.counts.afterDedupe = leads.length;
    log(`${raw.length} results → ${leads.length} unique businesses${closed ? ` (${closed} permanently closed removed)` : ""}.`);
    emit({ type: "stage", stage: "dedupe", done: 1, total: 1 });

    // 2b. chains: same name at several places in this search, or a brand tag on the map
    const markChains = () => {
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
      return leads.filter((l) => l.chain).length;
    };
    const chains = markChains();
    if (chains) log(`${chains} look like chain or franchise outlets. They're kept but scored low: head office decides their website.`);

    // 3. Show every business now, then check each one and update it as soon as it's done.
    for (const l of leads) {
      l.country ??= currentCountry();
      if (!l.saved) l.websiteCheck = { via: l.website && !isSocialHost(domainOf(l.website)) ? "source" : "none_found", tried: [l.sources.map((x) => SOURCE_LABEL[x]).join(" + ")] };
      Object.assign(l, score(l));
      l.pending = true;
    }
    emit({ type: "leads", leads });
    const progress = saver(() => deps.store.saveLeads(search.id, leads));
    progress.now();

    // Saved businesses checked in the last week are ready; older ones and new ones get a full check.
    const nowMs = (deps.now?.() ?? new Date()).getTime();
    const needsCheck = (l: Lead) => !l.saved || !l.checkedAt || nowMs - Date.parse(l.checkedAt) > RECHECK_AFTER;
    const toCheck = leads.filter(needsCheck);
    const ready = leads.filter((l) => !needsCheck(l));
    const recheck = toCheck.filter((l) => l.saved).length;
    const needSite = params.verifyWebsites ? toCheck.filter((l) => !l.chain && (!l.website || isSocialHost(domainOf(l.website)))).length : 0;
    const siteSearch = params.verifyWebsites && params.webSearch ? webSearch : undefined;
    if (ready.length) log(`${ready.length} saved business${ready.length === 1 ? " was" : "es were"} checked in the last week: loading them${recheck ? `; rechecking ${recheck} older one${recheck === 1 ? "" : "s"}` : ""}.`);
    if (needSite) log(`Checking ${toCheck.length} businesses. ${needSite} have no website listed: looking for one (likely web addresses${siteSearch ? ", web search" : ""}${siteSearch && numberSearch ? " and their phone number" : ""}).`);
    const state = { searchBroken: false };
    const verifyStats: VerifyStats = { checked: 0, valid: 0, invalid: 0, catchAll: 0, skipped: 0 };
    const verifyEmail = deps.emailVerify ? cappedVerifier(deps.emailVerify, deps.emailVerifyCap ?? 50, verifyStats) : undefined;
    let checked = 0, changed = 0;
    emit({ type: "stage", stage: "enrich", done: 0, total: leads.length });
    // businesses with a phone first: they're the ones you can call
    const byPhone = (xs: Lead[]) => [...xs].sort((a, b) => Number(!!b.phone) - Number(!!a.phone));
    let stopLogged = false;
    const stopNow = () => {
      if (!stopped()) return false;
      if (!stopLogged) log("Stopping: businesses already checked are kept; the rest are saved as not checked.", "warn");
      stopLogged = true;
      return true;
    };
    const finish = (l: Lead) => {
      Object.assign(l, score(l));
      l.pending = false;
      emit({ type: "lead", lead: l });
      emit({ type: "stage", stage: "enrich", done: ++checked, total: leads.length });
      progress.soon();
    };
    const checkOne = async (l: Lead) => {
      if (stopNow()) return;
      const before = l.saved ? { website: l.website, phone: l.phone, audit: l.audit } : undefined;
      try {
        await qualifyLead(l, { area: params.area, verify: params.verifyWebsites, search: siteSearch, numberSearch: siteSearch ? numberSearch : undefined, state, verifyEmail }, deps);
      } catch (e) {
        l.websiteCheck?.tried.push(`check failed: ${msg(e)}`);
      }
      l.checkedAt = (deps.now?.() ?? new Date()).toISOString();
      if (before) {
        const c = whatChanged(before, l);
        if (c.length) {
          l.changes = c;
          changed++;
        }
      }
      finish(l);
    };
    // shown one after another at a readable pace (about 20 seconds at most for the whole list)
    const pace = deps.revealMs ?? Math.max(150, Math.min(700, Math.round(20_000 / Math.max(1, ready.length))));
    await Promise.all([
      mapLimit(byPhone(toCheck), 8, checkOne),
      (async () => {
        for (const l of byPhone(ready)) {
          if (stopNow()) return;
          if (pace) await new Promise((r) => setTimeout(r, pace));
          finish(l);
        }
      })(),
    ]);
    // 3a. the Google Maps scraper finished after the others: add its new businesses and check them;
    // ones already in the list get its rating, reviews and owner (and its website, then a recheck)
    if (lateScraper && !stopped()) {
      if (!gmapsDone) log(`Checked the ${checked} businesses found so far. The Google Maps scraper is still searching…`);
      await untilScraperDone();
      if (gmapsDone && gmapsRaw.length && !stopped()) {
        const byKey = new Map<string, Lead>();
        for (const l of leads) for (const k of keysOf(l)) byKey.set(k, l);
        const added: Lead[] = [], again: Lead[] = [], gone = new Set<Lead>();
        let known = 0;
        for (const g of mergePlaces(gmapsRaw)) {
          const hit = keysOf(g).map((k) => byKey.get(k)).find(Boolean);
          if (hit) {
            known++;
            if (g.businessStatus === "CLOSED_PERMANENTLY") gone.add(hit);
            else {
              if (absorbLate(hit, g)) again.push(hit);
              Object.assign(hit, score(hit));
            }
            continue;
          }
          if (g.businessStatus === "CLOSED_PERMANENTLY") continue;
          g.websiteCheck = { via: g.website && !isSocialHost(domainOf(g.website)) ? "source" : "none_found", tried: [g.sources.map((x) => SOURCE_LABEL[x]).join(" + ")] };
          Object.assign(g, score(g));
          g.pending = true;
          added.push(g);
          for (const k of keysOf(g)) byKey.set(k, g);
        }
        leads = [...leads.filter((l) => !gone.has(l)), ...added];
        markChains();
        search.counts.found += gmapsRaw.length;
        search.counts.afterDedupe = leads.length;
        log(`Google Maps scraper added ${added.length} new business${added.length === 1 ? "" : "es"}${known ? `; ${known} were already in the list and got their Google rating and reviews` : ""}${gone.size ? ` (${gone.size} marked permanently closed, removed)` : ""}.`);
        emit({ type: "leads", leads });
        progress.soon();
        await mapLimit(byPhone([...added, ...again]), 8, checkOne);
      }
    }
    if (recheck) log(`Rechecked ${recheck} saved business${recheck === 1 ? "" : "es"} last checked over a week ago: ${changed ? `${changed} changed (marked in the list)` : "no changes"}.`);
    await progress.flush();
    const found = leads.filter((l) => l.websiteCheck?.via === "domain_guess" || l.websiteCheck?.via === "web_search").length;
    if (verifyStats.checked) log(`Mailbox check (your email verification service): ${verifyStats.checked} checked, ${verifyStats.valid} verified, ${verifyStats.invalid} don't exist (skipped for the next address), ${verifyStats.catchAll} accept any address.${verifyStats.skipped ? ` ${verifyStats.skipped} not checked (limit of ${deps.emailVerifyCap ?? 50} a search; EMAIL_VERIFY_MAX to change).` : ""}`);
    if (verifyStats.stopped) log(`Email check stopped: ${verifyStats.stopped}`, "warn");
    if (needSite) log(`Found and verified ${found} website${found === 1 ? "" : "s"} the map data didn't list.${state.searchBroken ? " Web search stopped partway (every search option failed). Set up SearXNG (free, see README) or a free Tavily key." : ""}`);
    const before = leads.length;
    leads = mergeBySocial(leads);
    if (leads.length < before) log(`${before - leads.length} Instagram/Facebook results were the same businesses as map results. Merged.`);

    // 3c. Instagram profiles via Meta's official API
    const withIg = leads.filter((l) => l.social?.instagram);
    if (withIg.length && deps.keys.metaToken && deps.keys.igUserId && !stopped()) {
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
              for (const m of currentCountry() === "IN" ? (p.bio ?? "").match(/(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}/g) ?? [] : phonesInText(p.bio ?? "", currentCountry())) {
                const ph = normalizePhone(m, currentCountry());
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
  const host = domainOf(l.audit.finalUrl ?? l.website);
  if (deps.domainAge && l.audit.status === "ok" && !l.audit.freeSubdomain && host && !isSocialHost(host)) {
    const since = await deps.domainAge(host).catch(() => undefined);
    if (since) l.audit = { ...l.audit, domainSince: since };
  }
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
    if (params.pageSpeed && withSite.length && !stopped()) {
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
    if (params.sources.apollo && deps.keys.apollo && !stopped()) {
      const targets = leads.filter((l) => l.website && !isSocialHost(domainOf(l.website)));
      await mapLimit(targets, 3, async (l) => {
        try {
          const o = await deps.apollo(deps.keys.apollo!, domainOf(l.website)!);
          if (o) {
            l.company = { employees: o.employees, linkedin: o.linkedin, foundedYear: o.foundedYear };
            const p = normalizePhone(o.phone, currentCountry());
            if (p && !l.phones.includes(p)) l.phones.push(p);
            if (!l.sources.includes("apollo")) l.sources.push("apollo");
          }
        } catch (e) {
          log(`Apollo: ${msg(e)}`, "warn");
        }
      });
    } else if (params.sources.apollo && !deps.keys.apollo) log("Apollo is on but no key is set. Skipping.", "warn");

    // 4. score (if stopped, businesses not checked keep their first rough score and go last)
    for (const l of leads) Object.assign(l, score(l));
    leads.sort((a, b) => Number(!!a.pending) - Number(!!b.pending) || b.score - a.score);
    const done_ = leads.filter((l) => !l.pending);
    search.counts.hot = done_.filter((l) => l.tier === "hot").length;
    search.counts.warm = done_.filter((l) => l.tier === "warm").length;
    search.counts.cold = done_.filter((l) => l.tier === "cold").length;
    emit({ type: "stage", stage: "score", done: 1, total: 1 });

    if (deps.cacheStats && deps.cacheStats.hits) log(`Reused ${deps.cacheStats.hits} saved check${deps.cacheStats.hits > 1 ? "s" : ""} from earlier searches (kept up to 7 days; LEAD_CACHE=off to turn off).`);

    // 5. save
    search.status = stopped() ? "stopped" : "done";
    if (stopped()) search.error = `Stopped by you after checking ${done_.length} of ${leads.length} businesses`;
    await deps.store.saveSearch(search);
    await deps.store.saveLeads(search.id, leads);
    // remember what this search found (a stopped search is incomplete, so it isn't saved)
    if (deps.directory && !stopped()) {
      const savedAt = (deps.now?.() ?? new Date()).toISOString();
      for (const c of cats) {
        const mine = leads.filter((l) => l.category === c.label && !l.pending);
        const sources = [...new Set([...(saved.get(c.key)?.sources ?? []), ...usedSources.filter((s) => !failedJobs.has(`${s}:${c.key}`))])];
        if (mine.length) await deps.directory.put({ city: params.city, area: params.area, category: c.key, savedAt, sources, leads: mine.map((l) => forDirectory(l)) }).catch((e) => log(`Couldn't save to the lead directory: ${msg(e)}`, "warn"));
      }
    }
    emit({ type: "stage", stage: "save", done: 1, total: 1 });
    if (stopped()) log(`Stopped: ${done_.length} of ${leads.length} businesses checked (${search.counts.hot} hot, ${search.counts.warm} warm, ${search.counts.cold} cold). Export CSV has all of them; the unchecked ones are marked.`, "warn");
    else log(`Done: ${search.counts.hot} hot, ${search.counts.warm} warm, ${search.counts.cold} cold.`);
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
  opts: { area?: string; verify: boolean; search?: (q: string) => Promise<SearchHit[]>; numberSearch?: (q: string) => Promise<SearchHit[]>; state?: { searchBroken: boolean }; verifyEmail?: (email: string) => Promise<MailboxCheck | undefined> },
  deps: Pick<Deps, "discover" | "audit" | "mx" | "domainAge">,
): Promise<void> {
  const state = opts.state ?? { searchBroken: false };
  l.websiteCheck ??= { via: l.website && !isSocialHost(domainOf(l.website)) ? "source" : "none_found", tried: [l.sources.map((x) => SOURCE_LABEL[x]).join(" + ")] };
  if (opts.verify && !l.chain && (!l.website || isSocialHost(domainOf(l.website)))) {
    const r = await deps.discover(l, opts.area, { search: state.searchBroken ? undefined : opts.search, numberSearch: opts.numberSearch });
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
  await checkEmails([l], deps.mx, opts.verifyEmail);
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

/**
 * Rank each lead's emails (owner's own first), drop junk matches, flag throwaway inboxes and, when
 * `mx` is given, domains that can't receive mail. With `verify`, the best address is checked with a
 * verification service; if its mailbox doesn't exist, the next best one is checked (at most 2 a lead).
 */
export async function checkEmails(leads: Lead[], mx?: typeof domainAcceptsMail, verify?: (email: string) => Promise<MailboxCheck | undefined>): Promise<void> {
  for (const l of leads) l.emails = l.emails.filter(looksLikeEmail);
  const domains = [...new Set(leads.flatMap((l) => l.emails.map((e) => e.split("@")[1]?.toLowerCase()).filter(Boolean) as string[]))];
  const ok = new Map<string, boolean | undefined>();
  if (mx) await mapLimit(domains, 10, async (d) => void ok.set(d, await mx(d)));
  for (const l of leads) {
    if (!l.emails.length) {
      l.email = undefined;
      l.emailInfo = undefined;
      continue;
    }
    const site = domainOf(l.audit?.finalUrl ?? l.website);
    const prev = new Map((l.emailInfo ?? []).map((i) => [i.email, i]));
    let infos = rankEmails(
      l.emails.map((email) => {
        const was = prev.get(email);
        return { email, kind: classifyEmail(email, site), deliverable: ok.get(email.split("@")[1]?.toLowerCase()), disposable: isDisposable(email) || undefined, mailbox: was?.mailbox, mailboxBy: was?.mailboxBy };
      }),
    );
    if (verify) {
      for (let tries = 0; tries < 2; tries++) {
        const next = infos.find((i) => usable(i) && !i.mailbox);
        if (!next || infos.some((i) => i.mailbox === "valid")) break;
        const r = await verify(next.email);
        if (!r) break;
        next.mailbox = r.status;
        next.mailboxBy = r.by;
        infos = rankEmails(infos);
        if (r.status !== "invalid") break;
      }
    }
    l.emailInfo = infos;
    l.email = usable(infos[0]) ? infos[0].email : undefined;
  }
}

/** Registration dates don't change: keep them 90 days (a registry that didn't answer, 3 days). */
function withDomainCache(fn: (host: string) => Promise<string | undefined>): (host: string) => Promise<string | null> {
  const f = async (host: string) => (await fn(host)) ?? null;
  if (cacheMode() === "off") return f;
  return cached("domain-age", f, (h: string) => registrableDomain(h) ?? h, (r) => (r ? 90 : 3) * DAY);
}

/** Mailbox checks cost credits: remember an answer for 30 days ("couldn't confirm" isn't kept). */
function withMailboxCache(v?: EmailVerifier): EmailVerifier | undefined {
  if (!v || cacheMode() === "off") return v;
  return cached("mailbox", v, (e: string) => e.trim().toLowerCase(), (r) => (r.status === "unknown" ? 0 : 30 * DAY));
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Checks worth remembering between searches (see lib/cache.ts). Website checks that failed are kept
 * only a day, since sites come back; web searches and verified finds a week.
 */
function withCache(stats: CacheStats) {
  const mode = cacheMode();
  if (mode === "off") return null;
  const search = (fn: (q: string) => Promise<SearchHit[]>) => cached("websearch", fn, (q: string) => countryKey(q.trim().toLowerCase()), (hits) => (hits.length ? 7 * DAY : 0), stats);
  if (mode === "search") return { search, audit: undefined, discover: undefined };
  const leadKey = (l: Lead, area?: string) => [simplifyName(l.name), l.phone ?? "", l.city ?? "", area ?? "", l.address ?? ""].join("|").toLowerCase();
  return {
    audit: cached("audit", auditWebsite, (w?: string) => countryKey((w ?? "").trim().toLowerCase()), (a: WebsiteAudit) => (a.status === "ok" || a.status === "social_only" ? 7 * DAY : a.status === "down" ? DAY : 0), stats),
    // discovery depends on whether web search was allowed, so that's part of the key
    discover: ((l, area, d) =>
      cached("discover", (_l: Lead) => discoverWebsite(l, area, d), () => countryKey(`${leadKey(l, area)}|${d?.search ? "search" : "guess"}${d?.numberSearch ? "+phone" : ""}`), (r) => (r.website ? 7 * DAY : r.tried.some((t) => /failed|captcha|No web search/i.test(t)) ? 0 : 3 * DAY), stats)(l)) as typeof discoverWebsite,
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
    makeNumberSearch: (onSwitch) => {
      const s = exactSearchChain(providersFromEnv(), onSwitch);
      return s && c ? c.search(s) : s;
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
    emailVerify: withMailboxCache(verifierFromEnv()),
    // DOMAIN_AGE=off skips the registration-date lookup
    domainAge: /^(off|0|false|no)$/i.test(process.env.DOMAIN_AGE || "") ? undefined : withDomainCache(domainRegisteredOn),
    emailVerifyCap: Math.max(0, Number(process.env.EMAIL_VERIFY_MAX) || 50),
    cacheStats,
    // LEAD_DIRECTORY=off: every search runs fully live and nothing is saved for later searches
    directory: /^(off|0|false|no)$/i.test(process.env.LEAD_DIRECTORY || "") ? undefined : localDirectory(),
    keys: {
      google: process.env.GOOGLE_PLACES_API_KEY || undefined,
      pageSpeed: process.env.PAGESPEED_API_KEY || undefined,
      apollo: process.env.APOLLO_API_KEY || undefined,
      brave: process.env.BRAVE_SEARCH_API_KEY || undefined,
      gmapsScraper: gmapsScraperUrl(),
      metaToken: process.env.META_ACCESS_TOKEN || undefined,
      igUserId: process.env.IG_BUSINESS_ACCOUNT_ID || undefined,
      fbPageSearch: /^(on|true|1|yes)$/i.test(process.env.FB_PAGE_SEARCH || ""),
      // Off unless asked: even through Serper (Google), 69 phone searches found 1 site in the Vadodara benchmark.
      phoneSearch: /^(on|true|1|yes)$/i.test(process.env.PHONE_SEARCH || "") ? "on" : /^auto$/i.test(process.env.PHONE_SEARCH || "") ? "auto" : "off",
    },
    store,
  };
}
