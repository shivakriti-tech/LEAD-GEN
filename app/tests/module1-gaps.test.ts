import { describe, expect, it } from "vitest";
import { linkedinOf } from "@/lib/outreach";
import { normalizePhone, phoneKind } from "@/lib/util";
import { isDisposable, looksLikeEmail } from "@/lib/enrich/email";
import { cappedVerifier, verifierFromEnv, type EmailVerifier, type VerifyStats } from "@/lib/enrich/verifyEmail";
import { checkEmails } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import type { Lead } from "@/lib/types";

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as never;

describe("LinkedIn page (from the website or Apollo, never scraped)", () => {
  it("prefers a company page and cleans the link", () => {
    const audit = { ...emptyAudit("ok"), socials: { linkedin: "https://in.linkedin.com/in/rakesh-patel-123?trk=x" } };
    expect(linkedinOf({ audit })).toEqual({ url: "https://www.linkedin.com/in/rakesh-patel-123", kind: "person" });
    expect(linkedinOf({ audit, company: { linkedin: "http://www.linkedin.com/company/shiv-steel/about/" } })).toEqual({ url: "https://www.linkedin.com/company/shiv-steel", kind: "company" });
    expect(linkedinOf({ audit: { ...emptyAudit("ok"), socials: { linkedin: "https://evil.com/linkedin.com/company/x" } } })).toBeUndefined();
  });
});

describe("phone types", () => {
  it("tells mobiles, landlines and toll-free numbers apart", () => {
    expect(phoneKind(normalizePhone("98250 12345"))).toBe("mobile");
    expect(phoneKind(normalizePhone("0265-2345678"))).toBe("landline");
    expect(phoneKind(normalizePhone("1800 123 4567"))).toBe("tollfree");
    expect(phoneKind("+97150123456")).toBe("foreign");
  });
});

describe("email checks", () => {
  it("drops things that only look like emails, and flags throwaway inboxes", () => {
    expect(looksLikeEmail("rahul@shivsteel.in")).toBe(true);
    for (const junk of ["logo@2x.png", "name@domain.com", "you@example.com", "a..b@x.in", "info@sentry.io".replace("sentry.io", "wixpress.com")]) expect(looksLikeEmail(junk), junk).toBe(false);
    expect(isDisposable("x@yopmail.com")).toBe(true);
  });

  it("reads ZeroBounce and MillionVerifier answers, and stops on a bad key", async () => {
    const zb = verifierFromEnv({ EMAIL_VERIFY: "zerobounce", EMAIL_VERIFY_KEY: "k" }, reply({ address: "a@b.in", status: "catch-all", sub_status: "" }))!;
    expect(await zb("a@b.in")).toMatchObject({ status: "catch_all", by: "zerobounce" });
    const mv = verifierFromEnv({ EMAIL_VERIFY: "millionverifier", EMAIL_VERIFY_KEY: "k" }, reply({ email: "a@b.in", result: "invalid", subresult: "mailbox_not_found", error: "" }))!;
    expect(await mv("a@b.in")).toMatchObject({ status: "invalid", by: "millionverifier" });
    expect(verifierFromEnv({})).toBeUndefined();
    const stats: VerifyStats = { checked: 0, valid: 0, invalid: 0, catchAll: 0, skipped: 0 };
    const bad = cappedVerifier(verifierFromEnv({ EMAIL_VERIFY_KEY: "k" }, reply({ error: "Invalid API key or your account ran out of credits" }))!, 5, stats);
    expect(await bad("a@b.in")).toBeUndefined();
    expect(await bad("c@d.in")).toBeUndefined();
    expect(stats.stopped).toMatch(/ran out of credits/);
    expect(stats.checked).toBe(1); // didn't keep spending calls after the key failed
  });

  it("checks the best address and moves on when its mailbox doesn't exist", async () => {
    const asked: string[] = [];
    const v: EmailVerifier = async (e) => (asked.push(e), { status: e.startsWith("rahul") ? "invalid" : "valid", by: "zerobounce" });
    const stats: VerifyStats = { checked: 0, valid: 0, invalid: 0, catchAll: 0, skipped: 0 };
    const l = { id: "a", name: "Shiv Steel", website: "https://shivsteel.in", emails: ["info@shivsteel.in", "rahul@shivsteel.in", "logo@2x.png"], phones: [], signals: [] } as unknown as Lead;
    await checkEmails([l], async () => true, cappedVerifier(v, 1, stats));
    expect(asked).toEqual(["rahul@shivsteel.in"]); // the owner's own address first; the limit of 1 stops the second check
    expect(l.emails).not.toContain("logo@2x.png");
    expect(l.email).toBe("info@shivsteel.in");
    expect(l.emailInfo!.find((i) => i.email === "rahul@shivsteel.in")!.mailbox).toBe("invalid");
    await checkEmails([l], async () => true, cappedVerifier(v, 5, stats));
    expect(l.emailInfo![0]).toMatchObject({ email: "info@shivsteel.in", mailbox: "valid" }); // earlier answers are kept, next one checked
  });
});
