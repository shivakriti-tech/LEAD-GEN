import { describe, expect, it } from "vitest";
import { ownerFromText, parsePersonName } from "@/lib/enrich/names";
import { domainPattern, findOwnerEmail, ownerEmailCandidates } from "@/lib/enrich/emailFinder";
import { emailScore } from "@/lib/enrich/email";
import { emptyAudit, parsePage } from "@/lib/enrich/crawl";
import { contactConfidence } from "@/lib/confidence";
import { qualifyLead } from "@/lib/pipeline";
import type { EmailVerifier } from "@/lib/enrich/verifyEmail";
import type { Lead } from "@/lib/types";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", name: "Shree Furniture", category: "Furniture shop", phones: [], emails: [], sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "",
  website: "https://www.shreefurniture.in", owner: { name: "Rahul Shah", via: "google_maps" },
  audit: { ...emptyAudit("ok"), finalUrl: "https://www.shreefurniture.in/" },
  ...over,
});

describe("people's names", () => {
  it("reads names with titles, initials and degrees", () => {
    expect(parsePersonName("Dr. Mehul Shah")).toEqual({ display: "Dr. Mehul Shah", first: "mehul", last: "shah", doctor: true });
    expect(parsePersonName("Rahul K. Shah, MDS")).toMatchObject({ display: "Rahul Shah", first: "rahul", last: "shah" });
    expect(parsePersonName("Mr. Ramesh Patel")).toMatchObject({ display: "Ramesh Patel", doctor: false });
    expect(parsePersonName("José García")).toMatchObject({ first: "jose", last: "garcia" });
    expect(parsePersonName("Kunal")).toMatchObject({ first: "kunal", last: undefined });
  });

  it("rejects the business itself, roles and junk", () => {
    expect(parsePersonName("Aum Dental Care")).toBeUndefined();
    expect(parsePersonName("Shree Furniture")).toBeUndefined();
    expect(parsePersonName("Owner")).toBeUndefined();
    expect(parsePersonName("AB")).toBeUndefined();
    expect(parsePersonName("rahul@shree.in")).toBeUndefined();
    expect(parsePersonName("Studio 21")).toBeUndefined();
    // Google Maps often lists the business as its own owner
    expect(parsePersonName("Mehta", "Mehta Opticals")).toBeUndefined();
    expect(parsePersonName("Rajesh Mehta", "Mehta Opticals")).toMatchObject({ first: "rajesh", last: "mehta" });
  });

  it("finds the owner next to a role word, or the one doctor on a clinic's site", () => {
    expect(ownerFromText("Welcome! Meet Rahul Shah, Founder of Shree Furniture since 2009.")).toBe("Rahul Shah");
    expect(ownerFromText("Founder & CEO: Jane Doe Our Team is here to help")).toBe("Jane Doe");
    expect(ownerFromText("Proprietor - Mr. Ramesh Patel. Call us today")).toBe("Ramesh Patel");
    expect(ownerFromText("Dr. Anjali Mehta Dental Clinic. About Dr. Anjali Mehta, BDS, MDS: 15 years of practice.")).toBe("Dr. Anjali Mehta");
  });

  it("stays quiet when the page doesn't say clearly", () => {
    expect(ownerFromText("Our doctors: Dr. Anjali Mehta and Dr. Vikram Rao.")).toBeUndefined();
    expect(ownerFromText("Thanks Dr. Shah for the great care!")).toBeUndefined();
    expect(ownerFromText("Our Founder believed in quality.")).toBeUndefined();
    expect(ownerFromText("Lovely food, rated 5 stars by Priya Sharma")).toBeUndefined();
    // a customer quoted on a supplier's site isn't the supplier's owner
    expect(ownerFromText("Testimonials: Great quality and on-time delivery. Ramesh Patel, Proprietor, Patel Traders")).toBeUndefined();
    expect(ownerFromText("“Best packaging partner we've had.” – Sunil Mehta, Owner, Mehta Foods")).toBeUndefined();
    expect(ownerFromText("Our clients: Amit Shah, Director at Shah Metals. Neha Rao, Founder of Bloom. Vikram Iyer, CEO of Kite.")).toBeUndefined();
  });

  it("is read from the website when the page names its founder", () => {
    const p = parsePage("<html><body><h1>Shree Furniture</h1><p>Founder: Rahul Shah</p></body></html>", "https://shreefurniture.in/");
    expect(p.ownerName).toBe("Rahul Shah");
  });
});

describe("working out the owner's email", () => {
  it("lists likely addresses on the business's own domain, first name first for a small business", () => {
    const c = ownerEmailCandidates(lead())!;
    expect(c.domain).toBe("shreefurniture.in");
    expect(c.list.slice(0, 4).map((x) => x.email)).toEqual(["rahul@shreefurniture.in", "rahul.shah@shreefurniture.in", "rshah@shreefurniture.in", "rahulshah@shreefurniture.in"]);
    expect(c.list[0].basis).toBe("Rahul Shah's name, written as just the first name, a common pattern for small businesses");
  });

  it("follows the pattern the domain's other addresses already use", () => {
    expect(domainPattern(["priya.mehta@shreefurniture.in", "info@shreefurniture.in"], "shreefurniture.in")).toEqual({ pattern: "first.last", example: "priya.mehta@shreefurniture.in" });
    expect(domainPattern(["priya@shreefurniture.in"], "shreefurniture.in")).toBeUndefined(); // one word could be any pattern
    const c = ownerEmailCandidates(lead({ emails: ["priya.mehta@shreefurniture.in"], emailInfo: [{ email: "priya.mehta@shreefurniture.in", kind: "own_named", deliverable: true }] }))!;
    expect(c.list[0]).toMatchObject({ email: "rahul.shah@shreefurniture.in", pattern: "first.last" });
    expect(c.list[0].basis).toContain("written like this domain's other addresses (priya.mehta@shreefurniture.in)");
  });

  it("tries dr<name>@ for doctors", () => {
    const c = ownerEmailCandidates(lead({ name: "Smile Dental", owner: { name: "Dr. Anjali Mehta", via: "website" }, website: "https://smiledental.in", audit: { ...emptyAudit("ok"), finalUrl: "https://smiledental.in/" } }))!;
    expect(c.list.map((x) => x.email)).toContain("drmehta@smiledental.in");
  });

  it("doesn't guess without a name, an own domain that works, or when the owner's address is already known", () => {
    expect(ownerEmailCandidates(lead({ owner: undefined }))).toBeUndefined();
    expect(ownerEmailCandidates(lead({ owner: { name: "Shree Furniture", via: "google_maps" } }))).toBeUndefined();
    expect(ownerEmailCandidates(lead({ audit: emptyAudit("down") }))).toBeUndefined();
    expect(ownerEmailCandidates(lead({ website: "https://shree.wixsite.com/home", audit: { ...emptyAudit("ok"), finalUrl: "https://shree.wixsite.com/home", freeSubdomain: true } }))).toBeUndefined();
    expect(ownerEmailCandidates(lead({ website: "https://instagram.com/shree", audit: { ...emptyAudit("ok"), finalUrl: "https://instagram.com/shree" } }))).toBeUndefined();
    expect(ownerEmailCandidates(lead({ emails: ["rahul.s@shreefurniture.in"], emailInfo: [{ email: "rahul.s@shreefurniture.in", kind: "own_named", deliverable: true }] }))).toBeUndefined();
    expect(ownerEmailCandidates(lead({ emails: ["rahulshah84@gmail.com"], emailInfo: [{ email: "rahulshah84@gmail.com", kind: "personal", deliverable: true }] }))).toBeUndefined();
    // a subdomain site still gets the company's own domain
    expect(ownerEmailCandidates(lead({ website: "https://shop.shreefurniture.co.in", audit: { ...emptyAudit("ok"), finalUrl: "https://shop.shreefurniture.co.in/" } }))!.domain).toBe("shreefurniture.co.in");
  });

  it("adds a guess to the lead's emails only once a mailbox check confirms it", async () => {
    const asked: string[] = [];
    const v: EmailVerifier = async (e) => (asked.push(e), { status: e.startsWith("rahul.shah@") ? "valid" : "invalid", by: "zerobounce" });
    const l = lead({ emails: ["info@shreefurniture.in"], email: "info@shreefurniture.in", emailInfo: [{ email: "info@shreefurniture.in", kind: "own_generic", deliverable: true, source: "website" }] });
    await findOwnerEmail(l, { verify: v, mx: async () => true });
    expect(asked).toEqual(["rahul@shreefurniture.in", "rahul.shah@shreefurniture.in"]);
    expect(l.email).toBe("rahul.shah@shreefurniture.in"); // the owner's own address now comes first
    expect(l.emails).toContain("rahul.shah@shreefurniture.in");
    expect(l.emailInfo![0]).toMatchObject({ email: "rahul.shah@shreefurniture.in", kind: "own_named", mailbox: "valid", source: "guessed", pattern: "first.last" });
    expect(l.emailGuess).toBeUndefined();
  });

  it("keeps an unconfirmed guess apart, so it's never emailed", async () => {
    const l = lead();
    await findOwnerEmail(l, { mx: async () => true });
    expect(l.emails).toEqual([]);
    expect(l.email).toBeUndefined();
    expect(l.emailGuess).toMatchObject({ email: "rahul@shreefurniture.in", status: "unchecked", pattern: "first" });
  });

  it("stops at the first 'accepts any address' answer, and spends nothing on a domain without mail", async () => {
    let n = 0;
    const l = lead();
    await findOwnerEmail(l, { verify: async () => (n++, { status: "catch_all", by: "smtp" }), mx: async () => true });
    expect(n).toBe(1);
    expect(l.emailGuess).toMatchObject({ email: "rahul@shreefurniture.in", status: "catch_all" });
    expect(l.emails).toEqual([]);
    const dead = lead();
    await findOwnerEmail(dead, { verify: async () => (n++, { status: "valid", by: "smtp" }), mx: async () => false });
    expect(n).toBe(1);
    expect(dead.emailGuess).toBeUndefined();
  });

  it("checks at most two patterns a lead, and keeps the next one as the guess", async () => {
    const asked: string[] = [];
    const l = lead();
    await findOwnerEmail(l, { verify: async (e) => (asked.push(e), { status: "invalid", by: "zerobounce" }) });
    expect(asked).toHaveLength(2);
    expect(l.emailGuess).toMatchObject({ email: "rshah@shreefurniture.in", status: "unchecked", tried: ["rahul@shreefurniture.in", "rahul.shah@shreefurniture.in"] });
    // out of checks for this search: it stays a guess
    const capped = lead();
    await findOwnerEmail(capped, { verify: async () => undefined });
    expect(capped.emailGuess?.status).toBe("unchecked");
  });

  it("runs as part of checking a business, and never for a chain", async () => {
    const deps = { discover: async () => ({ tried: [] }), audit: async () => ({ ...emptyAudit("ok"), finalUrl: "https://shreefurniture.in/", emails: ["info@shreefurniture.in"] }), mx: async () => true };
    const v = async (e: string) => ({ status: e.startsWith("rahul@") ? ("valid" as const) : ("invalid" as const), by: "smtp" as const });
    const l = lead({ audit: undefined });
    await qualifyLead(l, { verify: false, verifyEmail: v }, deps);
    expect(l.email).toBe("rahul@shreefurniture.in");
    expect(l.emailInfo!.find((i) => i.email === "info@shreefurniture.in")).toMatchObject({ source: "website" });
    const chain = lead({ audit: undefined, chain: { outlets: 3, reason: "3 outlets" } });
    await qualifyLead(chain, { verify: false }, deps);
    expect(chain.emailGuess).toBeUndefined();
    const off = lead({ audit: undefined });
    await qualifyLead(off, { verify: false }, { ...deps, emailGuess: false });
    expect(off.emailGuess).toBeUndefined();
  });
});

describe("how sure we are of an email", () => {
  it("scores published, guessed, verified and catch-all addresses", () => {
    expect(emailScore({ source: "website", mailbox: "valid" })).toBe(97);
    expect(emailScore({ source: "guessed", mailbox: "valid" })).toBe(90);
    expect(emailScore({ source: "website", deliverable: true })).toBe(75);
    expect(emailScore({ source: "website", deliverable: true, mailbox: "catch_all" })).toBe(55);
    expect(emailScore({ source: "guessed", deliverable: true, mailbox: "catch_all" })).toBe(30);
    expect(emailScore({ source: "website", mailbox: "invalid" })).toBe(0);
    expect(emailScore({ disposable: true })).toBe(0);
  });

  it("says when the confirmed email was worked out from the owner's name", () => {
    const c = contactConfidence(lead({ email: "rahul@shreefurniture.in", emails: ["rahul@shreefurniture.in"], emailInfo: [{ email: "rahul@shreefurniture.in", kind: "own_named", deliverable: true, mailbox: "valid", source: "guessed" }] }));
    expect(c.reasons).toContain("Owner's email worked out from their name, and the mailbox check says it exists");
  });
});

describe("owners from Google Maps", () => {
  it("keeps a person's name and drops a listing that names the business as its own owner", async () => {
    const { mergePlaces } = await import("@/lib/dedupe");
    const [person, self] = mergePlaces([
      { source: "gmaps", sourceId: "a", name: "Kunal's Kitchen", category: "Restaurant", owner: "Kunal Shah", lat: 22.3, lng: 73.1 },
      { source: "gmaps", sourceId: "b", name: "Aum Dental Care", category: "Dentist", owner: "Aum Dental Care", lat: 22.5, lng: 73.3 },
    ]);
    expect(person.owner).toEqual({ name: "Kunal Shah", via: "google_maps" });
    expect(self.owner).toBeUndefined();
  });
});
