import type { Lead } from "../types";
import { domainOf, isSocialHost } from "../util";
import { registrableDomain } from "./domainAge";
import { classifyEmail, rankEmails, usable, type EmailInfo } from "./email";
import { parsePersonName, type PersonName } from "./names";
import type { MailboxCheck } from "./verifyEmail";

/**
 * The owner's own email address, worked out from their name and the business's domain, the way
 * Apollo ("extrapolated" emails) and Hunter (Email Finder) do it: most companies write every
 * address the same way (rahul@, rahul.shah@, rshah@…), so a known name plus the domain's pattern
 * gives a short list of likely addresses, which a mailbox check then confirms.
 *
 * Safe by design, because one bounce too many pauses a sending mailbox:
 *  - a guess only joins the lead's emails (and so can be emailed) once a mailbox check says it exists;
 *  - otherwise it's kept apart as `emailGuess`, shown as "likely, not confirmed", and never sent to;
 *  - only on the business's own domain (never Gmail and the like), and only when it receives mail;
 *  - at most `maxChecks` checks a lead (2), stopping at once on a domain that accepts any address.
 */

export type PatternKey = "first" | "first.last" | "firstlast" | "flast" | "f.last" | "firstl" | "last" | "first_last" | "drlast" | "drfirst";

/** How the pattern reads to a person (the address itself is shown next to it). */
export const PATTERN_LABEL: Record<PatternKey, string> = {
  first: "just the first name",
  "first.last": "first.last",
  firstlast: "first and last name together",
  flast: "first initial + last name",
  "f.last": "first initial.last name",
  firstl: "first name + last initial",
  last: "just the last name",
  first_last: "first_last",
  drlast: "dr + last name",
  drfirst: "dr + first name",
};

/**
 * Our starting guess for a small business owner's address, before the domain shows its own
 * pattern. Owners of small firms mostly take their first name; bigger teams use first.last or
 * an initial + last name; clinics often use dr<name>@. Rough shares, used only to order the list.
 */
const PRIOR: Record<PatternKey, number> = {
  first: 0.36, "first.last": 0.18, flast: 0.1, firstlast: 0.1, last: 0.05, "f.last": 0.04, firstl: 0.03, first_last: 0.02, drlast: 0.08, drfirst: 0.04,
};
/** How much more likely the pattern the domain already uses is than our starting guess. */
const DOMAIN_BOOST = 6;

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|rediffmail|outlook|hotmail|live|msn|icloud|me|aol|zoho|zohomail|proton|protonmail|gmx|yandex|mail)\.[a-z.]+$/i;

function localPart(p: PatternKey, n: PersonName): string | undefined {
  const { first: f, last: l } = n;
  switch (p) {
    case "first": return f;
    case "drfirst": return n.doctor ? `dr${f}` : undefined;
    case "drlast": return n.doctor && l ? `dr${l}` : undefined;
    case "first.last": return l && `${f}.${l}`;
    case "firstlast": return l && `${f}${l}`;
    case "flast": return l && `${f[0]}${l}`;
    case "f.last": return l && `${f[0]}.${l}`;
    case "firstl": return l && `${f}${l[0]}`;
    case "last": return l;
    case "first_last": return l && `${f}_${l}`;
  }
}

/**
 * The pattern a domain's addresses already follow, read from named addresses found on it
 * (priya.mehta@ → first.last). Single words (priya@) could be several patterns, so they don't count.
 */
export function domainPattern(emails: string[], domain: string): { pattern: PatternKey; example: string } | undefined {
  const seen = new Map<PatternKey, string[]>();
  for (const e of emails) {
    const [local, dom] = e.toLowerCase().split("@");
    if (dom !== domain || classifyEmail(e, domain) !== "own_named") continue;
    const p: PatternKey | undefined = /^dr\.?[a-z]{3,}$/.test(local)
      ? "drlast"
      : /^[a-z]\.[a-z]{2,}$/.test(local)
        ? "f.last"
        : /^[a-z]{2,}\.[a-z]{2,}$/.test(local)
          ? "first.last"
          : /^[a-z]{2,}_[a-z]{2,}$/.test(local)
            ? "first_last"
            : undefined;
    if (p) seen.set(p, [...(seen.get(p) ?? []), e]);
  }
  const best = [...seen.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  return best && { pattern: best[0], example: best[1][0] };
}

export interface Candidate {
  email: string;
  pattern: PatternKey;
  /** Why this address, in plain words. */
  basis: string;
}

/** Can we guess this lead's owner address, and if so, the likely ones in order. */
export function ownerEmailCandidates(l: Lead): { name: PersonName; domain: string; list: Candidate[] } | undefined {
  const name = parsePersonName(l.owner?.name ?? l.audit?.ownerName, l.name);
  const a = l.audit;
  if (!name || a?.status !== "ok" || a.freeSubdomain) return undefined;
  const host = domainOf(a.finalUrl ?? l.website);
  const domain = registrableDomain(host);
  if (!domain || isSocialHost(host) || FREE_MAIL.test(domain)) return undefined;
  const infos = l.emailInfo ?? [];
  // the domain is known not to receive mail
  if (infos.some((i) => i.email.toLowerCase().endsWith(`@${domain}`) && i.deliverable === false)) return undefined;
  // we already have the owner's own address (it carries their name)
  const theirs = (e: string) => {
    const local = e.toLowerCase().split("@")[0];
    return local.includes(name.first) || (!!name.last && name.last.length >= 3 && local.includes(name.last));
  };
  if (infos.some((i) => usable(i) && (i.kind === "own_named" || i.kind === "personal") && theirs(i.email))) return undefined;

  const known = domainPattern(l.emails, domain);
  const list = (Object.keys(PRIOR) as PatternKey[])
    .map((p) => ({ p, local: localPart(p, name), w: PRIOR[p] * (known?.pattern === p ? DOMAIN_BOOST : 1) }))
    .filter((x): x is { p: PatternKey; local: string; w: number } => !!x.local && /^[a-z][a-z._]{1,40}$/.test(x.local))
    .sort((x, y) => y.w - x.w);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const x of list) {
    const email = `${x.local}@${domain}`;
    if (seen.has(email) || infos.some((i) => i.email.toLowerCase() === email)) continue;
    seen.add(email);
    out.push({
      email,
      pattern: x.p,
      basis: known?.pattern === x.p ? `${name.display}'s name, written like this domain's other addresses (${known.example})` : `${name.display}'s name, written as ${PATTERN_LABEL[x.p]}, a common pattern for small businesses`,
    });
  }
  return out.length ? { name, domain, list: out } : undefined;
}

export type EmailGuess = NonNullable<Lead["emailGuess"]>;

/**
 * Work out the owner's address and, with `verify`, confirm it. A confirmed address joins the
 * lead's emails (owner's own address first); an unconfirmed one is left in `l.emailGuess`.
 */
export async function findOwnerEmail(
  l: Lead,
  opts: { verify?: (email: string) => Promise<MailboxCheck | undefined>; mx?: (domain: string) => Promise<boolean | undefined>; maxChecks?: number } = {},
): Promise<void> {
  l.emailGuess = undefined;
  const c = ownerEmailCandidates(l);
  if (!c) return;
  const mx = opts.mx ? await opts.mx(c.domain).catch(() => undefined) : undefined;
  if (mx === false) return;
  const tried: string[] = [];
  if (opts.verify) {
    for (const cand of c.list.slice(0, opts.maxChecks ?? 2)) {
      const r = await opts.verify(cand.email);
      if (!r) break; // no checks left this search: keep it as a guess
      if (r.status === "valid") {
        const info: EmailInfo = { email: cand.email, kind: classifyEmail(cand.email, c.domain), deliverable: true, mailbox: "valid", mailboxBy: r.by, source: "guessed", pattern: cand.pattern };
        if (!l.emails.includes(cand.email)) l.emails.push(cand.email);
        l.emailInfo = rankEmails([...(l.emailInfo ?? []), info]);
        if (usable(l.emailInfo[0])) l.email = l.emailInfo[0].email;
        return;
      }
      if (r.status === "catch_all") {
        // the domain says yes to every address: more checks can't tell them apart
        l.emailGuess = { ...cand, status: "catch_all", tried: tried.length ? tried : undefined };
        return;
      }
      if (r.status === "unknown") break;
      tried.push(cand.email); // doesn't exist: try the next pattern
    }
  }
  const next = c.list.find((x) => !tried.includes(x.email));
  if (next) l.emailGuess = { ...next, status: "unchecked", tried: tried.length ? tried : undefined };
}
