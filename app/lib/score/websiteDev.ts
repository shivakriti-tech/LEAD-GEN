import type { Lead, Signal, Tier } from "../types";

/**
 * Opportunity score for clients who sell website development.
 * Higher = the business visibly needs a new or better website AND is worth pitching.
 */
export function scoreWebsiteDev(lead: Lead, now = new Date()): { signals: Signal[]; score: number; tier: Tier; whyNow: string } {
  const a = lead.audit;
  const s: Signal[] = [];
  const add = (key: string, label: string, points: number) => s.push({ key, label, points });

  if (!a || a.status === "none") add("no_website", "No website", 55);
  else if (a.status === "social_only") add("social_only", `Uses ${socialName(a)} as its website`, 50);
  else if (a.status === "down") add("site_down", a.error ? `Website not working (${a.error})` : "Website not working", 50);
  else {
    if (a.freeSubdomain) add("free_builder", `Free builder site (${a.builder})`, 20);
    if (a.mobileViewport === false) add("not_mobile", "Not mobile-friendly", 25);
    if (a.pageSpeed) {
      if (a.pageSpeed.score < 30) add("very_slow", `Very slow on mobile (${a.pageSpeed.score}/100)`, 20);
      else if (a.pageSpeed.score < 50) add("slow", `Slow on mobile (${a.pageSpeed.score}/100)`, 15);
    }
    if (a.https === false) add("no_https", "No HTTPS (browser shows 'Not secure')", 10);
    const stale = !!a.copyrightYear && now.getFullYear() - a.copyrightYear >= 3;
    if (stale) add("stale", `Not updated since ${a.copyrightYear}`, 10);
    // An agency built it and nobody has touched it since: the relationship has likely lapsed.
    if (a.designedBy) add(stale ? "agency_lapsed" : "agency", `Built by ${a.designedBy}${stale ? ", not maintained" : ""}`, stale ? 5 : 0);
  }
  const since = a?.foundedYear;
  if (since && now.getFullYear() - since >= 5) add("established", `Running since ${since}`, 5);

  const ig = lead.social?.instagram;
  const noWorkingSite = !a || a.status !== "ok";
  if (ig?.checked === "api" && ig.followers != null && noWorkingSite) {
    const days = ig.lastPostAt ? Math.floor((now.getTime() - new Date(ig.lastPostAt).getTime()) / 86_400_000) : undefined;
    if (ig.followers >= 300 && days != null && days <= 45) add("ig_active", `Active on Instagram: ${ig.followers.toLocaleString("en-IN")} followers, posted ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`, 10);
    else if (days != null && days > 120) add("ig_quiet", `Instagram quiet for ${days} days`, 0);
  }
  if (lead.chain) add("chain", `Chain or franchise (${lead.chain.reason})`, -45);
  if ((lead.reviews ?? 0) >= 50 && (lead.rating ?? 0) >= 4) add("busy", `Busy business: ${lead.reviews} reviews, ${lead.rating?.toFixed(1)}★`, 10);
  if (lead.phone || lead.phones.length || a?.whatsapp) add("has_phone", "Has a phone number", 5);
  const best = lead.emailInfo?.[0];
  if (best) {
    if (best.deliverable !== false) add("has_email", best.kind === "own_named" || best.kind === "personal" ? "Has a personal email" : "Has an email", 5);
  } else if (lead.email || lead.emails.length || a?.emails.length) add("has_email", "Has an email", 5);
  const owner = lead.owner?.name ?? a?.ownerName;
  if (owner) add("owner_known", `Owner: ${owner}`, 5);

  const score = Math.max(0, Math.min(100, s.reduce((t, x) => t + x.points, 0)));
  const tier: Tier = score >= 65 ? "hot" : score >= 40 ? "warm" : "cold";
  return { signals: s, score, tier, whyNow: whyNow(lead, s) };
}

function socialName(a: NonNullable<Lead["audit"]>): string {
  const k = Object.keys(a.socials)[0] ?? "a social page";
  return ({ instagram: "Instagram", facebook: "Facebook", linktr: "Linktree", justdial: "Justdial" } as Record<string, string>)[k] ?? k;
}

/** One plain sentence the outreach module can open with. */
function whyNow(lead: Lead, s: Signal[]): string {
  const has = (k: string) => s.find((x) => x.key === k);
  if (has("chain")) return `${lead.name} looks like part of a chain (${lead.chain!.reason}). Its website is decided by head office, so it's a poor fit for a local website pitch.`;
  const igActive = has("ig_active");
  if (igActive && (has("no_website") || has("social_only") || has("site_down"))) {
    const f = lead.social!.instagram!.followers!.toLocaleString("en-IN");
    return has("site_down")
      ? `${lead.name} has ${f} Instagram followers, but its website isn't loading, so followers who click through hit a dead end.`
      : `${lead.name} has ${f} Instagram followers and posts regularly, but has no website to send them to for bookings or orders.`;
  }
  const busy = has("busy");
  const crowd = busy ? ` even though ${lead.reviews} people have reviewed them on Google` : "";
  if (has("no_website")) return `${lead.name} has no website${crowd}, so people searching for a ${lead.category.toLowerCase()} nearby can't check them out before calling.`;
  if (has("social_only")) return `${lead.name} sends customers to ${has("social_only")!.label.replace(/^Uses | as its website$/g, "")} instead of a website${crowd}.`;
  if (has("site_down")) return `${lead.name}'s website isn't loading right now, so anyone who clicks it from Google hits a dead end.`;
  const issues = s.filter((x) => ["not_mobile", "very_slow", "slow", "no_https", "free_builder", "stale"].includes(x.key)).map((x) => x.label.toLowerCase());
  if (issues.length) return `${lead.name}'s website has problems a customer notices: ${issues.slice(0, 3).join(", ")}.`;
  return `${lead.name}'s website looks fine. Low priority for a website pitch.`;
}
