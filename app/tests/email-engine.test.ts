import { describe, expect, it } from "vitest";
import { dailyCap, inSendWindow, mailboxesFromEnv, parseMailbox, type Mailbox } from "@/lib/mail/mailboxes";
import { checkDomain, type Resolver } from "@/lib/mail/dnsHealth";
import { enqueue, memoryQueueStore, tick, type LeadAccess, type SendDeps } from "@/lib/mail/queue";
import { mergeFollowUp, type FollowUpPatch } from "@/lib/followups";
import type { Lead } from "@/lib/types";

const ist = (s: string) => new Date(`${s}+05:30`);
const MB = parseMailbox("MAILBOX_1", "smtps://divy%40getshree.in:app-pass@smtp.zoho.in:465?name=Divy%20Shah&start=2026-10-01") as Mailbox;

describe("mailboxes", () => {
  it("reads MAILBOX_n from .env.local and explains a bad one", () => {
    expect(MB).toMatchObject({ email: "divy@getshree.in", domain: "getshree.in", name: "Divy Shah", start: "2026-10-01", max: 40, smtp: { host: "smtp.zoho.in", port: 465, secure: true, pass: "app-pass" }, imap: { host: "imap.zoho.in", port: 993 } });
    const r = mailboxesFromEnv({ MAILBOX_1: "smtp://a%40b.in:pw@smtp.gmail.com:587", MAILBOX_2: "https://nope", MAILBOX_3: "smtp://nopassword@x.in" });
    expect(r.mailboxes.map((m) => [m.email, m.smtp.secure, m.imap?.host])).toEqual([["a@b.in", false, "imap.gmail.com"]]);
    expect(r.problems.map((p) => p.key)).toEqual(["MAILBOX_2", "MAILBOX_3"]);
  });

  it("warms up: 5 a day, +3 a day, up to the maximum", () => {
    expect([0, 1, 5, 20].map((n) => dailyCap(MB, "2026-10-01", `2026-10-${String(1 + n).padStart(2, "0")}`))).toEqual([5, 8, 20, 40]);
  });

  it("sends only Mon–Sat, 10:00–18:30 in India", () => {
    expect(inSendWindow(ist("2026-10-05T10:30:00"))).toBe(true); // Monday
    expect(inSendWindow(ist("2026-10-05T09:59:00"))).toBe(false);
    expect(inSendWindow(ist("2026-10-05T18:31:00"))).toBe(false);
    expect(inSendWindow(ist("2026-10-04T12:00:00"))).toBe(false); // Sunday
  });
});

describe("sending domain health", () => {
  it("checks MX, SPF, DKIM and DMARC and says what to fix", async () => {
    const rec: Record<string, string[][]> = { "getshree.in": [["v=spf1 include:zoho.in ~all"]], "zmail._domainkey.getshree.in": [["v=DKIM1; k=rsa; p=MIGf"]] };
    const r: Resolver = { resolveMx: async (d) => (d === "getshree.in" ? [{ exchange: "mx.zoho.in", priority: 10 }] : []), resolveTxt: async (d) => rec[d] ?? Promise.reject(new Error("ENODATA")) };
    const h = await checkDomain("getshree.in", { resolver: r, mainDomains: ["shreelogistics.in"] });
    expect([h.checks.mx.ok, h.checks.spf.ok, h.checks.dkim.ok, h.checks.dmarc.ok]).toEqual([true, true, true, false]);
    expect(h.checks.dkim.detail).toBe('Signed (selector "zmail")');
    expect(h.checks.dmarc.fix).toMatch(/_dmarc\.getshree\.in: "v=DMARC1; p=none/);
    expect(h.ok).toBe(false);
    expect((await checkDomain("www.shreelogistics.in".replace("www.", ""), { resolver: r, mainDomains: ["www.shreelogistics.in"] })).mainDomain).toBe(true);
  });
});

function world(leads: Lead[]) {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const patches: FollowUpPatch[] = [];
  const access: LeadAccess = {
    get: async (_s, id) => byId.get(id),
    patch: async (_s, id, p) => {
      patches.push(p);
      const l = byId.get(id)!;
      l.followUp = mergeFollowUp(l.followUp, p);
    },
  };
  return { access, patches };
}
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({ id, name: `Clinic ${id}`, category: "Dentist", city: "Vadodara", email: `${id}@clinic.in`, emails: [`${id}@clinic.in`], phones: [], sources: ["google"], signals: [], score: 70, tier: "hot", whyNow: "", ...over }) as Lead;

describe("the email queue", () => {
  it("queues next emails and says why others can't be", () => {
    const store = memoryQueueStore();
    const r = enqueue(store.data, { searchId: "s", leads: [lead("a"), lead("b", { email: undefined }), lead("c", { followUp: { status: "new", updatedAt: "", optedOut: { at: "", via: "reply" } } })], lang: "en", tone: "friendly", sender: { name: "Divy", company: "Pixel Craft" }, followUps: true }, ist("2026-10-05T09:00:00"));
    expect(r.queued).toBe(1);
    expect(r.skipped.map((x) => x.why)).toEqual(["No email address", "Asked not to be contacted (reply)"]);
    expect(enqueue(store.data, { searchId: "s", leads: [lead("a")], lang: "en", tone: "friendly", sender: {}, followUps: true }).skipped[0].why).toBe("Already in the queue");
  });

  it("sends in hours with a footer, logs it on the lead, and schedules the follow-up in the same thread", async () => {
    const l = lead("a");
    const { access, patches } = world([l]);
    const store = memoryQueueStore();
    enqueue(store.data, { searchId: "s", leads: [l], lang: "en", tone: "friendly", sender: { name: "Divy", company: "Pixel Craft" }, followUps: true }, ist("2026-10-05T09:00:00"));
    const sent: Array<Parameters<SendDeps["send"]>[1]> = [];
    const deps: SendDeps = { store, leads: access, mailboxes: [MB], send: async (_m, mail) => (sent.push(mail), { messageId: `<m${sent.length}@getshree.in>` }), now: () => ist("2026-10-05T09:30:00"), rand: () => 0.5 };
    expect((await tick(deps)).did).toBe("idle"); // before 10:00
    deps.now = () => ist("2026-10-05T10:05:00");
    expect(await tick(deps)).toMatchObject({ did: "sent", detail: "Clinic a (a@clinic.in) from divy@getshree.in" });
    expect(sent[0]).toMatchObject({ from: '"Divy, Pixel Craft" <divy@getshree.in>', to: "a@clinic.in", subject: "Clinic a website" });
    expect(sent[0]).not.toHaveProperty("listUnsubscribe");
    expect(sent[0].text).toMatch(/\n\nDivy\nPixel Craft\n\nIf this isn't relevant, just reply "no" and I won't email again\.$/);
    expect(sent[0].text).not.toMatch(/https?:|www\.|--/);
    expect(sent[0].html).toMatch(/^<div dir="ltr">Hi there,/);
    expect(patches[0]).toMatchObject({ touch: { channel: "email", messageId: "<m1@getshree.in>" }, followUpOn: "2026-10-08" });
    expect(l.followUp?.status).toBe("contacted");
    const next = store.data.items.find((i) => i.status === "queued")!;
    expect(next).toMatchObject({ step: 1, mailbox: "divy@getshree.in", inReplyTo: "<m1@getshree.in>", references: ["<m1@getshree.in>"] });
    expect(next.notBefore.slice(0, 10)).toBe("2026-10-08");
    // three days later: the follow-up goes as a reply in the thread
    deps.now = () => ist("2026-10-08T13:00:00");
    expect((await tick(deps)).did).toBe("sent");
    expect(sent[1]).toMatchObject({ subject: "Re: Clinic a website", inReplyTo: "<m1@getshree.in>" });
    expect(sent[1].text).toMatch(/^Hi there, just following up/);
  });

  it("skips a follow-up when they replied (seen in the inbox), and marks the lead Replied", async () => {
    const l = lead("a");
    const { access } = world([l]);
    const store = memoryQueueStore();
    enqueue(store.data, { searchId: "s", leads: [l], lang: "en", tone: "friendly", sender: { name: "Divy" }, followUps: true }, ist("2026-10-05T09:00:00"));
    const deps: SendDeps = { store, leads: access, mailboxes: [MB], send: async () => ({ messageId: "<m1@x>" }), replied: async () => true, now: () => ist("2026-10-05T10:05:00"), rand: () => 0 };
    await tick(deps);
    deps.now = () => ist("2026-10-09T11:00:00");
    expect(await tick(deps)).toMatchObject({ did: "skipped", detail: "They replied (found in your inbox), so no follow-up" });
    expect(l.followUp?.status).toBe("replied");
  });

  it("respects the warm-up limit and spacing, and pauses a mailbox whose password is wrong", async () => {
    const leads = Array.from({ length: 7 }, (_, i) => lead(`l${i}`, { email: `dr@clinic${i}.in` }));
    const { access } = world(leads);
    const store = memoryQueueStore();
    enqueue(store.data, { searchId: "s", leads, lang: "en", tone: "friendly", sender: {}, followUps: false }, ist("2026-10-01T09:00:00"));
    let t = ist("2026-10-01T10:00:00").getTime();
    const deps: SendDeps = { store, leads: access, mailboxes: [MB], send: async () => ({ messageId: `<${t}@x>` }), now: () => new Date(t), rand: () => 0 };
    const results: string[] = [];
    for (let i = 0; i < 12; i++, t += 3 * 60_000) results.push((await tick(deps)).did);
    expect(results.filter((r) => r === "sent")).toHaveLength(5); // day one: 5
    expect(await tick({ ...deps, now: () => new Date(t - 60_000) })).toMatchObject({ did: "idle", detail: "Waiting for a mailbox with room (daily warm-up limit or spacing)" });
    const bad = await tick({ ...deps, now: () => ist("2026-10-02T10:00:00"), send: async () => { throw new Error("535 Authentication failed"); } });
    expect(bad).toMatchObject({ did: "failed", detail: "divy@getshree.in: sign-in failed (paused)" });
    expect(store.data.mailboxes["divy@getshree.in"].error).toMatch(/Sign-in failed/);
    expect(store.data.items.filter((i) => i.status === "queued")).toHaveLength(2); // still waiting, not lost
  });

  it("emails a US lead only with your postal address, in their office hours, with the address in the footer", async () => {
    const l = lead("tx", { country: "US", lng: -95.37 });
    const { access } = world([l]);
    const store = memoryQueueStore();
    expect(enqueue(store.data, { searchId: "s", leads: [l], lang: "en", tone: "friendly", sender: { name: "Divy" }, followUps: false }).skipped[0].why).toMatch(/postal address/);
    enqueue(store.data, { searchId: "s", leads: [l], lang: "en", tone: "friendly", sender: { name: "Divy", company: "Shivakriti", address: "4th floor, Alkapuri Arcade, Vadodara 390007, India" }, followUps: false }, new Date("2026-10-05T00:00:00Z"));
    const sent: string[] = [];
    const deps: SendDeps = { store, leads: access, mailboxes: [MB], send: async (_m, mail) => (sent.push(mail.text), { messageId: "<u1@x>" }), rand: () => 0 };
    // Monday 11:00 in India is 00:30 in Houston: waits
    expect(await tick({ ...deps, now: () => ist("2026-10-05T11:00:00") })).toMatchObject({ did: "idle", detail: "Waiting for office hours where the leads are" });
    // Monday 10:00 in Houston (20:30 in India): goes
    expect((await tick({ ...deps, now: () => new Date("2026-10-05T15:00:00Z") })).did).toBe("sent");
    expect(sent[0]).toMatch(/Divy\nShivakriti\n4th floor, Alkapuri Arcade, Vadodara 390007, India\n/);
  });
});
