import { promises as dns } from "node:dns";

/**
 * Is a sending domain set up so its email lands in the inbox? Checks the public DNS records that
 * Gmail and Outlook look at: MX (can receive replies), SPF (who may send for it), DKIM (signed mail)
 * and DMARC (what to do with fakes). Each missing one comes with what to do.
 */

export type Check = { ok: boolean; label: string; detail: string; fix?: string };
export interface DomainHealth {
  domain: string;
  checks: { mx: Check; spf: Check; dkim: Check; dmarc: Check };
  ok: boolean;
  /** The domain is the client's own website domain: better to send cold email from a separate one. */
  mainDomain?: boolean;
}

export interface Resolver {
  resolveMx(d: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolveTxt(d: string): Promise<string[][]>;
}
const sys: Resolver = { resolveMx: (d) => dns.resolveMx(d), resolveTxt: (d) => dns.resolveTxt(d) };

/** DKIM selectors used by the common providers (Google Workspace, Microsoft 365, Zoho, cPanel hosts…). */
export const DKIM_SELECTORS = ["google", "selector1", "selector2", "zmail", "zoho", "default", "dkim", "mail", "k1", "s1", "s2", "hostingermail1", "titan1"];

const within = <T,>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error("DNS timed out")), ms))]);
const txt = async (r: Resolver, name: string) => (await within(r.resolveTxt(name)).catch(() => [] as string[][])).map((parts) => parts.join(""));

export async function checkDomain(domain: string, opts: { resolver?: Resolver; mainDomains?: string[] } = {}): Promise<DomainHealth> {
  const r = opts.resolver ?? sys;
  const d = domain.toLowerCase();
  const mx = await within(r.resolveMx(d)).catch(() => []);
  const spfRec = (await txt(r, d)).find((t) => /^v=spf1\b/i.test(t));
  const dmarcRec = (await txt(r, `_dmarc.${d}`)).find((t) => /^v=DMARC1\b/i.test(t));
  let dkimSel: string | undefined;
  for (const sel of DKIM_SELECTORS) {
    const recs = await txt(r, `${sel}._domainkey.${d}`);
    if (recs.some((t) => /v=DKIM1|k=rsa|p=[A-Za-z0-9+/]/.test(t))) {
      dkimSel = sel;
      break;
    }
  }
  const dmarcPolicy = dmarcRec?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase();
  const checks = {
    mx: mx.length
      ? { ok: true, label: "Receives mail", detail: mx.sort((a, b) => a.priority - b.priority)[0].exchange }
      : { ok: false, label: "Receives mail", detail: "No MX record", fix: "Add the MX records your email provider gives you, or replies will bounce." },
    spf: spfRec
      ? { ok: !/[+?]all\b/.test(spfRec), label: "SPF", detail: spfRec, fix: /[+?]all\b/.test(spfRec) ? 'Your SPF ends in "+all" or "?all", which lets anyone send as you: change it to "~all".' : undefined }
      : { ok: false, label: "SPF", detail: "No SPF record", fix: `Add a TXT record on ${d}: the SPF line your provider gives (e.g. "v=spf1 include:_spf.google.com ~all").` },
    dkim: dkimSel
      ? { ok: true, label: "DKIM", detail: `Signed (selector "${dkimSel}")` }
      : { ok: false, label: "DKIM", detail: "Not found for the usual selectors", fix: "Turn on DKIM in your email provider's admin and add the TXT record it shows. (If your provider uses an unusual selector, this check can miss it.)" },
    dmarc: dmarcRec
      ? { ok: true, label: "DMARC", detail: `Policy: ${dmarcPolicy ?? "?"}` }
      : { ok: false, label: "DMARC", detail: "No DMARC record", fix: `Add a TXT record on _dmarc.${d}: "v=DMARC1; p=none; rua=mailto:dmarc@${d}" (start with p=none).` },
  };
  const mainDomain = !!opts.mainDomains?.some((m) => m.replace(/^www\./, "").toLowerCase() === d);
  return { domain: d, checks, ok: Object.values(checks).every((c) => c.ok), mainDomain: mainDomain || undefined };
}
