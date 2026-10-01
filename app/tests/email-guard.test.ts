import { describe, expect, it } from "vitest";
import { parseMailbox, type Mailbox } from "@/lib/mail/mailboxes";
import { applyInbox, enqueue, memoryQueueStore, tick, type LeadAccess, type SendDeps } from "@/lib/mail/queue";
import { bouncedAddress, checkContent, companyKey, isBlock, isBounceMail, isHardBounce, isUnsubscribeReply, pauseFor, recipientProblem } from "@/lib/mail/guard";
import { mergeFollowUp, type FollowUpPatch } from "@/lib/followups";
import type { Lead } from "@/lib/types";

const ist = (s: string) => new Date(`${s}+05:30`);
const MB = parseMailbox("MAILBOX_1", "smtps://divy%40getshree.in:app-pass@smtp.zoho.in:465?start=2026-09-01") as Mailbox;
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({ id, name: `Co ${id}`, category: "Dentist", city: "Vadodara", email: `dr@${id}.in`, emails: [], phones: [], sources: ["google"], signals: [], score: 70, tier: "hot", whyNow: "", ...over }) as Lead;
function world(leads: Lead[]) {
  const patches: FollowUpPatch[] = [];
  const access: LeadAccess = { get: async (_s, id) => leads.find((l) => l.id === id), patch: async (_s, id, p) => { patches.push(p); const l = leads.find((x) => x.id === id)!; l.followUp = mergeFollowUp(l.followUp, p); } };
  return { access, patches };
}
const base = (leads: Lead[], over: Partial<SendDeps> = {}) => {
  const store = memoryQueueStore();
  enqueue(store.data, { searchId: "s", leads, lang: "en", tone: "friendly", sender: { name: "Divy" }, followUps: false }, ist("2026-10-05T09:00:00"));
  let n = 0;
  const deps: SendDeps = { store, leads: world(leads).access, mailboxes: [MB], send: async () => ({ messageId: `<${++n}@x>` }), now: () => ist("2026-10-05T10:05:00"), rand: () => 0, ...over };
  return { store, deps };
};

describe("who may get a cold email", () => {
  it("skips system addresses, throwaways, dead domains, invalid mailboxes and suppressed addresses", () => {
    expect(recipientProblem("abuse@acme.com")).toMatch(/system or department/);
    expect(recipientProblem("noreply@acme.com")).toMatch(/system/);
    expect(recipientProblem("info@acme.com")).toBeUndefined();
    expect(recipientProblem("x@acme.com", { email: "x@acme.com", kind: "personal", disposable: true } as never)).toBe("A throwaway address");
    expect(recipientProblem("x@acme.com", { email: "x@acme.com", kind: "personal", deliverable: false } as never)).toMatch(/can't receive/);
    expect(recipientProblem("x@acme.com", { email: "x@acme.com", kind: "personal", mailbox: "invalid" } as never)).toMatch(/doesn't exist/);
    expect(recipientProblem("X@acme.com", undefined, { "x@acme.com": { at: "", why: "bounced" } })).toBe("This address bounced before");
    expect(recipientProblem("not-an-email")).toBe("Not a valid email address");
  });
  it("counts a company by its domain, a free-mail user by the address", () => {
    expect(companyKey("Jane@Acme.com")).toBe("acme.com");
    expect(companyKey("jane@gmail.com")).toBe("jane@gmail.com");
  });
});

describe("spam check on the text", () => {
  it("blocks shorteners, many links, spam phrases, HTML and capitals; warns on long emails", () => {
    expect(checkContent("Quick idea", "Hi Jane, saw your store. mysite.com").block).toEqual([]);
    expect(checkContent("Quick idea", "See bit.ly/abc").block[0]).toMatch(/shortener/);
    expect(checkContent("Quick idea", "a.com b.com c.com").block[0]).toMatch(/3 links/);
    expect(checkContent("Quick idea", "This is 100% free, act now").block[0]).toMatch(/reads as spam/);
    expect(checkContent("FREE WEBSITE AUDIT", "hi").block).toContain("Subject in capitals");
    expect(checkContent("Hi", "<img src=x>").block[0]).toMatch(/HTML/);
    expect(checkContent("Hi", "word ".repeat(260)).warn[0]).toMatch(/260 words/);
  });
  it("our own generated messages pass", async () => {
    const { firstMessage, followUpMessage, subjectLine } = await import("@/lib/outreach");
    const l = lead("a", { audit: { status: "none", emails: [], phones: [], socials: {} }, reviews: 40, rating: 4.6 });
    for (const tone of ["friendly", "short"] as const) expect(checkContent(subjectLine(l), firstMessage(l, "en", { name: "Divy", link: "pixelcraft.in" }, tone)).block).toEqual([]);
    expect(checkContent("Re: x", followUpMessage(l, "en", { name: "Divy" })).block).toEqual([]);
  });
  it("won't queue your own text if it reads as spam", () => {
    const store = memoryQueueStore();
    const r = enqueue(store.data, { searchId: "s", leads: [lead("a")], lang: "en", tone: "friendly", sender: {}, followUps: false, texts: { a: "Guaranteed results! Click here: bit.ly/x" } });
    expect(r.skipped[0].why).toMatch(/^Spam check:/);
  });
});

describe("sending safely", () => {
  it("at most 2 emails a day to one company, the rest wait for tomorrow", async () => {
    const leads = ["a", "b", "c"].map((id) => lead(id, { email: `${id}@acme.com` }));
    let t = ist("2026-10-05T10:05:00").getTime();
    const { store, deps } = base(leads, { now: () => new Date(t) });
    const did: string[] = [];
    for (let i = 0; i < 4; i++, t += 10 * 60_000) did.push((await tick(deps)).did);
    expect(did.filter((x) => x === "sent")).toHaveLength(2);
    expect(store.data.items.filter((i) => i.status === "queued")).toHaveLength(1);
    t = ist("2026-10-06T10:05:00").getTime();
    expect((await tick(deps)).did).toBe("sent");
  });
  it("a refused send pauses the mailbox for a day and keeps the email; a hard bounce suppresses the address", async () => {
    const { store, deps } = base([lead("a"), lead("b")], { send: async () => { throw new Error("554 5.7.1 Message rejected as spam"); } });
    expect(await tick(deps)).toMatchObject({ did: "failed", detail: "divy@getshree.in: refused by the mail server (paused 24h)" });
    expect(store.data.mailboxes[MB.email].pausedUntil).toBeTruthy();
    expect(store.data.items.filter((i) => i.status === "queued")).toHaveLength(2);
    expect((await tick({ ...deps, now: () => ist("2026-10-05T12:00:00") })).did).toBe("idle");

    const b = base([lead("x")], { send: async () => { throw new Error("550 5.1.1 <dr@x.in>: Recipient address rejected: User unknown"); } });
    await tick(b.deps);
    expect(b.store.data.suppressed?.["dr@x.in"]?.why).toBe("bounced");
    expect(b.store.data.items[0]).toMatchObject({ status: "failed" });
    expect(enqueue(b.store.data, { searchId: "s2", leads: [lead("x")], lang: "en", tone: "friendly", sender: {}, followUps: false }).skipped[0].why).toBe("This address bounced before");
  });
  it("won't send from a domain missing SPF or DMARC", async () => {
    const { store, deps } = base([lead("a")], { domainProblem: async () => "getshree.in is missing DMARC" });
    expect(await tick(deps)).toMatchObject({ did: "idle", detail: "divy@getshree.in paused: getshree.in is missing DMARC" });
    expect(store.data.items[0].status).toBe("queued");
  });
});

describe("reading the inbox", () => {
  it("recognises bounces, blocks, complaints and unsubscribe replies", () => {
    expect(isHardBounce("550 5.1.1 user unknown")).toBe(true);
    expect(isHardBounce("550 5.7.1 blocked for spam")).toBe(false);
    expect(isBlock("421 4.7.0 Try again later, rate limit")).toBe(true);
    expect(isBounceMail("MAILER-DAEMON@mx.google.com", "Delivery Status Notification (Failure)")).toBe(true);
    expect(bouncedAddress("Reporting-MTA: dns; mx\nFinal-Recipient: rfc822; jane@acme.com\nAction: failed")).toBe("jane@acme.com");
    expect(bouncedAddress("Your message to <bob@acme.com> couldn't be delivered. bob wasn't found")).toBe("bob@acme.com");
    expect(isUnsubscribeReply("Re: A quick idea", "Unsubscribe me please")).toBe(true);
    expect(isUnsubscribeReply("Re: A quick idea", "Sounds good, call me Tuesday")).toBe(false);
  });
  it("suppresses bounced and unsubscribed addresses, cancels their follow-ups, and pauses on too many bounces", async () => {
    const leads = ["a", "b", "c", "d"].map((id) => lead(id));
    const { store, deps } = base(leads, { now: () => ist("2026-10-05T10:05:00") });
    for (const it of store.data.items) Object.assign(it, { status: "sent", sentAt: ist("2026-10-05T10:00:00").toISOString() });
    store.data.items.push({ ...store.data.items[0], id: "f", step: 1, status: "queued", sentAt: undefined });
    const out = applyInbox(store.data, MB.email, [{ kind: "unsubscribe", address: "dr@a.in" }, { kind: "bounce", address: "dr@b.in" }, { kind: "bounce", address: "dr@c.in" }, { kind: "bounce", address: "dr@d.in" }, { kind: "bounce", address: "someone@else.com" }], ist("2026-10-05T12:00:00"));
    expect(out).toEqual([{ searchId: "s", leadId: "a", why: "Email: asked to unsubscribe" }]);
    expect(Object.keys(store.data.suppressed!)).toEqual(["dr@a.in", "dr@b.in", "dr@c.in", "dr@d.in"]);
    expect(store.data.items.find((i) => i.id === "f")).toMatchObject({ status: "cancelled", reason: "Asked not to be emailed" });
    expect(store.data.mailboxes[MB.email].pauseReason).toMatch(/3 bounces today/);
    void deps;
  });
  it("pause rules: complaints, bounces in a day, weekly bounce rate", () => {
    expect(pauseFor({ sent7: 100, bounced7: 2, bouncedToday: 1, complaints7: 0 })).toBeUndefined();
    expect(pauseFor({ sent7: 100, bounced7: 4, bouncedToday: 1, complaints7: 0 })!.hours).toBe(48);
    expect(pauseFor({ sent7: 10, bounced7: 1, bouncedToday: 1, complaints7: 1 })!.hours).toBe(72);
  });
});
