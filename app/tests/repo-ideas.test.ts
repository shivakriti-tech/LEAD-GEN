import { describe, expect, it } from "vitest";
import { aiTells, batchQuality, checkContent, citesRecordAsLeverage } from "@/lib/mail/guard";
import { replyProblem } from "@/lib/agent/agent";
import { patchFor } from "@/lib/agent/inbox";
import { enqueue } from "@/lib/mail/queue";
import { mergeFollowUp } from "@/lib/followups";
import { emailGuesses } from "@/lib/enrich/email";
import { checkEmails } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import { isLinkInBio, linkInBioIn, parseLinkInBio, readLinkInBio } from "@/lib/enrich/linkInBio";
import type { MailboxCheck } from "@/lib/enrich/verifyEmail";
import type { Lead } from "@/lib/types";

/** Ideas taken from the open-source repos the user shared (each file says which). */

describe("messages that read as typed by a person (oneshot-gtm's draft lint)", () => {
  it("names AI and template tells, and leaves a plain message alone", () => {
    expect(aiTells("Hi Rakesh, I hope this email finds you well. We leverage seamless solutions — happy to expand.")).toEqual(['"Hope this finds you well"', "a servile closer", "AI-sounding words", "em dashes (—)"]);
    expect(aiTells("Hi Rakesh, your site doesn't open on a phone. Want me to show you a version that does?")).toEqual([]);
  });

  it("warns on an edited text that reads like AI or uses soft spam phrases; still lets it go", () => {
    const c = checkContent("Your website", "Hi, just wanted to share a free consultation for your clinic. Reply if useful.");
    expect(c.block).toEqual([]);
    expect(c.warn.join(" ")).toMatch(/free consultation/);
    expect(c.warn.join(" ")).toMatch(/Reads like AI or a template: "Just wanted to"/);
  });

  it("blocks a message that uses a failed inspection or a lapsed licence as leverage", () => {
    expect(citesRecordAsLeverage("Saw that you failed your health inspection last month.")).toBe(true);
    expect(citesRecordAsLeverage("Your FSSAI licence has expired, we can help.")).toBe(true);
    expect(citesRecordAsLeverage("We help kitchens stay ready for their FSSAI audit.")).toBe(false);
    expect(checkContent("FSSAI", "Hi, your licence expired, we can renew it.").block[0]).toMatch(/lapsed licence/);
  });

  it("holds an agent draft that reads like AI for you to edit", () => {
    expect(replyProblem("Hi Priya,\n\nThanks for getting back to me. Would Thursday at 4 work for a short call?")).toBeUndefined();
    expect(replyProblem("Hi Priya,\n\nGreat to hear! We can elevate your brand with a seamless new store.")).toMatch(/Reads like AI/);
  });
});

describe("the owner's own email, guessed and verified (Scout, yc-outreach)", () => {
  it("builds likely addresses from a name, most likely first", () => {
    expect(emailGuesses("Dr. Mehul R. Shah", "www.aumdental.in")).toEqual(["mehul@aumdental.in", "mehul.shah@aumdental.in", "mshah@aumdental.in", "mehulshah@aumdental.in"]);
    expect(emailGuesses("Priya", "priyastudio.com")).toEqual(["priya@priyastudio.com"]);
    expect(emailGuesses("", "x.in")).toEqual([]);
  });

  const site = (over: Partial<Lead> = {}) => ({ id: "a", name: "Aum Dental", website: "https://aumdental.in", audit: emptyAudit("ok"), emails: ["info@aumdental.in"], phones: [], signals: [], sources: ["osm"], owner: { name: "Mehul Shah", via: "website" }, ...over }) as unknown as Lead;

  it("keeps a guess only when the mailbox check says it exists, and writes to it first", async () => {
    const asked: string[] = [];
    const v = async (e: string): Promise<MailboxCheck> => (asked.push(e), { status: e === "info@aumdental.in" || e === "mehul.shah@aumdental.in" ? "valid" : "invalid", by: "zerobounce" });
    const l = site();
    await checkEmails([l], async () => true, v);
    expect(asked).toEqual(["info@aumdental.in", "mehul@aumdental.in", "mehul.shah@aumdental.in"]);
    expect(l.email).toBe("mehul.shah@aumdental.in");
    expect(l.emailInfo![0]).toMatchObject({ email: "mehul.shah@aumdental.in", kind: "own_named", mailbox: "valid", guessed: true });
  });

  it("never guesses without a mailbox check, on a server that accepts anything, or when a person's address is known", async () => {
    const none = site();
    await checkEmails([none], async () => true);
    expect(none.emails).toEqual(["info@aumdental.in"]);
    const catchAll = site({ emails: [] });
    await checkEmails([catchAll], async () => true, async () => ({ status: "catch_all", by: "smtp" }));
    expect(catchAll.email).toBeUndefined();
    const asked: string[] = [];
    const known = site({ emails: ["mehul@aumdental.in"] });
    await checkEmails([known], async () => true, async (e) => (asked.push(e), { status: "valid", by: "zerobounce" }));
    expect(asked).toEqual(["mehul@aumdental.in"]);
    const social = site({ website: "https://instagram.com/aumdental", emails: [] });
    await checkEmails([social], async () => true, async () => ({ status: "valid", by: "zerobounce" }));
    expect(social.email).toBeUndefined();
  });
});

describe("positive reply rate (coldoutboundskills)", () => {
  it("records what a reply meant on the lead", () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const r = (intent: string) => patchFor({ intent, summary: "s" } as never, now)?.replyKind;
    expect([r("interested"), r("meeting"), r("question"), r("referral"), r("not_now"), r("not_interested"), r("wrong_person")]).toEqual(["positive", "positive", "positive", "positive", "not_now", "negative", undefined]);
    expect(mergeFollowUp({ status: "contacted", updatedAt: "" }, { replied: true, replyKind: "positive" }, now)).toMatchObject({ status: "replied", replyKind: "positive" });
  });
});

describe("a grade for each email batch before it goes (coldoutboundskills' list-quality-scorecard)", () => {
  it("grades verified, catch-all, shared inboxes and too many to one company", () => {
    const own = { kind: "own_named" as const, mailbox: "valid" as const };
    expect(batchQuality([{ email: "a@x.in", info: { email: "a@x.in", ...own } }, { email: "b@y.in", info: { email: "b@y.in", ...own } }])).toEqual({ grade: "A", score: 100, issues: [] });
    const q = batchQuality([
      { email: "info@x.in", info: { email: "info@x.in", kind: "own_generic" } },
      { email: "sales@x.in", info: { email: "sales@x.in", kind: "own_generic" } },
      { email: "hr@x.in", info: { email: "hr@x.in", kind: "own_generic" } },
      { email: "r@z.in", info: { email: "r@z.in", kind: "own_named", mailbox: "catch_all" } },
    ])!;
    expect(q.grade).toBe("F");
    expect(q.issues[0]).toMatch(/3 of 4 not checked at mailbox level/);
    expect(q.issues.join(" ")).toMatch(/accept any address/);
    expect(q.issues.join(" ")).toMatch(/1 company gets more than 2/);
    expect(batchQuality([])).toBeUndefined();
  });

  it("comes back with the queue result, with warnings for edited texts", () => {
    const lead = { id: "l1", name: "Aum Dental", category: "Dentist", city: "Vadodara", email: "mehul@aumdental.in", emailInfo: [{ email: "mehul@aumdental.in", kind: "own_named", mailbox: "valid" }], emails: ["mehul@aumdental.in"], phones: [], sources: ["osm"], signals: [], score: 70, tier: "hot", whyNow: "No website" } as unknown as Lead;
    const d = { items: [], suppressed: {}, mailboxes: {} } as never;
    const r = enqueue(d, { searchId: "s", leads: [lead], lang: "en", tone: "friendly", sender: { name: "Riya" }, followUps: true, texts: { l1: "Hi Mehul, just wanted to show you a new site for Aum Dental. Want to see it?" } }, new Date("2026-10-05T06:00:00Z"));
    expect(r.queued).toBe(1);
    expect(r.quality).toMatchObject({ grade: "A" });
    expect(r.warnings?.[0]).toMatchObject({ name: "Aum Dental", why: expect.stringMatching(/Just wanted to/) });
  });
});

describe("link-in-bio pages (Scout's Linktree reader)", () => {
  it("finds one in a bio", () => {
    expect(linkInBioIn(undefined, "Cakes to order 🎂 linktr.ee/sweetbakes_vdr")).toBe("https://linktr.ee/sweetbakes_vdr");
    expect(isLinkInBio("https://beacons.ai/x")).toBe(true);
    expect(isLinkInBio("https://sweetbakes.in")).toBe(false);
  });

  it("reads the website, WhatsApp and email from Linktree's page data, or from its links", async () => {
    const next = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { account: { links: [{ url: "https://instagram.com/sweetbakes" }, { url: "https://wa.me/919825012345" }, { url: "https://sweetbakes.in/menu" }, { url: "mailto:orders@sweetbakes.in?subject=Order" }] } } } })}</script>`;
    expect(parseLinkInBio(next)).toEqual({ website: "https://sweetbakes.in/menu", emails: ["orders@sweetbakes.in"], phones: ["919825012345"] });
    expect(parseLinkInBio(`<a href="https://www.zomato.com/x">Zomato</a><a href="tel:+91 98250 12345">Call</a>`)).toEqual({ emails: [], phones: ["919825012345"] });
    const f = (async () => new Response(next, { status: 200 })) as never;
    expect((await readLinkInBio("https://linktr.ee/sweetbakes", f))?.website).toBe("https://sweetbakes.in/menu");
  });
});

describe("a search reads the Linktree in an Instagram bio", () => {
  it("verifies the website it lists, and adds its email and WhatsApp", async () => {
    const { runSearch } = await import("@/lib/pipeline");
    const data = new Map<string, { search: import("@/lib/types").SearchRecord; leads: Lead[] }>();
    const store = {
      kind: "local" as const,
      async saveSearch(s: import("@/lib/types").SearchRecord) { data.set(s.id, { search: structuredClone(s), leads: data.get(s.id)?.leads ?? [] }); },
      async saveLeads(id: string, leads: Lead[]) { data.get(id)!.leads = leads; },
      async listSearches() { return [...data.values()].map((x) => x.search); },
      async getSearch(id: string) { return data.get(id) ?? null; },
      async updateFollowUps() { return []; },
      async deleteLeads() { return 0; },
    };
    const read: string[] = [];
    const { leads } = await runSearch(
      { sells: "website_development", categories: ["furniture"], city: "Vadodara", perCategory: 10, sources: { google: false, osm: false, apollo: false, instagram: true, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: true },
      {
        keys: { metaToken: "t", igUserId: "1784" }, store, now: () => new Date("2026-09-22"),
        webSearch: async () => [],
        google: async () => ({ places: [], requests: 0 }),
        geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
        osm: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [], fbSearch: async () => [],
        social: async ({ platform, category, city }) => platform === "instagram" ? [{ source: "instagram", sourceId: "sweetbakes_vdr", name: "sweet bakes", category, city, website: "https://www.instagram.com/sweetbakes_vdr/" }] : [],
        igLookup: async ({ handle }) => ({ handle, name: "Sweet Bakes", bio: "Custom cakes. Order: linktr.ee/sweetbakes_vdr", followers: 900 }),
        linkInBio: async (url) => (read.push(url), { website: "https://sweetbakes.in/", emails: ["orders@sweetbakes.in"], phones: ["919825012345"] }),
        checkCandidate: async (url) => ({ ok: url.includes("sweetbakes.in"), finalUrl: url, evidence: "business name and phone number are on the page" }),
        discover: async () => ({ tried: [] }),
        audit: async (w) => (w && w.includes("sweetbakes.in") ? { ...emptyAudit("ok"), https: true, mobileViewport: true } : w ? emptyAudit("social_only", { socials: { instagram: w } }) : emptyAudit("none")),
        pageSpeed: async () => { throw new Error("off"); }, apollo: async () => null,
      },
      () => {},
    );
    expect(read).toEqual(["https://linktr.ee/sweetbakes_vdr"]);
    expect(leads[0]).toMatchObject({ website: "https://sweetbakes.in/", email: "orders@sweetbakes.in", phone: "+919825012345" });
    expect(leads[0].websiteCheck?.tried.join(" | ")).toMatch(/link-in-bio page https:\/\/linktr\.ee\/sweetbakes_vdr: lists https:\/\/sweetbakes\.in\//);
  });
});
